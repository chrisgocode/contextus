import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const GUEST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export async function recordGuestGameCompletion(
	ctx: MutationCtx,
	gameId: Id<"games">,
) {
	const participants = await ctx.db
		.query("gamePlayerStats")
		.withIndex("by_game", (q) => q.eq("gameId", gameId))
		.take(500);
	for (const participant of participants) {
		const user = await ctx.db.get(participant.userId);
		if (user?.isAnonymous === true) {
			await ctx.db.patch(user._id, {
				guestCompletedGames: (user.guestCompletedGames ?? 0) + 1,
			});
		}
	}
}
