import { v } from "convex/values";
import { playerFromUser } from "./lib/player";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getCurrentUserId, requireUser } from "./access";
import {
  answerRequest as answer,
  cancelRequest as cancel,
  listFriends,
  listIncoming,
  listOutgoing,
  relationshipBetween,
  sendRequest as send,
} from "./lib/friendship";

export const sendRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const sender = await requireUser(ctx);
    return { status: await send(ctx, sender, userId) };
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
    const [friends, incoming, outgoing] = await Promise.all(
      [listFriends, listIncoming, listOutgoing].map(async (list) =>
        loadFriendPlayers(ctx, await list(ctx, userId)),
      ),
    );
    friends.sort((a, b) => a.name.localeCompare(b.name));
    return { friends, incoming, outgoing };
  },
});
