import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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
			.withIndex("by_status", (q) => q.eq("status", "active"))
			.collect();
		return await Promise.all(
			rooms.map(async (r) => {
				const [members, activity] = await Promise.all([
					ctx.db
						.query("roomMembers")
						.withIndex("by_room", (q) => q.eq("roomId", r._id))
						.collect(),
					ctx.db
						.query("roomActivity")
						.withIndex("by_room", (q) => q.eq("roomId", r._id))
						.unique(),
				]);
				return {
					_id: r._id,
					hostUserId: r.hostUserId,
					lastActivityAt: activity?.lastActivityAt ?? 0,
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
		const members = await ctx.db
			.query("roomMembers")
			.withIndex("by_room", (q) => q.eq("roomId", roomId))
			.collect();
		for (const member of members) {
			await ctx.db.patch(member._id, { active: false });
		}
	},
});

export const _backfillRoomActivity = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rooms = await ctx.db.query("rooms").collect();
		let inserted = 0;
		for (const r of rooms) {
			const existing = await ctx.db
				.query("roomActivity")
				.withIndex("by_room", (q) => q.eq("roomId", r._id))
				.unique();
			if (existing === null) {
				await ctx.db.insert("roomActivity", {
					roomId: r._id,
					lastActivityAt: r._creationTime,
				});
				inserted += 1;
			}
		}
		return { inserted, scanned: rooms.length };
	},
});

export const removeMergedGuest = internalMutation({
	args: { guestUserId: v.id("users") },
	handler: async (ctx, { guestUserId }) => {
		const guest = await ctx.db.get(guestUserId);
		if (guest?.isAnonymous !== true) return null;
		await deleteGuestAuthData(ctx, guestUserId);
		await ctx.db.delete(guestUserId);
		return null;
	},
});

export const removeExpiredGuests = internalMutation({
	args: { now: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const now = args.now ?? Date.now();
		const guests = await ctx.db
			.query("users")
			.withIndex("by_is_anonymous_and_guest_expires_at", (q) =>
				q.eq("isAnonymous", true).lte("guestExpiresAt", now),
			)
			.take(50);
		for (const guest of guests) {
			await anonymizeExpiredGuest(ctx, guest._id);
		}
		if (guests.length === 50) {
			await ctx.scheduler.runAfter(0, internal.cleanup.removeExpiredGuests, {
				now,
			});
		}
		return { removed: guests.length };
	},
});

async function anonymizeExpiredGuest(
	ctx: MutationCtx,
	guestUserId: Id<"users">,
) {
	for (const table of [
		"roomMembers",
		"userGameHistory",
		"userAchievements",
		"userAchievementProgress",
		"gamePlayerStats",
	] as const) {
		const rows = await ctx.db
			.query(table)
			.withIndex("by_user", (q) => q.eq("userId", guestUserId))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
	}
	const stats = await ctx.db
		.query("userAchievementStats")
		.withIndex("by_user", (q) => q.eq("userId", guestUserId))
		.unique();
	if (stats !== null) await ctx.db.delete(stats._id);
	await deleteGuestAuthData(ctx, guestUserId);
	await ctx.db.patch(guestUserId, {
		name: "Former Guest",
		image: undefined,
		email: undefined,
		username: undefined,
		displayUsername: undefined,
		isAnonymous: false,
		guestCompletedGames: undefined,
		guestPromptedGames: undefined,
		guestExpiresAt: undefined,
	});
}

async function deleteGuestAuthData(ctx: MutationCtx, guestUserId: Id<"users">) {
	const accounts = await ctx.db
		.query("authAccounts")
		.withIndex("userIdAndProvider", (q) => q.eq("userId", guestUserId))
		.collect();
	for (const account of accounts) {
		const codes = await ctx.db
			.query("authVerificationCodes")
			.withIndex("accountId", (q) => q.eq("accountId", account._id))
			.collect();
		for (const code of codes) await ctx.db.delete(code._id);
		await ctx.db.delete(account._id);
	}
	const sessions = await ctx.db
		.query("authSessions")
		.withIndex("userId", (q) => q.eq("userId", guestUserId))
		.collect();
	for (const session of sessions) {
		const tokens = await ctx.db
			.query("authRefreshTokens")
			.withIndex("sessionId", (q) => q.eq("sessionId", session._id))
			.collect();
		for (const token of tokens) await ctx.db.delete(token._id);
		await ctx.db.delete(session._id);
	}
}

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
