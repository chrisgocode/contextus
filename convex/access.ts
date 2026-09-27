import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const NOT_AUTHENTICATED_MESSAGE = "Not authenticated";
export const NOT_MEMBER_MESSAGE = "Not a member of this room";
export const GAME_NOT_FOUND_MESSAGE = "Game not found";
export const ROOM_NOT_FOUND_MESSAGE = "Room not found";
export const HOST_ONLY_MESSAGE = "Host only";

type DbCtx = Pick<QueryCtx, "db" | "auth"> | Pick<MutationCtx, "db" | "auth">;

// The caller's user, or null when signed out. Convex Auth reads the user from
// the access token alone, so a token outlives its session by up to an hour.
// Guest expiry deletes the session row, and marks the guest before that, so
// the session and the mark are both checked here.
export async function getCurrentUserId(
  ctx: DbCtx,
): Promise<Id<"users"> | null> {
  const [userId, rawSessionId] = await Promise.all([
    getAuthUserId(ctx),
    getAuthSessionId(ctx),
  ]);
  if (userId === null || rawSessionId === null) return null;
  const sessionId = ctx.db.normalizeId("authSessions", rawSessionId);
  if (sessionId === null) return null;
  const [session, user] = await Promise.all([
    ctx.db.get("authSessions", sessionId),
    ctx.db.get("users", userId),
  ]);
  if (
    session === null ||
    session.userId !== userId ||
    session.expirationTime <= Date.now()
  ) {
    return null;
  }
  if (user === null || user.guestCleanupStarted === true) return null;
  return userId;
}

export async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getCurrentUserId(ctx);
  if (userId === null) {
    throw new ConvexError(NOT_AUTHENTICATED_MESSAGE);
  }
  return userId;
}

export async function requireRegisteredUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getCurrentUserId(ctx);
  if (userId === null) {
    throw new ConvexError(NOT_AUTHENTICATED_MESSAGE);
  }
  const user = await ctx.db.get("users", userId);
  if (user === null || user.isAnonymous === true) {
    throw new ConvexError("Registered account required");
  }
  return userId;
}

type ByGame = { gameId: Id<"games"> };
type ByRoom = { roomId: Id<"rooms"> };

export type RoomAccess = {
  userId: Id<"users">;
  room: Doc<"rooms">;
};

export type GameAccess = RoomAccess & {
  game: Doc<"games">;
};

async function loadByGame(
  ctx: DbCtx,
  { gameId }: ByGame,
): Promise<{
  userId: Id<"users"> | null;
  game: Doc<"games"> | null;
  room: Doc<"rooms"> | null;
}> {
  const userId = await getCurrentUserId(ctx);
  const game = await ctx.db.get("games", gameId);
  const room = game === null ? null : await ctx.db.get("rooms", game.roomId);
  return { userId, game, room };
}

async function loadByRoom(
  ctx: DbCtx,
  { roomId }: ByRoom,
): Promise<{ userId: Id<"users"> | null; room: Doc<"rooms"> | null }> {
  const userId = await getCurrentUserId(ctx);
  const room = await ctx.db.get("rooms", roomId);
  return { userId, room };
}

async function isMember(
  ctx: DbCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<boolean> {
  const m = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) =>
      q.eq("roomId", roomId).eq("userId", userId),
    )
    .unique();
  return m !== null;
}

// A Host who has left the room keeps no Host privileges.
async function isHost(
  ctx: DbCtx,
  room: Doc<"rooms">,
  userId: Id<"users">,
): Promise<boolean> {
  return room.hostUserId === userId && (await isMember(ctx, room._id, userId));
}

export async function requireMemberByGame(
  ctx: DbCtx,
  args: ByGame,
): Promise<GameAccess> {
  const { userId, game, room } = await loadByGame(ctx, args);
  if (userId === null) throw new ConvexError(NOT_AUTHENTICATED_MESSAGE);
  if (game === null) throw new ConvexError(GAME_NOT_FOUND_MESSAGE);
  if (room === null) throw new ConvexError(ROOM_NOT_FOUND_MESSAGE);
  if (!(await isMember(ctx, room._id, userId))) {
    throw new ConvexError(NOT_MEMBER_MESSAGE);
  }
  return { userId, room, game };
}

export async function tryMemberByGame(
  ctx: DbCtx,
  args: ByGame,
): Promise<GameAccess | null> {
  const { userId, game, room } = await loadByGame(ctx, args);
  if (userId === null || game === null || room === null) return null;
  if (!(await isMember(ctx, room._id, userId))) return null;
  return { userId, room, game };
}

export async function tryMemberByRoom(
  ctx: DbCtx,
  args: ByRoom,
): Promise<RoomAccess | null> {
  const { userId, room } = await loadByRoom(ctx, args);
  if (userId === null || room === null) return null;
  if (!(await isMember(ctx, room._id, userId))) return null;
  return { userId, room };
}

export async function requireHostByGame(
  ctx: DbCtx,
  args: ByGame,
): Promise<GameAccess> {
  const { userId, game, room } = await loadByGame(ctx, args);
  if (userId === null) throw new ConvexError(NOT_AUTHENTICATED_MESSAGE);
  if (game === null) throw new ConvexError(GAME_NOT_FOUND_MESSAGE);
  if (room === null) throw new ConvexError(ROOM_NOT_FOUND_MESSAGE);
  if (!(await isHost(ctx, room, userId)))
    throw new ConvexError(HOST_ONLY_MESSAGE);
  return { userId, room, game };
}

export async function requireHostByRoom(
  ctx: DbCtx,
  args: ByRoom,
): Promise<RoomAccess> {
  const { userId, room } = await loadByRoom(ctx, args);
  if (userId === null) throw new ConvexError(NOT_AUTHENTICATED_MESSAGE);
  if (room === null) throw new ConvexError(ROOM_NOT_FOUND_MESSAGE);
  if (!(await isHost(ctx, room, userId)))
    throw new ConvexError(HOST_ONLY_MESSAGE);
  return { userId, room };
}
