// Room membership module: who is in a Room, who hosts it, and how both
// change. Nothing else writes `roomMembers`, `rooms.hostUserId`,
// `rooms.status` or `roomActivity`.
//
// The Host invariant holds after every function here: the Host is a live
// member, or the Room is ended.
import { Presence } from "@convex-dev/presence";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { withdrawAllFor } from "./pendingRequests";

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;
// Host succession asks who is online, which reads the presence component.
export type RoomCtx = Pick<MutationCtx, "db" | "runQuery">;

// A Room nobody is online in ends after this long without activity.
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const MAX_GUEST_ACTIVE_ROOMS = 3;

// Its own client rather than the one in `presence.ts`, which imports the
// access guards that import this module.
const presence = new Presence(components.presence);

export async function findMembership(
  ctx: ReadCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<Doc<"roomMembers"> | null> {
  return await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) =>
      q.eq("roomId", roomId).eq("userId", userId),
    )
    .unique();
}

// Live membership: the Room is active and the user's membership in it is too.
// A membership is live unless marked inactive, since legacy rows have no
// `active` flag (#172). An ended Room has no live members, which is what
// freezes the in_progress Game it keeps for playAgain.
export async function isLiveMember(
  ctx: ReadCtx,
  room: Doc<"rooms">,
  userId: Id<"users">,
): Promise<boolean> {
  if (room.status !== "active") return false;
  const membership = await findMembership(ctx, room._id, userId);
  return membership !== null && membership.active !== false;
}

export async function touchRoomActivity(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("roomActivity")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .unique();
  if (existing === null) {
    await ctx.db.insert("roomActivity", { roomId, lastActivityAt: now });
  } else {
    await ctx.db.patch("roomActivity", existing._id, { lastActivityAt: now });
  }
}

async function requireGuestRoomSlot(ctx: ReadCtx, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  if (user?.isAnonymous !== true) return;
  const activeMemberships = await ctx.db
    .query("roomMembers")
    .withIndex("by_user_and_active", (q) =>
      q.eq("userId", userId).eq("active", true),
    )
    .take(MAX_GUEST_ACTIVE_ROOMS);
  if (activeMemberships.length >= MAX_GUEST_ACTIVE_ROOMS) {
    throw new ConvexError("Guest room limit reached");
  }
}

// Creates an active Room with its Host as the first member.
export async function openRoom(
  ctx: WriteCtx,
  room: { code: string; hostUserId: Id<"users"> },
  now: number,
): Promise<Id<"rooms">> {
  await requireGuestRoomSlot(ctx, room.hostUserId);
  const roomId = await ctx.db.insert("rooms", { ...room, status: "active" });
  await ctx.db.insert("roomMembers", {
    roomId,
    userId: room.hostUserId,
    joinedAt: now,
    active: true,
  });
  await touchRoomActivity(ctx, roomId, now);
  return roomId;
}

// Adds the user to an active Room. Returns false when they were already in.
export async function admit(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
  now: number,
): Promise<boolean> {
  const existing = await findMembership(ctx, roomId, userId);
  if (existing === null) {
    await requireGuestRoomSlot(ctx, userId);
    await ctx.db.insert("roomMembers", {
      roomId,
      userId,
      joinedAt: now,
      active: true,
    });
  }
  await touchRoomActivity(ctx, roomId, now);
  return existing === null;
}

// Room status and membership `active` flags move together: an ended Room
// holds no active memberships, and reopening one restores them all.

// Returns the memberships it deactivated.
export async function closeRoom(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
): Promise<Doc<"roomMembers">[]> {
  await ctx.db.patch("rooms", roomId, { status: "ended" });
  const members = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
    .collect();
  for (const member of members) {
    await ctx.db.patch("roomMembers", member._id, { active: false });
  }
  return members;
}

// `members` is every membership of the ended Room, and `next.hostUserId` is
// one of them.
export async function reopenRoom(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
  next: { code: string; hostUserId: Id<"users"> },
  members: Doc<"roomMembers">[],
  now: number,
): Promise<void> {
  await ctx.db.patch("rooms", roomId, { ...next, status: "active" });
  for (const member of members) {
    await ctx.db.patch("roomMembers", member._id, { active: true });
  }
  await touchRoomActivity(ctx, roomId, now);
}

// Why a Room may need a new Host:
// - `left`: the member left the Room.
// - `expired`: the member was a Guest who expired.
// - `merged`: the member was a Guest who signed in. Their membership, and
//   the Host if they held it, move to the account `into`.
// - `idle`: nobody left, but the Host, or everyone, has gone offline.
export type Departure =
  | { reason: "left" | "expired"; userId: Id<"users"> }
  | { reason: "merged"; userId: Id<"users">; into: Id<"users"> }
  | { reason: "idle" };

export type DepartureOutcome = {
  wasMember: boolean;
  // An active Room got a different Host and is still active.
  hostMoved: boolean;
  // An active Room ended.
  roomEnded: boolean;
  // Memberships read to pick a successor, for callers that batch departures
  // within transaction limits. Zero when the Host did not need replacing.
  membersScanned: number;
};

export async function depart(
  ctx: RoomCtx,
  roomId: Id<"rooms">,
  departure: Departure,
  now: number,
): Promise<DepartureOutcome> {
  const wasMember = await vacate(ctx, roomId, departure);
  const room = await ctx.db.get("rooms", roomId);
  if (room === null) {
    return { wasMember, hostMoved: false, roomEnded: false, membersScanned: 0 };
  }
  const { settled, membersScanned } = await settleHost(
    ctx,
    room,
    departure,
    now,
  );
  const wasActive = room.status === "active";
  const stillActive = wasActive && settled !== "ended";
  // Only a member acting in the Room counts as activity.
  if (departure.reason === "left" && stillActive) {
    await touchRoomActivity(ctx, roomId, now);
  }
  return {
    wasMember,
    hostMoved: stillActive && settled === "moved",
    roomEnded: wasActive && !stillActive,
    membersScanned,
  };
}

// Takes the departing member's membership out of the Room. Returns whether
// they had one.
async function vacate(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
  departure: Departure,
): Promise<boolean> {
  if (departure.reason === "idle") return false;
  const membership = await findMembership(ctx, roomId, departure.userId);
  if (departure.reason === "merged") {
    if (membership === null) return false;
    const existing = await findMembership(ctx, roomId, departure.into);
    if (existing === null) {
      await ctx.db.patch("roomMembers", membership._id, {
        userId: departure.into,
      });
    } else {
      await ctx.db.patch("roomMembers", existing._id, {
        joinedAt: Math.min(existing.joinedAt, membership.joinedAt),
      });
      await ctx.db.delete("roomMembers", membership._id);
    }
    return true;
  }
  if (membership !== null) {
    await ctx.db.delete("roomMembers", membership._id);
  }
  await withdrawAllFor(ctx, { roomId, userId: departure.userId });
  return membership !== null;
}

// Host succession. The Host is replaced when they are no longer a live
// member, or, on an idle check, when they are offline while another member is
// online. The successor is the longest-standing live member who is online,
// or the longest-standing live member when nobody is. The Room ends when
// there is no successor, or when an idle check finds nobody online past the
// idle timeout.
async function settleHost(
  ctx: RoomCtx,
  room: Doc<"rooms">,
  departure: Departure,
  now: number,
): Promise<{ settled: "kept" | "moved" | "ended"; membersScanned: number }> {
  const active = room.status === "active";
  const idle = departure.reason === "idle";
  if (idle ? !active : room.hostUserId !== departure.userId) {
    return { settled: "kept", membersScanned: 0 };
  }

  let hostUserId = room.hostUserId;
  if (departure.reason === "merged") {
    hostUserId = departure.into;
    await seatHost(ctx, room._id, hostUserId);
  }
  // An ended Room has no live members, so its Host is whoever stayed longest.
  const canHost = (m: Doc<"roomMembers">) => !active || m.active !== false;
  const hostMembership = await findMembership(ctx, room._id, hostUserId);
  const seated = hostMembership !== null && canHost(hostMembership);
  if (seated && !idle) {
    const moved = hostUserId !== room.hostUserId;
    return { settled: moved ? "moved" : "kept", membersScanned: 0 };
  }

  const memberships = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) => q.eq("roomId", room._id))
    .collect();
  const membersScanned = memberships.length;
  const candidates = memberships
    .filter(canHost)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const online = active
    ? await onlineUserIds(ctx, room._id)
    : new Set<Id<"users">>();
  const onlineCandidates = candidates.filter((m) => online.has(m.userId));
  if (idle && onlineCandidates.length === 0) {
    const activity = await ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .unique();
    if (now - (activity?.lastActivityAt ?? 0) > IDLE_TIMEOUT_MS) {
      await closeRoom(ctx, room._id);
      return { settled: "ended", membersScanned };
    }
  }
  if (seated && (online.has(hostUserId) || onlineCandidates.length === 0)) {
    return { settled: "kept", membersScanned };
  }

  const successor = onlineCandidates[0] ?? candidates[0];
  if (successor === undefined) {
    if (active) await closeRoom(ctx, room._id);
    return { settled: active ? "ended" : "kept", membersScanned };
  }
  await seatHost(ctx, room._id, successor.userId);
  return { settled: "moved", membersScanned };
}

// A Host answers Pending requests instead of asking, so the new Host's own
// requests go away.
async function seatHost(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
) {
  await ctx.db.patch("rooms", roomId, { hostUserId: userId });
  await withdrawAllFor(ctx, { roomId, userId });
}

async function onlineUserIds(
  ctx: Pick<MutationCtx, "runQuery">,
  roomId: Id<"rooms">,
): Promise<Set<Id<"users">>> {
  const list = await presence.listRoom(ctx, roomId, true);
  const out = new Set<Id<"users">>();
  for (const entry of list) {
    out.add(entry.userId as Id<"users">);
  }
  return out;
}
