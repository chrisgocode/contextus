import { getAuthSessionId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { evaluateCounterRules } from "./achievementRules";
import { getAchievementDefinition } from "./achievements";
import { GUEST_LIFETIME_MS } from "./guestEngagement";
import { addDays } from "./localTime";
import { deleteUserAuthData } from "./userStatsRows";

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
type BatchPhase = Exclude<MergeJob["phase"], "finalize">;

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
  if (guest?.isAnonymous !== true || target === null) return null;
  const existing = await ctx.db
    .query("guestMerges")
    .withIndex("by_guest_user", (q) => q.eq("guestUserId", guestUserId))
    .first();
  if (existing !== null) return null;

  const mergeId = await ctx.db.insert("guestMerges", {
    guestUserId,
    targetUserId,
    phase: "hostedRooms",
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

const batchPhases: Record<
  BatchPhase,
  {
    run: (ctx: MergeCtx, job: MergeJob) => Promise<number>;
    next: MergeJob["phase"];
  }
> = {
  hostedRooms: { run: patchGuestHostedRooms, next: "memberships" },
  memberships: { run: mergeRoomMemberships, next: "guesses" },
  guesses: { run: patchGuestGuesses, next: "requests" },
  requests: { run: patchGuestRequests, next: "wins" },
  wins: { run: patchGuestWins, next: "history" },
  history: { run: mergeHistory, next: "achievements" },
  achievements: { run: mergeAchievements, next: "achievementProgress" },
  achievementProgress: { run: mergeAchievementProgress, next: "solveDays" },
  solveDays: { run: mergeSolveDays, next: "gamePlayerStats" },
  // Runs after achievement progress so per-game counters land on the
  // merged progress rows.
  gamePlayerStats: { run: mergeGamePlayerStats, next: "streak" },
  // Guest and account solve days can interleave into a longer streak than
  // either side had alone, so scan the merged days.
  streak: { run: scanStreak, next: "finalize" },
};

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
  const phase = batchPhases[job.phase];
  const moved = await phase.run(ctx, job);
  if (moved < GUEST_MERGE_BATCH_SIZE) {
    await ctx.db.patch("guestMerges", mergeId, { phase: phase.next });
  }
  await ctx.scheduler.runAfter(0, internal.guestMerge.runBatch, { mergeId });
}

// Totals depend on every history row having moved, so they run last. A
// stale guest tab can still write after its table's phase, so re-sweep
// until nothing is left, then delete the guest in the same transaction.
async function finalizeMerge(ctx: MutationCtx, job: MergeJob) {
  if (await guestHasRowsLeft(ctx, job.guestUserId)) {
    await ctx.db.patch("guestMerges", job._id, {
      phase: "hostedRooms",
      streakLastDay: undefined,
      streakRun: 0,
      streakBest: 0,
    });
    await ctx.scheduler.runAfter(0, internal.guestMerge.runBatch, {
      mergeId: job._id,
    });
    return;
  }
  await mergeAchievementStats(
    ctx,
    job.guestUserId,
    job.targetUserId,
    job.overlappingSolves,
  );
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
  await deleteUserAuthData(ctx, job.guestUserId);
  if ((await ctx.db.get("users", job.guestUserId)) !== null) {
    await ctx.db.delete("users", job.guestUserId);
  }
  await ctx.db.delete("guestMerges", job._id);
}

async function guestHasRowsLeft(ctx: MergeCtx, guestUserId: Id<"users">) {
  const rows = await Promise.all([
    ctx.db
      .query("rooms")
      .withIndex("by_host_user", (q) => q.eq("hostUserId", guestUserId))
      .first(),
    ctx.db
      .query("roomMembers")
      .withIndex("by_user", (q) => q.eq("userId", guestUserId))
      .first(),
    ctx.db
      .query("gameGuesses")
      .withIndex("by_user", (q) => q.eq("userId", guestUserId))
      .first(),
    ctx.db
      .query("pendingRequests")
      .withIndex("by_requester_game_type_status", (q) =>
        q.eq("requesterUserId", guestUserId),
      )
      .first(),
    ctx.db
      .query("games")
      .withIndex("by_winner_user", (q) => q.eq("winnerUserId", guestUserId))
      .first(),
    ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) => q.eq("userId", guestUserId))
      .first(),
    ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) => q.eq("userId", guestUserId))
      .first(),
    ctx.db
      .query("userAchievementProgress")
      .withIndex("by_user_achievement", (q) => q.eq("userId", guestUserId))
      .first(),
    ctx.db
      .query("userSolveDays")
      .withIndex("by_user_and_dayKey", (q) => q.eq("userId", guestUserId))
      .first(),
    ctx.db
      .query("gamePlayerStats")
      .withIndex("by_user", (q) => q.eq("userId", guestUserId))
      .first(),
  ]);
  return rows.some((row) => row !== null);
}

async function patchGuestHostedRooms(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("rooms")
    .withIndex("by_host_user", (q) => q.eq("hostUserId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    await ctx.db.patch("rooms", row._id, { hostUserId: targetUserId });
  }
  return rows.length;
}

async function mergeRoomMemberships(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("roomMembers")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    const existing = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) =>
        q.eq("roomId", row.roomId).eq("userId", targetUserId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("roomMembers", row._id, { userId: targetUserId });
    } else {
      await ctx.db.patch("roomMembers", existing._id, {
        joinedAt: Math.min(existing.joinedAt, row.joinedAt),
      });
      await ctx.db.delete("roomMembers", row._id);
    }
  }
  return rows.length;
}

async function patchGuestGuesses(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("gameGuesses")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    await ctx.db.patch("gameGuesses", row._id, { userId: targetUserId });
  }
  return rows.length;
}

async function patchGuestRequests(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("pendingRequests")
    .withIndex("by_requester_game_type_status", (q) =>
      q.eq("requesterUserId", guestUserId),
    )
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    const existing = await ctx.db
      .query("pendingRequests")
      .withIndex("by_requester_game_type_status", (q) =>
        q
          .eq("requesterUserId", targetUserId)
          .eq("gameId", row.gameId)
          .eq("type", row.type)
          .eq("status", row.status),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("pendingRequests", row._id, {
        requesterUserId: targetUserId,
      });
    } else {
      await ctx.db.delete("pendingRequests", row._id);
    }
  }
  return rows.length;
}

async function patchGuestWins(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("games")
    .withIndex("by_winner_user", (q) => q.eq("winnerUserId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    await ctx.db.patch("games", row._id, { winnerUserId: targetUserId });
  }
  return rows.length;
}

async function mergeHistory(ctx: MergeCtx, job: MergeJob) {
  const { guestUserId, targetUserId } = job;
  let overlappingSolves = 0;
  const rows = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) => q.eq("userId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    const existing = await ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) =>
        q.eq("userId", targetUserId).eq("contextoGameId", row.contextoGameId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userGameHistory", row._id, { userId: targetUserId });
      continue;
    }
    if (
      existing.firstSolvedAt !== undefined &&
      row.firstSolvedAt !== undefined
    ) {
      overlappingSolves += 1;
    }
    await ctx.db.patch("userGameHistory", existing._id, {
      firstPlayedAt: Math.min(existing.firstPlayedAt, row.firstPlayedAt),
      firstAttemptAt: earliest(existing.firstAttemptAt, row.firstAttemptAt),
      firstAttemptDistance:
        existing.firstAttemptAt === undefined ||
        (row.firstAttemptAt !== undefined &&
          row.firstAttemptAt < existing.firstAttemptAt)
          ? row.firstAttemptDistance
          : existing.firstAttemptDistance,
      firstAttemptGameId:
        existing.firstAttemptAt === undefined ||
        (row.firstAttemptAt !== undefined &&
          row.firstAttemptAt < existing.firstAttemptAt)
          ? row.firstAttemptGameId
          : existing.firstAttemptGameId,
      firstSolvedAt: earliest(existing.firstSolvedAt, row.firstSolvedAt),
      firstSolvedGameId:
        existing.firstSolvedAt === undefined ||
        (row.firstSolvedAt !== undefined &&
          row.firstSolvedAt < existing.firstSolvedAt)
          ? row.firstSolvedGameId
          : existing.firstSolvedGameId,
    });
    await ctx.db.delete("userGameHistory", row._id);
  }
  if (overlappingSolves > 0) {
    await ctx.db.patch("guestMerges", job._id, {
      overlappingSolves: job.overlappingSolves + overlappingSolves,
    });
  }
  return rows.length;
}

async function mergeAchievements(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("userAchievements")
    .withIndex("by_user_achievement", (q) => q.eq("userId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    const existing = await ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", targetUserId).eq("achievementId", row.achievementId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userAchievements", row._id, { userId: targetUserId });
    } else {
      await ctx.db.patch("userAchievements", existing._id, {
        unlockedAt: Math.min(existing.unlockedAt, row.unlockedAt),
      });
      await ctx.db.delete("userAchievements", row._id);
    }
  }
  return rows.length;
}

async function mergeAchievementProgress(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("userAchievementProgress")
    .withIndex("by_user_achievement", (q) => q.eq("userId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    const existing = await ctx.db
      .query("userAchievementProgress")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", targetUserId).eq("achievementId", row.achievementId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userAchievementProgress", row._id, {
        userId: targetUserId,
      });
    } else {
      await ctx.db.patch("userAchievementProgress", existing._id, {
        current: Math.max(existing.current, row.current),
        target: Math.max(existing.target, row.target),
        hidden: existing.hidden && row.hidden,
        updatedAt: Math.max(existing.updatedAt, row.updatedAt),
      });
      await ctx.db.delete("userAchievementProgress", row._id);
    }
  }
  return rows.length;
}

async function mergeAchievementStats(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
  overlappingSolves: number,
) {
  const guest = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .unique();
  if (guest === null) return;
  const target = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", targetUserId))
    .unique();
  if (target === null) {
    await ctx.db.patch("userAchievementStats", guest._id, {
      userId: targetUserId,
    });
    return;
  }
  await ctx.db.patch("userAchievementStats", target._id, {
    redGuesses: target.redGuesses + guest.redGuesses,
    yellowGuesses: target.yellowGuesses + guest.yellowGuesses,
    greenGuesses: target.greenGuesses + guest.greenGuesses,
    uniqueSolves: Math.max(
      0,
      target.uniqueSolves + guest.uniqueSolves - overlappingSolves,
    ),
  });
  await ctx.db.delete("userAchievementStats", guest._id);
}

async function mergeSolveDays(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("userSolveDays")
    .withIndex("by_user_and_dayKey", (q) => q.eq("userId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    const existing = await ctx.db
      .query("userSolveDays")
      .withIndex("by_user_and_dayKey", (q) =>
        q.eq("userId", targetUserId).eq("dayKey", row.dayKey),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userSolveDays", row._id, { userId: targetUserId });
    } else {
      await ctx.db.delete("userSolveDays", row._id);
    }
  }
  return rows.length;
}

async function mergeGamePlayerStats(
  ctx: MergeCtx,
  { guestUserId, targetUserId }: MergeJob,
) {
  const rows = await ctx.db
    .query("gamePlayerStats")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .take(GUEST_MERGE_BATCH_SIZE);
  for (const row of rows) {
    const existing = await ctx.db
      .query("gamePlayerStats")
      .withIndex("by_game_user", (q) =>
        q.eq("gameId", row.gameId).eq("userId", targetUserId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("gamePlayerStats", row._id, { userId: targetUserId });
      await applyCounterValue(
        ctx,
        targetUserId,
        "gameRealGuesses",
        row.realGuessCount,
        Date.now(),
      );
    } else {
      const realGuessCount = existing.realGuessCount + row.realGuessCount;
      await ctx.db.patch("gamePlayerStats", existing._id, {
        realGuessCount,
        bestDistance: Math.min(existing.bestDistance, row.bestDistance),
        lastDistance:
          row.updatedAt > existing.updatedAt
            ? row.lastDistance
            : existing.lastDistance,
        noBacktrackingSoFar:
          existing.noBacktrackingSoFar && row.noBacktrackingSoFar,
        updatedAt: Math.max(existing.updatedAt, row.updatedAt),
      });
      await ctx.db.delete("gamePlayerStats", row._id);
      await applyCounterValue(
        ctx,
        targetUserId,
        "gameRealGuesses",
        realGuessCount,
        Date.now(),
      );
    }
  }
  return rows.length;
}

async function reconcileCounterAchievements(
  ctx: MergeCtx,
  userId: Id<"users">,
) {
  const stats = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats === null) return;
  const counters = {
    redGuesses: stats.redGuesses,
    yellowGuesses: stats.yellowGuesses,
    greenGuesses: stats.greenGuesses,
    uniqueSolves: stats.uniqueSolves,
  };
  const now = Date.now();
  for (const [counterId, value] of Object.entries(counters)) {
    await applyCounterValue(
      ctx,
      userId,
      counterId as keyof typeof counters,
      value,
      now,
    );
  }
}

async function applyCounterValue(
  ctx: MergeCtx,
  userId: Id<"users">,
  counterId: Parameters<typeof evaluateCounterRules>[0],
  value: number,
  now: number,
) {
  for (const rule of evaluateCounterRules(counterId, value)) {
    const definition = getAchievementDefinition(rule.achievementId);
    if (definition?.active !== true) continue;
    const progress = await ctx.db
      .query("userAchievementProgress")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", userId).eq("achievementId", rule.achievementId),
      )
      .unique();
    const current = Math.min(value, rule.threshold);
    if (progress === null) {
      await ctx.db.insert("userAchievementProgress", {
        userId,
        achievementId: rule.achievementId,
        current,
        target: rule.threshold,
        hidden: definition.hidden,
        updatedAt: now,
      });
    } else if (current > progress.current) {
      await ctx.db.patch("userAchievementProgress", progress._id, {
        current,
        updatedAt: now,
      });
    }
    if (!rule.shouldUnlock) continue;
    const unlocked = await ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", userId).eq("achievementId", rule.achievementId),
      )
      .unique();
    if (unlocked === null) {
      await ctx.db.insert("userAchievements", {
        userId,
        achievementId: rule.achievementId,
        unlockedAt: now,
      });
    }
  }
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

function earliest(a: number | undefined, b: number | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}
