import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import { requireUser } from "./auth_helpers";

export const _giveupPreflight = internalQuery({
	args: { gameId: v.id("games"), hostUserId: v.id("users") },
	handler: async (ctx, { gameId, hostUserId }) => {
		const game = await ctx.db.get(gameId);
		if (game === null) throw new ConvexError("Game not found");
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		const room = await ctx.db.get(game.roomId);
		if (room === null) throw new ConvexError("Room not found");
		if (room.hostUserId !== hostUserId) {
			throw new ConvexError("Only host can give up");
		}
		return { contextoGameId: game.contextoGameId };
	},
});

export const _finalizeGiveup = internalMutation({
	args: {
		gameId: v.id("games"),
		answerLemma: v.string(),
		requestId: v.optional(v.id("pendingRequests")),
	},
	handler: async (ctx, { gameId, answerLemma, requestId }) => {
		const game = await ctx.db.get(gameId);
		if (game === null) throw new ConvexError("Game not found");
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		const now = Date.now();
		await ctx.db.patch(gameId, {
			status: "given_up",
			answerLemma,
			endedAt: now,
		});
		await ctx.db.patch(game.roomId, { lastActivityAt: now });
		if (requestId !== undefined) {
			await ctx.db.patch(requestId, { status: "approved" });
		}
	},
});

export const _execute = internalAction({
	args: {
		gameId: v.id("games"),
		hostUserId: v.id("users"),
		requestId: v.optional(v.id("pendingRequests")),
	},
	handler: async (
		ctx,
		{ gameId, hostUserId, requestId },
	): Promise<{ lemma: string }> => {
		const pre: { contextoGameId: number } = await ctx.runQuery(
			internal.giveup._giveupPreflight,
			{ gameId, hostUserId },
		);
		const answer: { lemma: string } = await ctx.runAction(
			internal.contexto.fetchAnswer,
			{ contextoGameId: pre.contextoGameId },
		);
		await ctx.runMutation(internal.giveup._finalizeGiveup, {
			gameId,
			answerLemma: answer.lemma,
			requestId,
		});
		return answer;
	},
});

export const hostGiveup = action({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }): Promise<{ lemma: string }> => {
		const hostUserId: Id<"users"> = await requireUser(ctx);
		return await ctx.runAction(internal.giveup._execute, {
			gameId,
			hostUserId,
		});
	},
});
