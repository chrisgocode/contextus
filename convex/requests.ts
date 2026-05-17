import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	action,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { assertMember, isMember } from "./games";

const REQUEST_TYPE = v.union(v.literal("hint"), v.literal("giveup"));

export const listPending = query({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const userId = await requireUser(ctx);
		const game = await ctx.db.get(gameId);
		if (game === null) return [];
		if (!(await isMember(ctx, game.roomId, userId))) return [];
		const room = await ctx.db.get(game.roomId);
		if (room === null) return [];
		const isHost = room.hostUserId === userId;
		const rowsRaw = await ctx.db
			.query("pendingRequests")
			.withIndex("by_game_status", (q) =>
				q.eq("gameId", gameId).eq("status", "pending"),
			)
			.collect();
		const rows = isHost
			? rowsRaw
			: rowsRaw.filter((r) => r.requesterUserId === userId);
		const hydrated = await Promise.all(
			rows.map(async (r) => {
				const u = await ctx.db.get(r.requesterUserId);
				return {
					...r,
					requesterName: u?.name ?? null,
					requesterImage: u?.image ?? null,
				};
			}),
		);
		return hydrated;
	},
});

export const create = mutation({
	args: { gameId: v.id("games"), type: REQUEST_TYPE },
	handler: async (ctx, { gameId, type }) => {
		const userId = await requireUser(ctx);
		const game = await ctx.db.get(gameId);
		if (game === null) throw new ConvexError("Game not found");
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		const room = await ctx.db.get(game.roomId);
		if (room === null) throw new ConvexError("Room not found");
		if (room.hostUserId === userId) {
			throw new ConvexError(
				`Host should use the direct ${type} action`,
			);
		}
		await assertMember(ctx, game.roomId, userId);
		const existing = await ctx.db
			.query("pendingRequests")
			.withIndex("by_requester_game_type_status", (q) =>
				q
					.eq("requesterUserId", userId)
					.eq("gameId", gameId)
					.eq("type", type)
					.eq("status", "pending"),
			)
			.first();
		if (existing !== null) {
			throw new ConvexError(`${type} request already pending`);
		}
		await ctx.db.insert("pendingRequests", {
			roomId: game.roomId,
			gameId,
			requesterUserId: userId,
			type,
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
		if (req === null) throw new ConvexError("Request not found");
		const room = await ctx.db.get(req.roomId);
		if (room === null || room.hostUserId !== userId) {
			throw new ConvexError("Only host can deny");
		}
		await ctx.db.patch(requestId, { status: "denied" });
		return null;
	},
});

export const _read = internalQuery({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		return await ctx.db.get(requestId);
	},
});

export const approve = action({
	args: { requestId: v.id("pendingRequests") },
	handler: async (
		ctx,
		{ requestId },
	): Promise<{ lemma: string; distance?: number }> => {
		const hostUserId = await requireUser(ctx);
		const req: Doc<"pendingRequests"> | null = await ctx.runQuery(
			internal.requests._read,
			{ requestId },
		);
		if (req === null || req.status !== "pending") {
			throw new ConvexError("Request not found or already handled");
		}
		switch (req.type) {
			case "hint":
				return await ctx.runAction(internal.hints._execute, {
					requestId,
					gameId: req.gameId,
					hostUserId,
					requesterUserId: req.requesterUserId,
				});
			case "giveup":
				return await ctx.runAction(internal.giveup._execute, {
					requestId,
					gameId: req.gameId,
					hostUserId,
				});
		}
	},
});
