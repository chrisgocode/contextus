import { v } from "convex/values";
import { onlineFirst, statusOf } from "./lib/friendStatus";
import { playerFromUser } from "./lib/player";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUserId, requireRegisteredUser, requireUser } from "./access";
import {
  answerRequest as answer,
  cancelRequest as cancel,
  isSuggestable,
  listFriends,
  listIncoming,
  listOutgoing,
  relationshipBetween,
  sendRequest as send,
  sendRequestByUsername as sendByUsername,
  unfriend as removeFriend,
} from "./lib/friendship";
import {
  answer as answerInviteFor,
  expire as expireInvite,
  invite as inviteFriend,
  invitedAmong,
  listOpenFor,
} from "./lib/invites";
import { isLiveMember } from "./lib/roomMembership";

export const sendRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const sender = await requireUser(ctx);
    return { status: await send(ctx, sender, userId) };
  },
});

export const sendRequestByUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const sender = await requireUser(ctx);
    return { status: await sendByUsername(ctx, sender, username) };
  },
});

export const answerRequest = mutation({
  args: {
    userId: v.id("users"),
    answer: v.union(v.literal("accept"), v.literal("decline")),
  },
  handler: async (ctx, args) => {
    const recipient = await requireUser(ctx);
    await answer(ctx, recipient, args.userId, args.answer);
    return null;
  },
});

export const cancelRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const sender = await requireUser(ctx);
    await cancel(ctx, sender, userId);
    return null;
  },
});

export const unfriend = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await requireUser(ctx);
    await removeFriend(ctx, user, userId);
    return null;
  },
});

export const relationship = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const viewer = await getCurrentUserId(ctx);
    if (viewer === null) return null;
    return await relationshipBetween(ctx, viewer, userId);
  },
});

export const invite = mutation({
  args: { roomId: v.id("rooms"), userId: v.id("users") },
  handler: async (ctx, { roomId, userId }) => {
    const sender = await requireRegisteredUser(ctx);
    await inviteFriend(ctx, sender, userId, roomId, Date.now());
    return null;
  },
});

export const answerInvite = mutation({
  args: {
    inviteId: v.id("invites"),
    answer: v.union(v.literal("join"), v.literal("decline")),
  },
  handler: async (ctx, args) => {
    const recipient = await requireUser(ctx);
    const code = await answerInviteFor(
      ctx,
      recipient,
      args.inviteId,
      args.answer,
      Date.now(),
    );
    return code === null ? null : { code };
  },
});

export const _expireInvite = internalMutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    await expireInvite(ctx, inviteId, Date.now());
    return null;
  },
});

async function loadFriendPlayers(ctx: QueryCtx, ids: Id<"users">[]) {
  const players = await Promise.all(
    ids.map(async (id) => {
      const user = await ctx.db.get("users", id);
      return {
        ...(await playerFromUser(ctx, id, user)),
        username: user?.username ?? null,
      };
    }),
  );
  return players.filter((player) => player.exists);
}

// Everything the friends panel shows, in one subscription. Given a Room the
// viewer is in, it also says which of their Friends are in it or invited.
export const overview = query({
  args: { roomId: v.optional(v.id("rooms")) },
  handler: async (ctx, { roomId }) => {
    const userId = await getCurrentUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    if (user === null || user.isAnonymous === true) return null;
    const [friendIds, { senders, more }, recipientIds] = await Promise.all([
      listFriends(ctx, userId),
      listIncoming(ctx, userId),
      listOutgoing(ctx, userId),
    ]);
    const [friends, incoming, outgoing] = await Promise.all(
      [friendIds, senders, recipientIds].map((ids) =>
        loadFriendPlayers(ctx, ids),
      ),
    );
    const friendsWithStatus = await Promise.all(
      friends.map(async (friend) => ({
        ...friend,
        status: await statusOf(ctx, friend.id),
      })),
    );
    friendsWithStatus.sort(
      (a, b) => onlineFirst(a.status, b.status) || a.name.localeCompare(b.name),
    );
    const now = Date.now();
    const [invites, room] = await Promise.all([
      loadInvites(ctx, userId, now),
      roomId === undefined
        ? null
        : friendsInRoom(ctx, userId, roomId, friendIds, now),
    ]);
    return {
      friends: friendsWithStatus,
      incoming,
      moreIncoming: more,
      outgoing,
      appearOffline: user.appearOffline === true,
      invites,
      room,
    };
  },
});

const MAX_SUGGESTIONS = 3;
// Bounds on the scan: the viewer's newest memberships, and the member rows
// read across their Rooms.
const MAX_SUGGESTION_ROOMS = 100;
const MAX_SUGGESTION_MEMBER_ROWS = 1000;

export const suggestions = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getCurrentUserId(ctx);
    if (viewer === null) return [];
    const user = await ctx.db.get("users", viewer);
    if (user === null || user.isAnonymous === true) return [];
    const memberships = await ctx.db
      .query("roomMembers")
      .withIndex("by_user", (q) => q.eq("userId", viewer))
      .order("desc")
      .take(MAX_SUGGESTION_ROOMS);
    const rooms = await Promise.all(
      memberships.map(async ({ roomId }) => {
        const activity = await ctx.db
          .query("roomActivity")
          .withIndex("by_room", (q) => q.eq("roomId", roomId))
          .unique();
        return { roomId, lastActivityAt: activity?.lastActivityAt ?? 0 };
      }),
    );
    rooms.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    const seen = new Set<Id<"users">>([viewer]);
    const suggested: Id<"users">[] = [];
    let rowBudget = MAX_SUGGESTION_MEMBER_ROWS;
    for (const { roomId } of rooms) {
      if (suggested.length === MAX_SUGGESTIONS || rowBudget <= 0) break;
      const members = await ctx.db
        .query("roomMembers")
        .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
        .take(rowBudget);
      rowBudget -= members.length;
      members.sort((a, b) => b.joinedAt - a.joinedAt);
      for (const { userId } of members) {
        if (suggested.length === MAX_SUGGESTIONS) break;
        if (seen.has(userId)) continue;
        seen.add(userId);
        if (await isSuggestable(ctx, viewer, userId)) suggested.push(userId);
      }
    }
    return await loadFriendPlayers(ctx, suggested);
  },
});

// The viewer's open Invites, for the toast shown on every page.
export const openInvites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    if (userId === null) return [];
    return await loadInvites(ctx, userId, Date.now());
  },
});

async function loadInvites(ctx: QueryCtx, userId: Id<"users">, now: number) {
  const rows = await listOpenFor(ctx, userId, now);
  const invites = await Promise.all(
    rows.map(async (row) => {
      const [room, sender] = await Promise.all([
        ctx.db.get("rooms", row.roomId),
        ctx.db.get("users", row.senderUserId),
      ]);
      if (room === null || room.status !== "active") return null;
      return {
        _id: row._id,
        roomCode: room.code,
        expiresAt: row.expiresAt,
        sender: {
          ...(await playerFromUser(ctx, row.senderUserId, sender)),
          username: sender?.username ?? null,
        },
      };
    }),
  );
  return invites.filter((invite) => invite !== null);
}

async function friendsInRoom(
  ctx: QueryCtx,
  viewer: Id<"users">,
  roomId: Id<"rooms">,
  friendIds: Id<"users">[],
  now: number,
) {
  const room = await ctx.db.get("rooms", roomId);
  if (room === null || !(await isLiveMember(ctx, room, viewer))) return null;
  const live = await Promise.all(
    friendIds.map((id) => isLiveMember(ctx, room, id)),
  );
  const members = friendIds.filter((_, i) => live[i]);
  const invited = await invitedAmong(ctx, roomId, friendIds, now);
  return { invited, members };
}
