import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import {
  requireHostByRoom,
  requireRegisteredUser,
  requireUser,
} from "./access";
import { generateRoomCode } from "./lib/code";
import { loadPlayers } from "./lib/player";
import { upsertRoomActivity } from "./lib/roomActivity";

const MAX_CODE_RETRIES = 10;
const MAX_GUEST_ACTIVE_ROOMS = 3;
// ponytail: scans 100 memberships; add a per-user recent-group index if users outgrow it.
const MAX_RECENT_MEMBERSHIPS = 100;

async function requireGuestRoomSlot(
  ctx: Pick<MutationCtx, "db">,
  userId: Awaited<ReturnType<typeof requireUser>>,
) {
  const user = await ctx.db.get("users", userId);
  if (user?.isAnonymous !== true) return;
  const activeMemberships = await ctx.db
    .query("roomMembers")
    .withIndex("by_user_and_active", (q) =>
      q.eq("userId", userId).eq("active", true),
    )
    .take(MAX_GUEST_ACTIVE_ROOMS);
  if (activeMemberships.length >= MAX_GUEST_ACTIVE_ROOMS) {
    throw new ConvexError("Guest room limit reached");
  }
}

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
    await requireGuestRoomSlot(ctx, userId);
    const now = Date.now();
    const code = await generateUniqueRoomCode(ctx);

    const roomId = await ctx.db.insert("rooms", {
      code,
      hostUserId: userId,
      status: "active",
    });
    await ctx.db.insert("roomMembers", {
      roomId,
      userId,
      joinedAt: now,
      active: true,
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
      await requireGuestRoomSlot(ctx, userId);
      await ctx.db.insert("roomMembers", {
        roomId: room._id,
        userId,
        joinedAt: Date.now(),
        active: true,
      });
    }
    await upsertRoomActivity(ctx, room._id, Date.now());
    return { roomId: room._id };
  },
});

// The Host must stay a member: hand the room to the longest-standing
// remaining member, or end it when nobody is left.
// Returns whether the room is still active afterwards.
async function handOffHost(
  ctx: Pick<MutationCtx, "db">,
  room: Doc<"rooms">,
): Promise<boolean> {
  const remaining = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) => q.eq("roomId", room._id))
    .collect();
  const next = remaining.sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (next === undefined) {
    await ctx.db.patch("rooms", room._id, { status: "ended" });
    return false;
  }
  await ctx.db.patch("rooms", room._id, { hostUserId: next.userId });
  return room.status === "active";
}

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
      await ctx.db.delete("roomMembers", member._id);
    }
    const room = await ctx.db.get("rooms", roomId);
    if (room === null) return null;
    const stillActive =
      room.hostUserId === userId
        ? await handOffHost(ctx, room)
        : room.status === "active";
    if (stillActive) {
      await upsertRoomActivity(ctx, roomId, Date.now());
    }
    return null;
  },
});

export const endRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await requireHostByRoom(ctx, { roomId });
    await ctx.db.patch("rooms", roomId, { status: "ended" });
    const members = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
      .collect();
    for (const member of members) {
      await ctx.db.patch("roomMembers", member._id, { active: false });
    }
    return null;
  },
});

export const playAgain = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await requireRegisteredUser(ctx);
    const room = await ctx.db.get("rooms", roomId);
    if (room === null) throw new ConvexError("Room not found");
    const membership = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) =>
        q.eq("roomId", roomId).eq("userId", userId),
      )
      .unique();
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
    const now = Date.now();
    await ctx.db.patch("rooms", roomId, {
      code,
      hostUserId: userId,
      status: "active",
    });
    for (const member of members) {
      await ctx.db.patch("roomMembers", member._id, { active: true });
    }
    await upsertRoomActivity(ctx, roomId, now);
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
    const viewerId = await getAuthUserId(ctx);
    const viewerMembership =
      viewerId === null
        ? null
        : await ctx.db
            .query("roomMembers")
            .withIndex("by_room_user", (q) =>
              q.eq("roomId", room._id).eq("userId", viewerId),
            )
            .unique();
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
    const userId = await requireUser(ctx);
    const memberships = await ctx.db
      .query("roomMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
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
