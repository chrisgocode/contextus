import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const GUEST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const E2E_GUEST_LIFETIME_MS = 60 * 60 * 1000;

export async function recordGuestGameCompletion(
  ctx: MutationCtx,
  gameId: Id<"games">,
) {
  const participants = ctx.db
    .query("gamePlayerStats")
    .withIndex("by_game_user", (q) => q.eq("gameId", gameId));
  for await (const participant of participants) {
    const user = await ctx.db.get("users", participant.userId);
    if (user?.isAnonymous === true) {
      await ctx.db.patch("users", user._id, {
        guestCompletedGames: (user.guestCompletedGames ?? 0) + 1,
      });
    }
  }
}
