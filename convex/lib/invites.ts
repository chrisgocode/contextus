// Invite module: the whole Invite lifecycle. Nothing else writes `invites`.
//
// A row exists only while its Invite is open, so every way an Invite ends
// deletes it. Reads also check `isOpen`, so an expiry that runs late never
// shows a dead Invite.
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { track } from "../analytics";
import { appError } from "./errors";
import { relationshipBetween } from "./friendship";
import { enforceRateLimit } from "./rateLimits";
import { admit, isLiveMember, trackJoin } from "./roomMembership";

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;
type UserId = Id<"users">;

export const INVITE_TTL_MS = 5 * 60 * 1000;

const MAX_INVITES_LISTED = 50;

export function isOpen(invite: Doc<"invites">, now: number) {
  return now < invite.expiresAt;
}

async function findInvite(
  ctx: ReadCtx,
  roomId: Id<"rooms">,
  recipient: UserId,
) {
  return await ctx.db
    .query("invites")
    .withIndex("by_roomId_and_recipientUserId", (q) =>
      q.eq("roomId", roomId).eq("recipientUserId", recipient),
    )
    .unique();
}

// Inviting again restarts the window and records the latest sender.
export async function invite(
  ctx: MutationCtx,
  sender: UserId,
  recipient: UserId,
  roomId: Id<"rooms">,
  now: number,
) {
  const room = await ctx.db.get("rooms", roomId);
  if (room === null || room.status !== "active") throw appError("roomNotFound");
  if (!(await isLiveMember(ctx, room, sender))) throw appError("notMember");
  if ((await relationshipBetween(ctx, sender, recipient)) !== "friends") {
    throw appError("notFriends");
  }
  if (await isLiveMember(ctx, room, recipient)) {
    throw appError("alreadyInRoom");
  }
  await enforceRateLimit(ctx, "invite", sender);
  const expiresAt = now + INVITE_TTL_MS;
  const existing = await findInvite(ctx, roomId, recipient);
  const inviteId =
    existing === null
      ? await ctx.db.insert("invites", {
          roomId,
          recipientUserId: recipient,
          senderUserId: sender,
          expiresAt,
        })
      : existing._id;
  if (existing !== null) {
    await ctx.db.patch("invites", inviteId, {
      senderUserId: sender,
      expiresAt,
    });
  }
  await ctx.scheduler.runAfter(INVITE_TTL_MS, internal.friends._expireInvite, {
    inviteId,
  });
  await track(ctx, sender, {
    name: "invite_sent",
    properties: {
      room_id: roomId,
      recipient_user_id: recipient,
      resent: existing !== null,
    },
  });
}

// Join admits the recipient, which ends the Invite. Returns the Room's code
// for a join, so the recipient can be taken there.
export async function answer(
  ctx: MutationCtx,
  recipient: UserId,
  inviteId: Id<"invites">,
  response: "join" | "decline",
  now: number,
): Promise<string | null> {
  const row = await ctx.db.get("invites", inviteId);
  if (row === null || row.recipientUserId !== recipient || !isOpen(row, now)) {
    throw appError("inviteNotFound");
  }
  if (response === "decline") {
    await ctx.db.delete("invites", inviteId);
    return null;
  }
  const room = await ctx.db.get("rooms", row.roomId);
  if (room === null || room.status !== "active") throw appError("roomNotFound");
  if (await admit(ctx, room._id, recipient, now)) {
    await trackJoin(ctx, room._id, recipient, "invite");
    await track(ctx, recipient, {
      name: "invite_joined",
      properties: { room_id: room._id, sender_user_id: row.senderUserId },
    });
  }
  return room.code;
}

// Scheduled at the deadline. An Invite re-sent since then is left alone.
export async function expire(
  ctx: WriteCtx,
  inviteId: Id<"invites">,
  now: number,
) {
  const row = await ctx.db.get("invites", inviteId);
  if (row !== null && !isOpen(row, now)) {
    await ctx.db.delete("invites", inviteId);
  }
}

export async function endInvite(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
  recipient: UserId,
) {
  const row = await findInvite(ctx, roomId, recipient);
  if (row !== null) await ctx.db.delete("invites", row._id);
}

export async function endInvitesForRoom(ctx: WriteCtx, roomId: Id<"rooms">) {
  for await (const row of ctx.db
    .query("invites")
    .withIndex("by_roomId_and_recipientUserId", (q) =>
      q.eq("roomId", roomId),
    )) {
    await ctx.db.delete("invites", row._id);
  }
}

export async function listOpenFor(
  ctx: ReadCtx,
  recipient: UserId,
  now: number,
): Promise<Doc<"invites">[]> {
  const open: Doc<"invites">[] = [];
  for await (const row of ctx.db
    .query("invites")
    .withIndex("by_recipientUserId", (q) => q.eq("recipientUserId", recipient))
    .order("desc")) {
    if (!isOpen(row, now)) continue;
    open.push(row);
    if (open.length === MAX_INVITES_LISTED) break;
  }
  return open;
}

// Which of `candidates` have an open Invite to the Room.
export async function invitedAmong(
  ctx: ReadCtx,
  roomId: Id<"rooms">,
  candidates: UserId[],
  now: number,
): Promise<UserId[]> {
  const rows = await Promise.all(
    candidates.map((userId) => findInvite(ctx, roomId, userId)),
  );
  return candidates.filter((_, i) => {
    const row = rows[i];
    return row !== null && isOpen(row, now);
  });
}
