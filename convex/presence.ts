import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId, tryMemberByRoom } from "./access";
import { APP_PRESENCE_ROOM } from "./lib/friendStatus";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, { roomId, sessionId, interval }) => {
    const normalized = ctx.db.normalizeId("rooms", roomId);
    if (normalized === null) throw new Error("Invalid room id");
    const access = await tryMemberByRoom(ctx, { roomId: normalized });
    if (access === null) return null;
    return await presence.heartbeat(
      ctx,
      normalized,
      access.userId,
      sessionId,
      interval,
    );
  },
});

// Marks a registered user as having Contextus open, for Friend status. Only
// the session token comes back: the app-wide room token would let anyone list
// everyone online, Appear offline users included.
export const appHeartbeat = mutation({
  args: { sessionId: v.string(), interval: v.number() },
  handler: async (ctx, { sessionId, interval }) => {
    const userId = await getCurrentUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get("users", userId);
    if (user === null || user.isAnonymous === true) return null;
    const { sessionToken } = await presence.heartbeat(
      ctx,
      APP_PRESENCE_ROOM,
      userId,
      sessionId,
      interval,
    );
    return { sessionToken };
  },
});

// No membership check: list and disconnect take the component's random room
// and session tokens, which heartbeat hands out only to room members. Room ids
// appear in URLs, so they are not accepted in place of a token.
export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, { roomToken }) => {
    return await presence.list(ctx, roomToken);
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    return await presence.disconnect(ctx, sessionToken);
  },
});
