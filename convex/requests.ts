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
  isHost,
  requireHostByRoom,
  requireLiveMemberByGame,
  requireMemberByGame,
  tryMemberByGame,
} from "./access";
import { appError } from "./lib/errors";
import { performTurn } from "./turns";
import {
  effectiveState,
  isLive,
  livePendingFor,
  livePendingOfType,
  publicStatus,
  markExpired,
  pendingOfType,
  REQUEST_TTL_MS,
  type RequestType,
} from "./lib/pendingRequests";
import { loadPlayers } from "./lib/player";
import { track } from "./analytics";

const REQUEST_TYPE = v.union(v.literal("hint"), v.literal("giveup"));

export const listPending = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const access = await tryMemberByGame(ctx, { gameId });
    if (access === null) return [];
    const { userId, room } = access;
    const rows = await livePendingFor(
      ctx,
      gameId,
      { userId, isHost: await isHost(ctx, room, userId) },
      Date.now(),
    );
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
    const now = Date.now();
    const latest = async (type: RequestType) => {
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
      const { _id, createdAt, expiresAt, hint } = row;
      // Project expiry even when its scheduled mutation has not run.
      return {
        _id,
        status: publicStatus(row, now),
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
    const now = Date.now();
    const holder = async (type: RequestType) => {
      const row = await livePendingOfType(ctx, gameId, type, now);
      if (row === null || row.requesterUserId === access.userId) {
        return null;
      }
      const players = await loadPlayers(ctx, [row.requesterUserId]);
      return { name: players.get(row.requesterUserId)!.name };
    };
    const [hint, giveup] = await Promise.all([
      holder("hint"),
      holder("giveup"),
    ]);
    return { hint, giveup };
  },
});

export const create = mutation({
  args: { gameId: v.id("games"), type: REQUEST_TYPE },
  handler: async (ctx, { gameId, type }) => {
    const { userId, room, game } = await requireLiveMemberByGame(ctx, {
      gameId,
    });
    if (game.status !== "in_progress") {
      throw appError("gameEnded");
    }
    if (room.hostUserId === userId) {
      throw new ConvexError(`Host should use the direct ${type} action`);
    }
    // One pending request of each type per Game, whoever asked. Ones that
    // are overdue only block until someone asks again, and are expired here
    // so they don't pile up.
    const createdAt = Date.now();
    const existing = await pendingOfType(ctx, gameId, type).collect();
    const live = existing.find((r) => isLive(r, createdAt));
    if (live !== undefined) {
      throw live.requesterUserId === userId
        ? appError("requestAlreadyPending", `${type} request already pending`)
        : appError(
            "requestPendingByOther",
            `Another ${type} request is already pending`,
          );
    }
    for (const overdue of existing) await markExpired(ctx, overdue);
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
    if (req === null) throw appError("requestNotFound");
    const { userId } = await requireHostByRoom(ctx, { roomId: req.roomId });
    if (req.status !== "pending") {
      throw appError("requestHandled");
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
    if (req === null) throw appError("requestHandled");
    const { userId } = await requireMemberByGame(ctx, { gameId: req.gameId });
    if (req.requesterUserId !== userId || req.status !== "pending") {
      throw appError("requestHandled");
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
// back in the meantime is left alone; one the Host is approving is checked
// again once the approval has had time to finish.
export const _expire = internalMutation({
  args: { requestId: v.id("pendingRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get("pendingRequests", requestId);
    const now = Date.now();
    const state = effectiveState(req, now);
    if ("until" in state) {
      await ctx.scheduler.runAfter(
        state.until - now,
        internal.requests._expire,
        {
          requestId,
        },
      );
      return null;
    }
    if (req !== null && state.kind === "overdue") await markExpired(ctx, req);
    return null;
  },
});

// Called by approve before it fetches from Contexto, so the expiry waits
// for the approval instead of overtaking it. A request already past its
// deadline is expired instead, and approve gives up.
export const _startApproval = internalMutation({
  args: { requestId: v.id("pendingRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get("pendingRequests", requestId);
    if (req === null) {
      throw appError("requestHandled");
    }
    await requireHostByRoom(ctx, { roomId: req.roomId });
    const now = Date.now();
    const state = effectiveState(req, now);
    switch (state.kind) {
      case "overdue":
        await markExpired(ctx, req);
        return false;
      case "waiting":
      case "approval-started":
        // Preserve retries before the original deadline. After it, retries
        // share the existing grace period and cannot extend it.
        await ctx.db.patch("pendingRequests", requestId, {
          approvalStartedAt: now,
        });
        break;
      case "approval-grace":
        break;
      default:
        throw appError("requestHandled");
    }
    return true;
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
      throw appError("requestHandled");
    }
    const started: boolean = await ctx.runMutation(
      internal.requests._startApproval,
      { requestId },
    );
    if (!started) {
      throw appError("requestHandled");
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
