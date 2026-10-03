import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import {
  requireHostByRoom,
  requireLiveMemberByGame,
  requireMemberByGame,
  tryMemberByGame,
} from "./access";
import { performTurn } from "./turns";
import { loadPlayers } from "./lib/player";
import { track } from "./analytics";

const REQUEST_TYPE = v.union(v.literal("hint"), v.literal("giveup"));

// A request nobody answers expires after this long.
const REQUEST_TTL_MS = 60_000;
// An approval started before the deadline gets this long to finish, so a
// slow Contexto fetch isn't overtaken by the expiry. An approval that never
// finishes still lets the request expire.
const APPROVAL_GRACE_MS = 30_000;

// Requests made before requests expired have no expiresAt and no scheduled
// expiry, so they count as due a minute after they were made.
function deadlineOf(req: Doc<"pendingRequests">) {
  return req.expiresAt ?? req.createdAt + REQUEST_TTL_MS;
}

// Whether a pending request still holds its type.
function isLive(req: Doc<"pendingRequests">, now: number) {
  return (
    now < deadlineOf(req) ||
    (req.approvalStartedAt !== undefined &&
      now < req.approvalStartedAt + APPROVAL_GRACE_MS)
  );
}

function pendingOfType(
  ctx: QueryCtx,
  gameId: Id<"games">,
  type: Doc<"pendingRequests">["type"],
) {
  return ctx.db
    .query("pendingRequests")
    .withIndex("by_game_type_status", (q) =>
      q.eq("gameId", gameId).eq("type", type).eq("status", "pending"),
    );
}

// The pending request holding this type. Requests made before the limit can
// leave overdue rows ahead of it, so skip past those.
async function livePendingOfType(
  ctx: QueryCtx,
  gameId: Id<"games">,
  type: Doc<"pendingRequests">["type"],
  now: number,
) {
  for await (const row of pendingOfType(ctx, gameId, type)) {
    if (isLive(row, now)) return row;
  }
  return null;
}

async function markExpired(ctx: MutationCtx, req: Doc<"pendingRequests">) {
  await ctx.db.patch("pendingRequests", req._id, { status: "expired" });
  await track(ctx, req.requesterUserId, {
    name: "request_expired",
    properties: {
      request_id: req._id,
      game_id: req.gameId,
      request_type: req.type,
    },
  });
}

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
      // Only create and the scheduled expiry write the status, so one that
      // is overdue can still read pending here.
      const overdue = status === "pending" && !isLive(row, Date.now());
      return {
        _id,
        status: overdue ? ("expired" as const) : status,
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
    const holder = async (type: Doc<"pendingRequests">["type"]) => {
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
      throw new ConvexError("Game is no longer in progress");
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
      throw new ConvexError(
        live.requesterUserId === userId
          ? `${type} request already pending`
          : `Another ${type} request is already pending`,
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
// back in the meantime is left alone; one the Host is approving is checked
// again once the approval has had time to finish.
export const _expire = internalMutation({
  args: { requestId: v.id("pendingRequests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get("pendingRequests", requestId);
    if (req === null || req.status !== "pending") return null;
    const now = Date.now();
    if (isLive(req, now)) {
      const until = Math.max(
        deadlineOf(req),
        (req.approvalStartedAt ?? 0) + APPROVAL_GRACE_MS,
      );
      await ctx.scheduler.runAfter(until - now, internal.requests._expire, {
        requestId,
      });
      return null;
    }
    await markExpired(ctx, req);
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
      throw new ConvexError("Request not found or already handled");
    }
    await requireHostByRoom(ctx, { roomId: req.roomId });
    if (req.status !== "pending") {
      throw new ConvexError("Request not found or already handled");
    }
    const now = Date.now();
    if (!isLive(req, now)) {
      await markExpired(ctx, req);
      return false;
    }
    // Another approval already in its grace period keeps its start, so
    // pressing again can't stretch the request past it.
    if (now < deadlineOf(req)) {
      await ctx.db.patch("pendingRequests", requestId, {
        approvalStartedAt: now,
      });
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
      throw new ConvexError("Request not found or already handled");
    }
    const started: boolean = await ctx.runMutation(
      internal.requests._startApproval,
      { requestId },
    );
    if (!started) {
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
