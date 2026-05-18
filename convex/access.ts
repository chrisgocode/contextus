import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

type DbCtx = Pick<QueryCtx, "db" | "auth"> | Pick<MutationCtx, "db" | "auth">;
type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

export async function requireUser(ctx: AnyCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Not authenticated");
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
): Promise<{ userId: Id<"users"> | null; game: Doc<"games"> | null; room: Doc<"rooms"> | null }> {
  const userId = await getAuthUserId(ctx as AnyCtx);
  const game = await ctx.db.get(gameId);
  const room = game === null ? null : await ctx.db.get(game.roomId);
  return { userId, game, room };
}

async function loadByRoom(
  ctx: DbCtx,
  { roomId }: ByRoom,
): Promise<{ userId: Id<"users"> | null; room: Doc<"rooms"> | null }> {
  const userId = await getAuthUserId(ctx as AnyCtx);
  const room = await ctx.db.get(roomId);
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

export async function requireMemberByGame(
  ctx: DbCtx,
  args: ByGame,
): Promise<GameAccess> {
  const { userId, game, room } = await loadByGame(ctx, args);
  if (userId === null) throw new ConvexError("Not authenticated");
  if (game === null) throw new ConvexError("Game not found");
  if (room === null) throw new ConvexError("Room not found");
  if (!(await isMember(ctx, room._id, userId))) {
    throw new ConvexError("Not a member of this room");
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

export async function requireMemberByRoom(
  ctx: DbCtx,
  args: ByRoom,
): Promise<RoomAccess> {
  const { userId, room } = await loadByRoom(ctx, args);
  if (userId === null) throw new ConvexError("Not authenticated");
  if (room === null) throw new ConvexError("Room not found");
  if (!(await isMember(ctx, room._id, userId))) {
    throw new ConvexError("Not a member of this room");
  }
  return { userId, room };
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
  if (userId === null) throw new ConvexError("Not authenticated");
  if (game === null) throw new ConvexError("Game not found");
  if (room === null) throw new ConvexError("Room not found");
  if (room.hostUserId !== userId) throw new ConvexError("Host only");
  return { userId, room, game };
}

export async function tryHostByGame(
  ctx: DbCtx,
  args: ByGame,
): Promise<GameAccess | null> {
  const { userId, game, room } = await loadByGame(ctx, args);
  if (userId === null || game === null || room === null) return null;
  if (room.hostUserId !== userId) return null;
  return { userId, room, game };
}

export async function requireHostByRoom(
  ctx: DbCtx,
  args: ByRoom,
): Promise<RoomAccess> {
  const { userId, room } = await loadByRoom(ctx, args);
  if (userId === null) throw new ConvexError("Not authenticated");
  if (room === null) throw new ConvexError("Room not found");
  if (room.hostUserId !== userId) throw new ConvexError("Host only");
  return { userId, room };
}

export async function tryHostByRoom(
  ctx: DbCtx,
  args: ByRoom,
): Promise<RoomAccess | null> {
  const { userId, room } = await loadByRoom(ctx, args);
  if (userId === null || room === null) return null;
  if (room.hostUserId !== userId) return null;
  return { userId, room };
}
