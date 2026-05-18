import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { upsertHistory } from "./games";
import { decideGiveup, decideGuess } from "./lib/gameTransitions";
import { upsertRoomActivity } from "./lib/roomActivity";

export const applyGuess = internalMutation({
	args: {
		gameId: v.id("games"),
		userId: v.id("users"),
		lemma: v.string(),
		distance: v.number(),
		source: v.union(v.literal("guess"), v.literal("hint")),
		closeRequestId: v.optional(v.id("pendingRequests")),
	},
	handler: async (
		ctx,
		{ gameId, userId, lemma, distance, source, closeRequestId },
	): Promise<{ status: "recorded" | "duplicate"; won: boolean }> => {
		const game = await ctx.db.get(gameId);
		if (game === null) throw new ConvexError("Game not found");
		const existingGuess = await ctx.db
			.query("gameGuesses")
			.withIndex("by_game_lemma", (q) =>
				q.eq("gameId", gameId).eq("lemma", lemma),
			)
			.unique();

		const decision = decideGuess(
			{ game, existingGuess, now: Date.now() },
			{
				userId,
				lemma,
				distance,
				source,
				closeRequestId: closeRequestId ?? null,
			},
		);

		if (decision.kind === "reject") {
			if (decision.reason === "not_in_progress") {
				throw new ConvexError("Game is no longer in progress");
			}
			return { status: "duplicate", won: false };
		}

		const cached = await ctx.db
			.query("wordDistances")
			.withIndex("by_game_lemma", (q) =>
				q.eq("contextoGameId", game.contextoGameId).eq("lemma", lemma),
			)
			.unique();
		if (cached === null) {
			await ctx.db.insert("wordDistances", {
				contextoGameId: game.contextoGameId,
				lemma,
				distance,
			});
		}

		await ctx.db.insert("gameGuesses", decision.insertGuess);
		if (decision.gamePatch !== null) {
			await ctx.db.patch(gameId, decision.gamePatch);
		}
		await upsertRoomActivity(ctx, game.roomId, decision.lastActivityAt);
		await upsertHistory(
			ctx,
			decision.upsertHistoryForUserId,
			game.contextoGameId,
		);
		if (decision.closeRequestId !== null) {
			await ctx.db.patch(decision.closeRequestId, { status: "approved" });
		}
		return { status: "recorded", won: decision.won };
	},
});

export const applyGiveup = internalMutation({
	args: {
		gameId: v.id("games"),
		answerLemma: v.string(),
		closeRequestId: v.optional(v.id("pendingRequests")),
	},
	handler: async (ctx, { gameId, answerLemma, closeRequestId }) => {
		const game = await ctx.db.get(gameId);
		if (game === null) throw new ConvexError("Game not found");
		const decision = decideGiveup(
			{ game, now: Date.now() },
			{ answerLemma, closeRequestId: closeRequestId ?? null },
		);
		if (decision.kind === "reject") {
			throw new ConvexError("Game is no longer in progress");
		}
		await ctx.db.patch(gameId, decision.gamePatch);
		await upsertRoomActivity(ctx, game.roomId, decision.lastActivityAt);
		if (decision.closeRequestId !== null) {
			await ctx.db.patch(decision.closeRequestId, { status: "approved" });
		}
		return null;
	},
});
