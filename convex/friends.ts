import { v } from "convex/values";
import { onlineFirst, statusOf } from "./lib/friendStatus";
import { playerFromUser } from "./lib/player";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUserId, requireUser } from "./access";
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

// Everything the friends panel shows, in one subscription.
export const overview = query({
  args: {},
  handler: async (ctx) => {
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
    return {
      friends: friendsWithStatus,
      incoming,
      moreIncoming: more,
      outgoing,
      appearOffline: user.appearOffline === true,
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
