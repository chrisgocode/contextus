import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalQuery } from "./_generated/server";
import { requireHostByGame, requireUser } from "./access";

export const _giveupPreflight = internalQuery({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const { game } = await requireHostByGame(ctx, { gameId });
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		return { contextoGameId: game.contextoGameId };
	},
});

export const _execute = internalAction({
	args: {
		gameId: v.id("games"),
		requestId: v.optional(v.id("pendingRequests")),
	},
	handler: async (
		ctx,
		{ gameId, requestId },
	): Promise<{ lemma: string }> => {
		const pre: { contextoGameId: number } = await ctx.runQuery(
			internal.giveup._giveupPreflight,
			{ gameId },
		);
		const answer: { lemma: string } = await ctx.runAction(
			internal.contexto.fetchAnswer,
			{ contextoGameId: pre.contextoGameId },
		);
		await ctx.runMutation(internal.gameTransitions.applyGiveup, {
			gameId,
			answerLemma: answer.lemma,
			closeRequestId: requestId,
		});
		return answer;
	},
});

export const hostGiveup = action({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }): Promise<{ lemma: string }> => {
		await requireUser(ctx);
		return await ctx.runAction(internal.giveup._execute, {
			gameId,
		});
	},
});
