// Friend status module. It reads the presence component, where the app
// heartbeat records every open tab under APP_PRESENCE_ROOM and the Room
// heartbeat records presence per Room.
import { Presence } from "@convex-dev/presence";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isLiveMember, lastRoomActivityAt } from "./roomMembership";

// Never a Room id, so it can't collide with a Room's presence.
export const APP_PRESENCE_ROOM = "app";

export type FriendStatus =
  | { kind: "online" }
  | { kind: "inRoom"; code: string }
  | { kind: "offline" };

type StatusCtx = Pick<QueryCtx, "db" | "runQuery">;

const presence = new Presence(components.presence);

export function onlineFirst(a: FriendStatus, b: FriendStatus): number {
  return Number(a.kind === "offline") - Number(b.kind === "offline");
}

export async function statusOf(
  ctx: StatusCtx,
  friendId: Id<"users">,
): Promise<FriendStatus> {
  const friend = await ctx.db.get("users", friendId);
  if (friend === null || friend.appearOffline === true) {
    return { kind: "offline" };
  }
  const entries = await presence.listUser(ctx, friendId, true);
  const room = await mostRecentlyActiveRoom(
    ctx,
    friendId,
    entries.map((entry) => entry.roomId),
  );
  if (room !== null) return { kind: "inRoom", code: room.code };
  return entries.some((entry) => entry.roomId === APP_PRESENCE_ROOM)
    ? { kind: "online" }
    : { kind: "offline" };
}

async function mostRecentlyActiveRoom(
  ctx: StatusCtx,
  userId: Id<"users">,
  presenceRoomIds: string[],
) {
  const candidates = await Promise.all(
    presenceRoomIds.map(async (presenceRoomId) => {
      const roomId = ctx.db.normalizeId("rooms", presenceRoomId);
      if (roomId === null) return null;
      const room = await ctx.db.get("rooms", roomId);
      if (room === null || !(await isLiveMember(ctx, room, userId))) {
        return null;
      }
      return { room, lastActivityAt: await lastRoomActivityAt(ctx, roomId) };
    }),
  );
  let best: (typeof candidates)[number] = null;
  for (const candidate of candidates) {
    if (candidate === null) continue;
    if (best === null || candidate.lastActivityAt > best.lastActivityAt) {
      best = candidate;
    }
  }
  return best?.room ?? null;
}
