import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	action,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import {
	requireHostByRoom,
	requireMemberByGame,
	requireUser,
	tryMemberByGame,
} from "./access";

const REQUEST_TYPE = v.union(v.literal("hint"), v.literal("giveup"));

export const listPending = query({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const access = await tryMemberByGame(ctx, { gameId });
		if (access === null) return [];
		const { user, room } = access;
		const userId = user._id;
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
		const { user, room, game } = await requireMemberByGame(ctx, { gameId });
		const userId = user._id;
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		if (room.hostUserId === userId) {
			throw new ConvexError(
				`Host should use the direct ${type} action`,
			);
		}
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
		const req = await ctx.db.get(requestId);
		if (req === null) throw new ConvexError("Request not found");
		await requireHostByRoom(ctx, { roomId: req.roomId });
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
		await requireUser(ctx);
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
					requesterUserId: req.requesterUserId,
				});
			case "giveup":
				return await ctx.runAction(internal.giveup._execute, {
					requestId,
					gameId: req.gameId,
				});
		}
	},
});
