import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import { decideRoomCleanup } from "./lib/cleanup";
import { onlineUserIdsForRoom } from "./presence";

export const _listActiveRoomsWithMembers = internalQuery({
	args: {},
	handler: async (ctx) => {
		const rooms = await ctx.db
			.query("rooms")
			.withIndex("by_status_lastActivity", (q) => q.eq("status", "active"))
			.collect();
		return await Promise.all(
			rooms.map(async (r) => {
				const members = await ctx.db
					.query("roomMembers")
					.withIndex("by_room", (q) => q.eq("roomId", r._id))
					.collect();
				return {
					_id: r._id,
					hostUserId: r.hostUserId,
					lastActivityAt: r.lastActivityAt,
					members: members.map((m) => ({
						userId: m.userId,
						joinedAt: m.joinedAt,
					})),
				};
			}),
		);
	},
});

export const _migrateHost = internalMutation({
	args: { roomId: v.id("rooms"), newHostUserId: v.id("users") },
	handler: async (ctx, { roomId, newHostUserId }) => {
		await ctx.db.patch(roomId, { hostUserId: newHostUserId });
	},
});

export const _endRoom = internalMutation({
	args: { roomId: v.id("rooms") },
	handler: async (ctx, { roomId }) => {
		await ctx.db.patch(roomId, { status: "ended" });
	},
});

export const tick = internalAction({
	args: {},
	handler: async (ctx) => {
		const rooms = await ctx.runQuery(
			internal.cleanup._listActiveRoomsWithMembers,
			{},
		);
		const now = Date.now();
		for (const r of rooms) {
			const online: Set<Id<"users">> = await onlineUserIdsForRoom(ctx, r._id);
			const decision = decideRoomCleanup({
				room: { hostUserId: r.hostUserId, lastActivityAt: r.lastActivityAt },
				members: r.members,
				onlineUserIds: online,
				now,
			});
			if (decision.kind === "migrateHost") {
				await ctx.runMutation(internal.cleanup._migrateHost, {
					roomId: r._id,
					newHostUserId: decision.newHostUserId,
				});
			} else if (decision.kind === "endRoom") {
				await ctx.runMutation(internal.cleanup._endRoom, { roomId: r._id });
			}
		}
	},
});
