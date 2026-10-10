import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId, requireHostByRoom, tryMemberByRoom } from "./access";
import { appError } from "./lib/errors";
import { touchRoomActivity } from "./lib/roomMembership";
import { track } from "./analytics";

export const start = mutation({
  args: { roomId: v.id("rooms"), contextoGameId: v.number() },
  handler: async (ctx, { roomId, contextoGameId }) => {
    const { userId, room } = await requireHostByRoom(ctx, { roomId });
    if (room.status !== "active") {
      throw appError("roomNotFound");
    }
    if (!Number.isInteger(contextoGameId) || contextoGameId < 1) {
      throw new ConvexError("Invalid game id");
    }
    const existing = await ctx.db
      .query("games")
      .withIndex("by_room_status", (q) =>
        q.eq("roomId", roomId).eq("status", "in_progress"),
      )
      .first();
    if (existing !== null) {
      throw appError("gameInProgress");
    }
    const previous = await ctx.db
      .query("games")
      .withIndex("by_room_started", (q) => q.eq("roomId", roomId))
      .order("desc")
      .first();
    const now = Date.now();
    const gameId = await ctx.db.insert("games", {
      roomId,
      contextoGameId,
      status: "in_progress",
      realGuessCount: 0,
      startedAt: now,
    });
    await upsertHistory(ctx, userId, contextoGameId);
    await touchRoomActivity(ctx, roomId, now);
    await track(ctx, userId, {
      name: "game_started",
      properties: {
        game_id: gameId,
        room_id: roomId,
        contexto_game_id: contextoGameId,
        play_again: previous !== null,
      },
    });
    return { gameId };
  },
});

export const getActive = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const access = await tryMemberByRoom(ctx, { roomId });
    if (access === null) return null;
    return await ctx.db
      .query("games")
      .withIndex("by_room_status", (q) =>
        q.eq("roomId", roomId).eq("status", "in_progress"),
      )
      .first();
  },
});

export const listMyHistory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.contextoGameId);
  },
});

export const listFinished = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const access = await tryMemberByRoom(ctx, { roomId });
    if (access === null) return [];
    return await ctx.db
      .query("games")
      .withIndex("by_room_started", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(20);
  },
});

export async function upsertHistory(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  contextoGameId: number,
): Promise<void> {
  const existing = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) =>
      q.eq("userId", userId).eq("contextoGameId", contextoGameId),
    )
    .unique();
  if (existing === null) {
    await ctx.db.insert("userGameHistory", {
      userId,
      contextoGameId,
      firstPlayedAt: Date.now(),
    });
  }
}
