import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type DbCtx = Pick<MutationCtx, "db">;

// Row existence is the first-play milestone. Replays, attempts, and solve
// credit all enter here, but never rewrite when the player first played.
export async function getOrCreateHistory(
  ctx: DbCtx,
  userId: Id<"users">,
  contextoGameId: number,
  now: number,
) {
  const existing = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) =>
      q.eq("userId", userId).eq("contextoGameId", contextoGameId),
    )
    .unique();
  if (existing !== null) return existing;
  const id = await ctx.db.insert("userGameHistory", {
    userId,
    contextoGameId,
    firstPlayedAt: now,
  });
  const inserted = await ctx.db.get("userGameHistory", id);
  if (inserted === null) {
    throw new Error("Inserted userGameHistory row could not be read");
  }
  return inserted;
}
