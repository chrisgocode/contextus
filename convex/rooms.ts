import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import {
  getCurrentUserId,
  requireHostByRoom,
  requireRegisteredUser,
  requireUser,
} from "./access";
import { generateRoomCode } from "./lib/code";
import { track } from "./analytics";
import { loadPlayers } from "./lib/player";
import { enforceRateLimit } from "./lib/rateLimits";
import {
  admit,
  closeRoom,
  depart,
  findMembership,
  openRoom,
  reopenRoom,
} from "./lib/roomMembership";

const MAX_CODE_RETRIES = 10;
// ponytail: scans 100 memberships; add a per-user recent-group index if users outgrow it.
const MAX_RECENT_MEMBERSHIPS = 100;
// listMine ranks at most this many of the newest active memberships. Idle
// rooms end after 30 minutes, so hitting this needs 50+ live rooms at once.
const MAX_ACTIVE_MEMBERSHIPS = 50;

async function generateUniqueRoomCode(ctx: Pick<MutationCtx, "db">) {
  for (let i = 0; i < MAX_CODE_RETRIES; i++) {
    const candidate = generateRoomCode();
    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", candidate))
      .unique();
    if (existing === null) return candidate;
  }
  throw new ConvexError("Could not generate unique room code");
}

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    await enforceRateLimit(ctx, "createRoom", userId);
    const code = await generateUniqueRoomCode(ctx);
    const roomId = await openRoom(
      ctx,
      { code, hostUserId: userId },
      Date.now(),
    );
    await track(ctx, userId, {
      name: "room_created",
      properties: { room_id: roomId },
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
    if (await admit(ctx, room._id, userId, Date.now())) {
      // Capped like playAgain's Room size limit; 101 means "over 100".
      const memberCount = (
        await ctx.db
          .query("roomMembers")
          .withIndex("by_room_user", (q) => q.eq("roomId", room._id))
          .take(101)
      ).length;
      await track(ctx, userId, {
        name: "room_joined",
        properties: { room_id: room._id, member_count: memberCount },
      });
    }
    return { roomId: room._id };
  },
});

export const leave = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await requireUser(ctx);
    const { wasMember, hostMoved, roomEnded } = await depart(
      ctx,
      roomId,
      { reason: "left", userId },
      Date.now(),
    );
    if (wasMember) {
      await track(ctx, userId, {
        name: "room_left",
        properties: {
          room_id: roomId,
          host_moved: hostMoved,
          room_ended: roomEnded,
        },
      });
    }
    return null;
  },
});

export const endRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const { userId, room } = await requireHostByRoom(ctx, { roomId });
    if (room.status !== "active") return null;
    const members = await closeRoom(ctx, roomId);
    await track(ctx, userId, {
      name: "room_ended",
      properties: { room_id: roomId, member_count: members.length },
    });
    return null;
  },
});

export const playAgain = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await requireRegisteredUser(ctx);
    const room = await ctx.db.get("rooms", roomId);
    if (room === null) throw new ConvexError("Room not found");
    const membership = await findMembership(ctx, roomId, userId);
    if (membership === null) throw new ConvexError("Not a room member");
    if (room.status === "active") return { roomId, code: room.code };

    const members = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
      .take(101);
    if (members.length < 2) throw new ConvexError("Group not found");
    if (members.length > 100) throw new ConvexError("Room is too large");
    const users = await Promise.all(
      members.map((member) => ctx.db.get("users", member.userId)),
    );
    if (users.some((user) => user === null || user.isAnonymous === true)) {
      throw new ConvexError("Registered accounts required");
    }

    const code = await generateUniqueRoomCode(ctx);
    await reopenRoom(
      ctx,
      roomId,
      { code, hostUserId: userId },
      members,
      Date.now(),
    );
    return { roomId, code };
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
    const viewerId = await getCurrentUserId(ctx);
    const viewerMembership =
      viewerId === null ? null : await findMembership(ctx, room._id, viewerId);
    const members =
      viewerMembership === null
        ? []
        : await ctx.db
            .query("roomMembers")
            .withIndex("by_room_user", (q) => q.eq("roomId", room._id))
            .collect();
    const players = await loadPlayers(
      ctx,
      members.map((m) => m.userId),
    );
    const memberDocs = members.map((m) => ({
      userId: m.userId,
      player: players.get(m.userId)!,
      joinedAt: m.joinedAt,
      isHost: m.userId === room.hostUserId,
    }));
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
    const userId = await getCurrentUserId(ctx);
    if (userId === null) return [];
    // Memberships created before the `active` flag have no value; newer
    // writes always set it, so that set can't grow.
    const byActive = (active: true | undefined) =>
      ctx.db
        .query("roomMembers")
        .withIndex("by_user_and_active", (q) =>
          q.eq("userId", userId).eq("active", active),
        )
        .order("desc")
        .take(MAX_ACTIVE_MEMBERSHIPS);
    const memberships = (
      await Promise.all([byActive(true), byActive(undefined)])
    ).flat();
    const fetched = await Promise.all(
      memberships.map((m) => ctx.db.get("rooms", m.roomId)),
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

export const listRecentGroups = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireRegisteredUser(ctx);
    const memberships = await ctx.db
      .query("roomMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_RECENT_MEMBERSHIPS);
    const rooms = await Promise.all(
      memberships.map(async ({ roomId }) => {
        const room = await ctx.db.get("rooms", roomId);
        if (room?.status !== "ended") return null;
        const [activity, rows] = await Promise.all([
          ctx.db
            .query("roomActivity")
            .withIndex("by_room", (q) => q.eq("roomId", roomId))
            .unique(),
          ctx.db
            .query("roomMembers")
            .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
            .take(101),
        ]);
        if (rows.length < 2 || rows.length > 100) return null;
        const players = await loadPlayers(
          ctx,
          rows.map((m) => m.userId),
        );
        const members = rows.map((member) => {
          const player = players.get(member.userId)!;
          if (!player.exists || player.isGuest) return null;
          return { userId: member.userId, player, joinedAt: member.joinedAt };
        });
        if (members.some((member) => member === null)) return null;
        return {
          roomId,
          lastActivityAt: activity?.lastActivityAt ?? room._creationTime,
          members: members
            .filter((member) => member !== null)
            .sort((a, b) => a.joinedAt - b.joinedAt),
        };
      }),
    );
    const unique = new Map<string, NonNullable<(typeof rooms)[number]>>();
    for (const room of rooms
      .filter((candidate) => candidate !== null)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)) {
      const participantKey = room.members
        .map((member) => member.userId)
        .sort()
        .join(":");
      if (!unique.has(participantKey)) unique.set(participantKey, room);
    }
    return [...unique.values()].slice(0, 3);
  },
});
