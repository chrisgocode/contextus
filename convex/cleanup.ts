import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { expireGuest } from "./lib/accountLifecycle";
import { depart } from "./lib/roomMembership";

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
    const { hostMoved, roomEnded } = await depart(
      ctx,
      roomId,
      { reason: "idle" },
      Date.now(),
    );
    return { hostMoved, roomEnded };
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
  args: { now: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const page = await ctx.db
      .query("users")
      .withIndex("by_is_anonymous_and_guest_expires_at", (q) =>
        q.eq("isAnonymous", true).lte("guestExpiresAt", now),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    const guests = page.page;
    let remaining = GUEST_CLEANUP_ROW_BUDGET;
    let removed = 0;
    let interrupted = false;
    for (const guest of guests) {
      const result = await expireGuest(ctx, guest._id, remaining);
      remaining -= result.deleted;
      if (result.outcome === "anonymized") removed++;
      if (!result.done || remaining === 0) {
        interrupted = true;
        break;
      }
    }
    if (interrupted || !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.cleanup.removeExpiredGuests, {
        now,
        // Retry a partially processed page; deleted/anonymized rows leave
        // the index. Fully visited pages advance even past merge-owned Guests.
        cursor: interrupted ? args.cursor : page.continueCursor,
      });
    }
    return { removed };
  },
});

// Handles one page of active Rooms, then persists the cursor in a continuation.
// The cursor advances through the original index order even as Rooms end and
// leave it. Every Room decision re-reads current state in its own transaction;
// a fresh cron pass starts without a cursor and catches newly active Rooms.
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
