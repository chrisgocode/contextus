import { getAuthSessionId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  type MergePhase,
  USER_KEYED_TABLES,
  deleteMergedGuest,
} from "./accountLifecycle";
import { GUEST_LIFETIME_MS } from "./guestEngagement";
import {
  type MergeState,
  applyCounterValue,
  reconcileCounterAchievements,
} from "./guestMergeRows";
import { addDays } from "./localTime";
import { mergeGuestIdentity, track } from "../analytics";

type MergeCtx = Pick<MutationCtx, "db">;

async function currentUserFromSession(
  ctx: Pick<MutationCtx, "auth" | "db">,
): Promise<Id<"users"> | null> {
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId === null) return null;
  const session = await ctx.db.get("authSessions", sessionId);
  return session?.userId ?? null;
}

// Rows moved per transaction. Each moved row is patched off the guest's
// index or deleted, so re-querying the guest index resumes where the last
// batch stopped.
export const GUEST_MERGE_BATCH_SIZE = 100;

type MergeJob = Doc<"guestMerges">;

// Each registered table moves in its own phase, in registry order. Then the
// streak scan runs over the merged solve days, then `finalizeMerge`.
const PHASES: MergeJob["phase"][] = [
  ...USER_KEYED_TABLES.flatMap((p) =>
    p.mergePhase === undefined ? [] : [p.mergePhase],
  ),
  "streak",
  "finalize",
];

// Starts moving the current guest session's data to `targetUserId`. Only
// bounded work runs here because it shares the sign-in transaction; the
// transfer itself runs in scheduled batches.
export async function startGuestMerge(
  ctx: Pick<MutationCtx, "auth" | "db" | "scheduler">,
  targetUserId: Id<"users">,
): Promise<Id<"guestMerges"> | null> {
  const guestUserId = await currentUserFromSession(ctx);
  if (guestUserId === null || guestUserId === targetUserId) return null;
  const [guest, target] = await Promise.all([
    ctx.db.get("users", guestUserId),
    ctx.db.get("users", targetUserId),
  ]);
  if (
    guest?.isAnonymous !== true ||
    guest.guestCleanupStarted === true ||
    target === null
  )
    return null;
  const existing = await ctx.db
    .query("guestMerges")
    .withIndex("by_guest_user", (q) => q.eq("guestUserId", guestUserId))
    .first();
  if (existing !== null) return null;

  const mergeId = await ctx.db.insert("guestMerges", {
    guestUserId,
    targetUserId,
    phase: PHASES[0],
    overlappingSolves: 0,
    streakRun: 0,
    streakBest: 0,
  });
  // Expiry cleanup would delete rows the merge hasn't moved yet. The merge
  // deletes the guest itself, well before this new expiry.
  await ctx.db.patch("users", guestUserId, {
    guestExpiresAt: Date.now() + GUEST_LIFETIME_MS,
  });
  await ctx.scheduler.runAfter(0, internal.guestMerge.runBatch, { mergeId });
  return mergeId;
}

export async function runGuestMergeBatch(
  ctx: MutationCtx,
  mergeId: Id<"guestMerges">,
) {
  const job = await ctx.db.get("guestMerges", mergeId);
  if (job === null) return;
  if (job.phase === "finalize") {
    await finalizeMerge(ctx, job);
    return;
  }
  const moved =
    job.phase === "streak"
      ? await scanStreak(ctx, job)
      : await moveTableBatch(ctx, job, job.phase);
  if (moved < GUEST_MERGE_BATCH_SIZE) {
    await ctx.db.patch("guestMerges", mergeId, {
      phase: PHASES[PHASES.indexOf(job.phase) + 1],
    });
  }
  await ctx.scheduler.runAfter(0, internal.guestMerge.runBatch, { mergeId });
}

async function moveTableBatch(ctx: MergeCtx, job: MergeJob, phase: MergePhase) {
  const table = USER_KEYED_TABLES.find((p) => p.mergePhase === phase);
  if (table === undefined) throw new Error(`No table merges in ${phase}`);
  const state = mergeState(job);
  const moved = await table.runMergeBatch(
    ctx,
    job.guestUserId,
    state,
    GUEST_MERGE_BATCH_SIZE,
  );
  if (state.overlappingSolves !== job.overlappingSolves) {
    await ctx.db.patch("guestMerges", job._id, {
      overlappingSolves: state.overlappingSolves,
    });
  }
  return moved;
}

function mergeState(job: MergeJob): MergeState {
  return {
    targetUserId: job.targetUserId,
    overlappingSolves: job.overlappingSolves,
  };
}

// Totals depend on every history row having moved, so they run last. A
// stale guest tab can still write after its table's phase, so re-sweep
// until nothing is left, then delete the guest in the same transaction.
async function finalizeMerge(ctx: MutationCtx, job: MergeJob) {
  if (await guestHasRowsLeft(ctx, job.guestUserId)) {
    await ctx.db.patch("guestMerges", job._id, {
      phase: PHASES[0],
      streakLastDay: undefined,
      streakRun: 0,
      streakBest: 0,
    });
    await ctx.scheduler.runAfter(0, internal.guestMerge.runBatch, {
      mergeId: job._id,
    });
    return;
  }
  const state = mergeState(job);
  for (const p of USER_KEYED_TABLES) {
    await p.runMergeAtFinalize(ctx, job.guestUserId, state);
  }
  await reconcileCounterAchievements(ctx, job.targetUserId);
  if (job.streakBest > 0) {
    await applyCounterValue(
      ctx,
      job.targetUserId,
      "streakDays",
      job.streakBest,
      Date.now(),
    );
  }
  // Also deletes this job, which is keyed to the guest.
  await deleteMergedGuest(ctx, job.guestUserId);
  await track(ctx, job.targetUserId, {
    name: "guest_merged",
    properties: {
      guest_user_id: job.guestUserId,
      account_user_id: job.targetUserId,
    },
  });
  await mergeGuestIdentity(ctx, job.guestUserId, job.targetUserId);
}

async function guestHasRowsLeft(ctx: MergeCtx, guestUserId: Id<"users">) {
  for (const p of USER_KEYED_TABLES) {
    if (await p.hasBatchedRows(ctx, guestUserId)) return true;
  }
  return false;
}

async function scanStreak(ctx: MergeCtx, job: MergeJob) {
  const rows = await ctx.db
    .query("userSolveDays")
    .withIndex("by_user_and_dayKey", (q) => {
      const byUser = q.eq("userId", job.targetUserId);
      return job.streakLastDay === undefined
        ? byUser
        : byUser.gt("dayKey", job.streakLastDay);
    })
    .take(GUEST_MERGE_BATCH_SIZE);
  let { streakLastDay, streakRun, streakBest } = job;
  for (const row of rows) {
    streakRun =
      streakLastDay !== undefined && addDays(streakLastDay, 1) === row.dayKey
        ? streakRun + 1
        : 1;
    streakBest = Math.max(streakBest, streakRun);
    streakLastDay = row.dayKey;
  }
  if (rows.length > 0) {
    await ctx.db.patch("guestMerges", job._id, {
      streakLastDay,
      streakRun,
      streakBest,
    });
  }
  return rows.length;
}
