import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireHostByRoom, requireUser } from "./access";
import { generateRoomCode } from "./lib/code";
import { upsertRoomActivity } from "./lib/roomActivity";

const MAX_CODE_RETRIES = 10;

export const create = mutation({
	args: {},
	handler: async (ctx) => {
		const userId = await requireUser(ctx);
		const now = Date.now();

		let code: string | null = null;
		for (let i = 0; i < MAX_CODE_RETRIES; i++) {
			const candidate = generateRoomCode();
			const existing = await ctx.db
				.query("rooms")
				.withIndex("by_code", (q) => q.eq("code", candidate))
				.unique();
			if (existing === null) {
				code = candidate;
				break;
			}
		}
		if (code === null) {
			throw new ConvexError("Could not generate unique room code");
		}

		const roomId = await ctx.db.insert("rooms", {
			code,
			hostUserId: userId,
			status: "active",
		});
		await ctx.db.insert("roomMembers", {
			roomId,
			userId,
			joinedAt: now,
		});
		await upsertRoomActivity(ctx, roomId, now);
		return { code, roomId };
	},
});

export const join = mutation({
	args: { code: v.string() },
	handler: async (ctx, { code }) => {
		const userId = await requireUser(ctx);
		const normalized = code.toUpperCase().trim();
		const room = await ctx.db
			.query("rooms")
			.withIndex("by_code", (q) => q.eq("code", normalized))
			.unique();
		if (room === null || room.status !== "active") {
			throw new ConvexError("Room not found");
		}
		const existing = await ctx.db
			.query("roomMembers")
			.withIndex("by_room_user", (q) =>
				q.eq("roomId", room._id).eq("userId", userId),
			)
			.unique();
		if (existing === null) {
			await ctx.db.insert("roomMembers", {
				roomId: room._id,
				userId,
				joinedAt: Date.now(),
			});
		}
		await upsertRoomActivity(ctx, room._id, Date.now());
		return { roomId: room._id };
	},
});

export const leave = mutation({
	args: { roomId: v.id("rooms") },
	handler: async (ctx, { roomId }) => {
		const userId = await requireUser(ctx);
		const member = await ctx.db
			.query("roomMembers")
			.withIndex("by_room_user", (q) =>
				q.eq("roomId", roomId).eq("userId", userId),
			)
			.unique();
		if (member !== null) {
			await ctx.db.delete(member._id);
		}
		const room = await ctx.db.get(roomId);
		if (room !== null && room.status === "active") {
			await upsertRoomActivity(ctx, roomId, Date.now());
		}
		return null;
	},
});

export const endRoom = mutation({
	args: { roomId: v.id("rooms") },
	handler: async (ctx, { roomId }) => {
		await requireHostByRoom(ctx, { roomId });
		await ctx.db.patch(roomId, { status: "ended" });
		return null;
	},
});

export const getByCode = query({
	args: { code: v.string() },
	handler: async (ctx, { code }) => {
		const normalized = code.toUpperCase().trim();
		const room = await ctx.db
			.query("rooms")
			.withIndex("by_code", (q) => q.eq("code", normalized))
			.unique();
		if (room === null) return null;
		const viewerId = await getAuthUserId(ctx);
		const members = await ctx.db
			.query("roomMembers")
			.withIndex("by_room", (q) => q.eq("roomId", room._id))
			.collect();
		const memberDocs = await Promise.all(
			members.map(async (m) => {
				const user = await ctx.db.get(m.userId);
				return {
					userId: m.userId,
					name: user?.name ?? null,
					image: user?.image ?? null,
					email: user?.email ?? null,
					joinedAt: m.joinedAt,
					isHost: m.userId === room.hostUserId,
				};
			}),
		);
		memberDocs.sort((a, b) => a.joinedAt - b.joinedAt);
		return {
			room,
			members: memberDocs,
			viewerUserId: viewerId,
			isViewerHost: viewerId !== null && viewerId === room.hostUserId,
		};
	},
});

export const listMine = query({
	args: {},
	handler: async (ctx) => {
		const userId = await requireUser(ctx);
		const memberships = await ctx.db
			.query("roomMembers")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		const fetched = await Promise.all(
			memberships.map((m) => ctx.db.get(m.roomId)),
		);
		const rooms = fetched.filter(
			(r): r is Doc<"rooms"> => r !== null && r.status === "active",
		);
		const activities = await Promise.all(
			rooms.map((r) =>
				ctx.db
					.query("roomActivity")
					.withIndex("by_room", (q) => q.eq("roomId", r._id))
					.unique(),
			),
		);
		const withActivity = rooms.map((r, i) => ({
			room: r,
			lastActivityAt: activities[i]?.lastActivityAt ?? 0,
		}));
		withActivity.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
		return withActivity.slice(0, 10).map((w) => w.room);
	},
});
