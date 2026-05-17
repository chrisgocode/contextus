import type { Id } from "../_generated/dataModel";

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type CleanupDecision =
  | { kind: "noop" }
  | { kind: "migrateHost"; newHostUserId: Id<"users"> }
  | { kind: "endRoom" };

export type CleanupRoom = {
  hostUserId: Id<"users">;
  lastActivityAt: number;
};

export type CleanupMember = {
  userId: Id<"users">;
  joinedAt: number;
};

export function decideRoomCleanup({
  room,
  members,
  onlineUserIds,
  now,
}: {
  room: CleanupRoom;
  members: CleanupMember[];
  onlineUserIds: Set<Id<"users">>;
  now: number;
}): CleanupDecision {
  const hostOnline = onlineUserIds.has(room.hostUserId);
  const onlineMembers = members
    .filter((m) => onlineUserIds.has(m.userId))
    .sort((a, b) => a.joinedAt - b.joinedAt);

  if (onlineMembers.length === 0) {
    if (now - room.lastActivityAt > IDLE_TIMEOUT_MS) {
      return { kind: "endRoom" };
    }
    return { kind: "noop" };
  }

  if (!hostOnline) {
    return { kind: "migrateHost", newHostUserId: onlineMembers[0].userId };
  }

  return { kind: "noop" };
}
