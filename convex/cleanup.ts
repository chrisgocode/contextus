import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { expireGuest } from "./lib/accountLifecycle";
import { decideRoomCleanup } from "./lib/cleanup";
import { withdrawAllFor } from "./lib/pendingRequests";
import { closeRoom } from "./lib/roomLifecycle";
import { onlineUserIdsForRoom } from "./presence";

export const GUEST_CLEANUP_ROW_BUDGET = 100;

const ROOM_CLEANUP_PAGE_SIZE = 50;

export const _listActiveRoomIds = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("rooms")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ cursor, numItems: ROOM_CLEANUP_PAGE_SIZE });
    return {
      roomIds: result.page.map((r) => r._id),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
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
      await withdrawAllFor(ctx, { roomId, userId: decision.newHostUserId });
    } else if (decision.kind === "endRoom") {
      await closeRoom(ctx, roomId);
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
    let remaining = GUEST_CLEANUP_ROW_BUDGET;
    let removed = 0;
    for (const guest of guests) {
      const result = await expireGuest(ctx, guest._id, remaining);
      remaining -= result.deleted;
      if (result.done) removed++;
      if (!result.done || remaining === 0) break;
    }
    if (remaining === 0 || guests.length === 50) {
      await ctx.scheduler.runAfter(0, internal.cleanup.removeExpiredGuests, {
        now,
      });
    }
    return { removed };
  },
});

// Handles one page of active rooms, then schedules itself for the next page.
export const tick = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const {
      roomIds,
      isDone,
      continueCursor,
    }: { roomIds: Id<"rooms">[]; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(internal.cleanup._listActiveRoomIds, {
        cursor: cursor ?? null,
      });
    await Promise.all(
      roomIds.map((roomId) =>
        ctx.runMutation(internal.cleanup._cleanupRoom, { roomId }),
      ),
    );
    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.cleanup.tick, {
        cursor: continueCursor,
      });
    }
  },
});
