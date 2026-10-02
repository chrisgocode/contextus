import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  requireHostByRoom,
  requireMemberByGame,
  tryMemberByGame,
} from "./access";
import { performTurn } from "./turns";
import { loadPlayers } from "./lib/player";
import { track } from "./analytics";

const REQUEST_TYPE = v.union(v.literal("hint"), v.literal("giveup"));

// A request nobody answers expires after this long.
const REQUEST_TTL_MS = 60_000;

export const listPending = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const access = await tryMemberByGame(ctx, { gameId });
    if (access === null) return [];
    const { userId, room } = access;
    const isHost = room.hostUserId === userId;
    const rowsRaw = await ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) =>
        q.eq("gameId", gameId).eq("status", "pending"),
      )
      .collect();
    const rows = isHost
      ? rowsRaw
      : rowsRaw.filter((r) => r.requesterUserId === userId);
    const players = await loadPlayers(
      ctx,
      rows.map((r) => r.requesterUserId),
    );
    return rows.map((r) => ({
      ...r,
      requester: players.get(r.requesterUserId)!,
    }));
  },
});

// The viewer's newest request of each type in this Game, so the requester
// can watch it go from pending to approved or denied.
export const latestMine = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const access = await tryMemberByGame(ctx, { gameId });
    if (access === null) return { hint: null, giveup: null };
    const latest = async (type: Doc<"pendingRequests">["type"]) => {
      // A pending row wins even when it isn't the newest: guest merge can
      // leave one behind a newer handled row, and create still sees it.
      const pending = await ctx.db
        .query("pendingRequests")
        .withIndex("by_requester_game_type_status", (q) =>
          q
            .eq("requesterUserId", access.userId)
            .eq("gameId", gameId)
            .eq("type", type)
            .eq("status", "pending"),
        )
        .first();
      const row =
        pending ??
        (await ctx.db
          .query("pendingRequests")
          .withIndex("by_requester_game_type", (q) =>
            q
              .eq("requesterUserId", access.userId)
              .eq("gameId", gameId)
              .eq("type", type),
          )
          .order("desc")
          .first());
      if (row === null) return null;
      const { _id, status, createdAt, expiresAt, hint } = row;
      return {
        _id,
        status,
        createdAt,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(hint === undefined ? {} : { hint }),
      };
    };
    const [hint, giveup] = await Promise.all([
      latest("hint"),
      latest("giveup"),
    ]);
    return { hint, giveup };
  },
});

// Who else in this Game has a request of each type pending, so a member can
// see why they can't ask for the same thing.
export const pendingFromOthers = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const access = await tryMemberByGame(ctx, { gameId });
    if (access === null) return { hint: null, giveup: null };
    const others = (
      await ctx.db
        .query("pendingRequests")
        .withIndex("by_game_status", (q) =>
          q.eq("gameId", gameId).eq("status", "pending"),
        )
        .collect()
    ).filter((r) => r.requesterUserId !== access.userId);
    const players = await loadPlayers(
      ctx,
      others.map((r) => r.requesterUserId),
    );
    const holder = (type: Doc<"pendingRequests">["type"]) => {
      const row = others.find((r) => r.type === type);
      return row === undefined
        ? null
        : { name: players.get(row.requesterUserId)!.name };
    };
    return { hint: holder("hint"), giveup: holder("giveup") };
  },
});

export const create = mutation({
  args: { gameId: v.id("games"), type: REQUEST_TYPE },
  handler: async (ctx, { gameId, type }) => {
    const { userId, room, game } = await requireMemberByGame(ctx, { gameId });
    if (game.status !== "in_progress") {
      throw new ConvexError("Game is no longer in progress");
    }
    if (room.hostUserId === userId) {
      throw new ConvexError(`Host should use the direct ${type} action`);
    }
    // One pending request of each type per Game, whoever asked.
    const existing = (
      await ctx.db
        .query("pendingRequests")
        .withIndex("by_game_status", (q) =>
          q.eq("gameId", gameId).eq("status", "pending"),
        )
        .collect()
    ).find((r) => r.type === type);
    if (existing !== undefined) {
      throw new ConvexError(
        existing.requesterUserId === userId
          ? `${type} request already pending`
          : `Another ${type} request is already pending`,
      );
    }
    const createdAt = Date.now();
    const requestId = await ctx.db.insert("pendingRequests", {
      roomId: game.roomId,
      gameId,
      requesterUserId: userId,
      type,
      status: "pending",
      createdAt,
      expiresAt: createdAt + REQUEST_TTL_MS,
    });
    await ctx.scheduler.runAfter(REQUEST_TTL_MS, internal.requests._expire, {
      requestId,
    });
    await track(ctx, userId, {
      name: "request_created",
      properties: {
        request_id: requestId,
        game_id: gameId,
        request_type: type,
      },
    });
    return null;
  },
});

export const deny = mutation({
  args: { requestId: v.id("pendingRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get("pendingRequests", requestId);
    if (req === null) throw new ConvexError("Request not found");
    const { userId } = await requireHostByRoom(ctx, { roomId: req.roomId });
    if (req.status !== "pending") {
      throw new ConvexError("Request not found or already handled");
    }
    await ctx.db.patch("pendingRequests", requestId, { status: "denied" });
    await track(ctx, userId, {
      name: "request_denied",
      properties: {
        request_id: requestId,
        game_id: req.gameId,
        request_type: req.type,
      },
    });
    return null;
  },
});

// The requester takes back a Pending request. The row goes away rather than
// gaining a status, so asking again starts clean.
export const cancel = mutation({
  args: { requestId: v.id("pendingRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get("pendingRequests", requestId);
    if (req === null)
      throw new ConvexError("Request not found or already handled");
    const { userId } = await requireMemberByGame(ctx, { gameId: req.gameId });
    if (req.requesterUserId !== userId || req.status !== "pending") {
      throw new ConvexError("Request not found or already handled");
    }
    await ctx.db.delete("pendingRequests", requestId);
    await track(ctx, userId, {
      name: "request_cancelled",
      properties: {
        request_id: requestId,
        game_id: req.gameId,
        request_type: req.type,
      },
    });
    return null;
  },
});

// Scheduled by create. A request the Host answered or the requester took
// back in the meantime is left alone.
export const _expire = internalMutation({
  args: { requestId: v.id("pendingRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get("pendingRequests", requestId);
    if (req === null || req.status !== "pending") return null;
    await ctx.db.patch("pendingRequests", requestId, { status: "expired" });
    await track(ctx, req.requesterUserId, {
      name: "request_expired",
      properties: {
        request_id: requestId,
        game_id: req.gameId,
        request_type: req.type,
      },
    });
    return null;
  },
});

export const _read = internalQuery({
  args: { requestId: v.id("pendingRequests") },
  handler: async (ctx, { requestId }) => {
    return await ctx.db.get("pendingRequests", requestId);
  },
});

export const approve = action({
  args: { requestId: v.id("pendingRequests") },
  handler: async (
    ctx,
    { requestId },
  ): Promise<{ lemma: string; distance?: number }> => {
    const req: Doc<"pendingRequests"> | null = await ctx.runQuery(
      internal.requests._read,
      { requestId },
    );
    if (req === null) {
      throw new ConvexError("Request not found or already handled");
    }
    const { gameId } = req;
    switch (req.type) {
      case "hint":
        return await performTurn(ctx, {
          gameId,
          requestId,
          turn: { kind: "hint" },
        });
      case "giveup":
        return await performTurn(ctx, {
          gameId,
          requestId,
          turn: { kind: "giveup" },
        });
    }
  },
});
