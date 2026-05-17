import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser } from "./auth_helpers";
import type { Doc, Id } from "./_generated/dataModel";

export async function isMember(
  ctx: { db: any },
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<boolean> {
  const member = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q: any) =>
      q.eq("roomId", roomId).eq("userId", userId),
    )
    .unique();
  return member !== null;
}

export async function assertMember(
  ctx: { db: any },
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<void> {
  if (!(await isMember(ctx, roomId, userId))) {
    throw new ConvexError("Not a member of this room");
  }
}

export const start = mutation({
  args: { roomId: v.id("rooms"), contextoGameId: v.number() },
  handler: async (ctx, { roomId, contextoGameId }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db.get(roomId);
    if (room === null || room.status !== "active") {
      throw new ConvexError("Room not found");
    }
    if (room.hostUserId !== userId) {
      throw new ConvexError("Only host can start a game");
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
    await ctx.db.patch(roomId, { lastActivityAt: now });
    return { gameId };
  },
});

export const getActive = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await requireUser(ctx);
    if (!(await isMember(ctx, roomId, userId))) return null;
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
    const userId = await requireUser(ctx);
    const game = await ctx.db.get(gameId);
    if (game === null) return null;
    await assertMember(ctx, game.roomId, userId);
    let winner: Doc<"users"> | null = null;
    if (game.winnerUserId !== undefined) {
      winner = await ctx.db.get(game.winnerUserId);
    }
    return {
      ...game,
      winnerName: winner?.name ?? null,
      winnerImage: winner?.image ?? null,
    };
  },
});

export const listMyHistory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("userGameHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.contextoGameId);
  },
});

export const listFinished = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await requireUser(ctx);
    if (!(await isMember(ctx, roomId, userId))) return [];
    return await ctx.db
      .query("games")
      .withIndex("by_room_started", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(20);
  },
});

export async function upsertHistory(
  ctx: { db: any },
  userId: Id<"users">,
  contextoGameId: number,
): Promise<void> {
  const existing = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q: any) =>
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

// internal mutation used by guesses.submit action
export const _recordHistory = internalMutation({
  args: { userId: v.id("users"), contextoGameId: v.number() },
  handler: async (ctx, { userId, contextoGameId }) => {
    await upsertHistory(ctx, userId, contextoGameId);
  },
});
