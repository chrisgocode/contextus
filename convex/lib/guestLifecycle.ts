import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Effective state, derived from existing persisted fields and the owning job.
// active -> expired; active/expired -> merging -> deleted;
// expired -> cleaning -> anonymized. Cleaning cannot transition to merging.
// An anonymized user is no longer anonymous; like a registered user, it is
// outside this lifecycle. No name-based tombstone detection is needed.
type GuestLifecycle =
  | { kind: "active" | "expired" | "cleaning" }
  | { kind: "merging"; job: Doc<"guestMerges"> }
  | { kind: "outsideLifecycle" }
  | { kind: "deleted" };

export async function guestLifecycle(
  ctx: Pick<QueryCtx, "db">,
  guest: Doc<"users"> | null,
  now: number,
): Promise<GuestLifecycle> {
  if (guest === null) return { kind: "deleted" };
  if (guest.isAnonymous !== true) return { kind: "outsideLifecycle" };
  // Cleanup's claim is irreversible, even if a legacy/inconsistent job exists.
  if (guest.guestCleanupStarted === true) return { kind: "cleaning" };
  const job = await ctx.db
    .query("guestMerges")
    .withIndex("by_guest_user", (q) => q.eq("guestUserId", guest._id))
    .first();
  if (job !== null) return { kind: "merging", job };
  return {
    kind:
      guest.guestExpiresAt !== undefined && guest.guestExpiresAt <= now
        ? "expired"
        : "active",
  };
}

export async function ownsGuestMerge(
  ctx: Pick<QueryCtx, "db">,
  job: Doc<"guestMerges">,
) {
  const state = await guestLifecycle(
    ctx,
    await ctx.db.get("users", job.guestUserId),
    Date.now(),
  );
  return state.kind === "merging" && state.job._id === job._id;
}
