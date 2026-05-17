import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { Presence } from "@convex-dev/presence";
import { requireUser } from "./auth_helpers";
import { assertMember } from "./games";
import type { Id } from "./_generated/dataModel";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, { roomId, sessionId, interval }) => {
    const authedUserId = await requireUser(ctx);
    const normalized = ctx.db.normalizeId("rooms", roomId);
    if (normalized === null) throw new Error("Invalid room id");
    await assertMember(ctx, normalized, authedUserId);
    return await presence.heartbeat(
      ctx,
      normalized,
      authedUserId,
      sessionId,
      interval,
    );
  },
});

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

export async function onlineUserIdsForRoom(
  ctx: { runQuery: any } | any,
  roomId: Id<"rooms">,
): Promise<Set<Id<"users">>> {
  const list = await presence.listRoom(ctx, roomId);
  const out = new Set<Id<"users">>();
  for (const entry of list) {
    out.add(entry.userId as Id<"users">);
  }
  return out;
}
