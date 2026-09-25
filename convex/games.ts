import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  requireHostByRoom,
  requireUser,
  tryMemberByGame,
  tryMemberByRoom,
} from "./access";
import { upsertRoomActivity } from "./lib/roomActivity";
import { loadPlayers } from "./lib/player";

export const start = mutation({
  args: { roomId: v.id("rooms"), contextoGameId: v.number() },
  handler: async (ctx, { roomId, contextoGameId }) => {
    const { userId, room } = await requireHostByRoom(ctx, { roomId });
    if (room.status !== "active") {
      throw new ConvexError("Room not found");
    }
    if (contextoGameId < 1) {
      throw new ConvexError("Invalid game id");
    }
    const existing = await ctx.db
      .query("games")
      .withIndex("by_room_status", (q) =>
        q.eq("roomId", roomId).eq("status", "in_progress"),
      )
      .first();
    if (existing !== null) {
      throw new ConvexError("A game is already in progress");
    }
    const now = Date.now();
    const gameId = await ctx.db.insert("games", {
      roomId,
      contextoGameId,
      status: "in_progress",
      startedAt: now,
    });
    await upsertHistory(ctx, userId, contextoGameId);
    await upsertRoomActivity(ctx, roomId, now);
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

export const getById = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const access = await tryMemberByGame(ctx, { gameId });
    if (access === null) return null;
    const { game } = access;
    const players = await loadPlayers(
      ctx,
      game.winnerUserId === undefined ? [] : [game.winnerUserId],
    );
    return {
      ...game,
      winner:
        game.winnerUserId === undefined
          ? null
          : players.get(game.winnerUserId)!,
    };
  },
});

export const listMyHistory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
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
