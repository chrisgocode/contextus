import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { generateRoomCode } from "./lib/code";
import type { Doc } from "./_generated/dataModel";

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
      lastActivityAt: now,
    });
    await ctx.db.insert("roomMembers", {
      roomId,
      userId,
      joinedAt: now,
    });
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
    await ctx.db.patch(room._id, { lastActivityAt: Date.now() });
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
      await ctx.db.patch(roomId, { lastActivityAt: Date.now() });
    }
    return null;
  },
});

export const endRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db.get(roomId);
    if (room === null) throw new ConvexError("Room not found");
    if (room.hostUserId !== userId) {
      throw new ConvexError("Only host can end the room");
    }
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
    return { room, members: memberDocs };
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
    const rooms: Doc<"rooms">[] = [];
    for (const m of memberships) {
      const room = await ctx.db.get(m.roomId);
      if (room !== null && room.status === "active") rooms.push(room);
    }
    rooms.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return rooms.slice(0, 10);
  },
});

