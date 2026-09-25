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
import { deleteUserOwnedRows } from "./lib/userRows";
import { onlineUserIdsForRoom } from "./presence";

export const _listActiveRoomIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return rooms.map((r) => r._id);
  },
});

// Decides and writes in one transaction so a join, guess, host change, or
// returning host between the read and the write can't be overwritten.
export const _cleanupRoom = internalMutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get("rooms", roomId);
    if (room === null || room.status !== "active") return { kind: "noop" };
    const [members, activity, online] = await Promise.all([
      ctx.db
        .query("roomMembers")
        .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
        .collect(),
      ctx.db
        .query("roomActivity")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .unique(),
      onlineUserIdsForRoom(ctx, roomId),
    ]);
    const decision = decideRoomCleanup({
      room: {
        hostUserId: room.hostUserId,
        lastActivityAt: activity?.lastActivityAt ?? 0,
      },
      members: members
        .filter((m) => m.active !== false)
        .map((m) => ({ userId: m.userId, joinedAt: m.joinedAt })),
      onlineUserIds: online,
      now: Date.now(),
    });
    if (decision.kind === "migrateHost") {
      await ctx.db.patch("rooms", roomId, {
        hostUserId: decision.newHostUserId,
      });
    } else if (decision.kind === "endRoom") {
      await ctx.db.patch("rooms", roomId, { status: "ended" });
      for (const member of members) {
        await ctx.db.patch("roomMembers", member._id, { active: false });
      }
    }
    return decision;
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
    const guest = await ctx.db.get("users", guestUserId);
    if (guest?.isAnonymous !== true) return null;
    await deleteGuestAuthData(ctx, guestUserId);
    await ctx.db.delete("users", guestUserId);
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
  await deleteUserOwnedRows(ctx, guestUserId);
  const stats = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .unique();
  if (stats !== null) await ctx.db.delete("userAchievementStats", stats._id);
  await deleteGuestAuthData(ctx, guestUserId);
  await ctx.db.patch("users", guestUserId, {
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
    for (const code of codes)
      await ctx.db.delete("authVerificationCodes", code._id);
    await ctx.db.delete("authAccounts", account._id);
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
    for (const token of tokens)
      await ctx.db.delete("authRefreshTokens", token._id);
    await ctx.db.delete("authSessions", session._id);
  }
}

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const roomIds = await ctx.runQuery(internal.cleanup._listActiveRoomIds, {});
    for (const roomId of roomIds) {
      await ctx.runMutation(internal.cleanup._cleanupRoom, { roomId });
    }
  },
});
