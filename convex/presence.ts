import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { tryMemberByRoom } from "./access";

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
