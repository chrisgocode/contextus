import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
} from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { assertMember } from "./games";

async function loadGameAndRoom(ctx: { db: any }, gameId: Id<"games">) {
	const game = await ctx.db.get(gameId);
	if (game === null) throw new ConvexError("Game not found");
	if (game.status !== "in_progress") {
		throw new ConvexError("Game is no longer in progress");
	}
	const room = await ctx.db.get(game.roomId);
	if (room === null) throw new ConvexError("Room not found");
	return { game, room };
}

export const request = mutation({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const userId = await requireUser(ctx);
		const { game, room } = await loadGameAndRoom(ctx, gameId);
		if (room.hostUserId === userId) {
			throw new ConvexError("Host should use hostGiveup");
		}
		await assertMember(ctx, game.roomId, userId);
		const existing = await ctx.db
			.query("pendingRequests")
			.withIndex("by_requester_game_type_status", (q) =>
				q
					.eq("requesterUserId", userId)
					.eq("gameId", gameId)
					.eq("type", "giveup")
					.eq("status", "pending"),
			)
			.first();
		if (existing !== null) {
			throw new ConvexError("Giveup request already pending");
		}
		await ctx.db.insert("pendingRequests", {
			roomId: game.roomId,
			gameId,
			requesterUserId: userId,
			type: "giveup",
			status: "pending",
			createdAt: Date.now(),
		});
		return null;
	},
});

export const deny = mutation({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		const userId = await requireUser(ctx);
		const req = await ctx.db.get(requestId);
		if (req === null || req.type !== "giveup") {
			throw new ConvexError("Request not found");
		}
		const room = await ctx.db.get(req.roomId);
		if (room === null || room.hostUserId !== userId) {
			throw new ConvexError("Only host can deny");
		}
		await ctx.db.patch(requestId, { status: "denied" });
		return null;
	},
});

export const _readRequest = internalQuery({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		return await ctx.db.get(requestId);
	},
});

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

async function executeGiveup(
	ctx: { runQuery: any; runAction: any; runMutation: any },
	args: {
		gameId: Id<"games">;
		hostUserId: Id<"users">;
		requestId?: Id<"pendingRequests">;
	},
): Promise<{ lemma: string }> {
	const pre: { contextoGameId: number } = await ctx.runQuery(
		internal.giveup._giveupPreflight,
		{ gameId: args.gameId, hostUserId: args.hostUserId },
	);
	const answer: { lemma: string } = await ctx.runAction(
		internal.contexto.fetchAnswer,
		{ contextoGameId: pre.contextoGameId },
	);
	await ctx.runMutation(internal.giveup._finalizeGiveup, {
		gameId: args.gameId,
		answerLemma: answer.lemma,
		requestId: args.requestId,
	});
	return answer;
}

export const approve = action({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		const hostUserId = await requireUser(ctx);
		const req: any = await ctx.runQuery(internal.giveup._readRequest, {
			requestId,
		});
		if (req === null || req.type !== "giveup" || req.status !== "pending") {
			throw new ConvexError("Request not found or already handled");
		}
		return await executeGiveup(ctx, {
			gameId: req.gameId,
			hostUserId,
			requestId,
		});
	},
});

export const hostGiveup = action({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const hostUserId = await requireUser(ctx);
		return await executeGiveup(ctx, { gameId, hostUserId });
	},
});
