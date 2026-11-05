// Invite module: the whole Invite lifecycle. Nothing else writes `invites`.
//
// Terminal transitions delete the row. An overdue row can remain until its
// expiry job runs, so decisions and projections always use a supplied clock.
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

type InviteState =
  | { kind: "absent" }
  | { kind: "open" | "expired"; row: Doc<"invites"> };

function inviteState(row: Doc<"invites"> | null, now: number): InviteState {
  if (row === null) return { kind: "absent" };
  return { kind: now < row.expiresAt ? "open" : "expired", row };
}

type InviteCommand = "send" | "join" | "decline" | "expire" | "close";
type InviteDecision =
  | { kind: "create" | "ignore" | "reject" }
  | { kind: "refresh" | "join" | "delete"; row: Doc<"invites"> };

function decideInvite(
  state: InviteState,
  command: "send",
): { kind: "create" } | { kind: "refresh"; row: Doc<"invites"> };
function decideInvite(
  state: InviteState,
  command: "join" | "decline",
): { kind: "reject" } | { kind: "join" | "delete"; row: Doc<"invites"> };
function decideInvite(
  state: InviteState,
  command: "expire" | "close",
): { kind: "ignore" } | { kind: "delete"; row: Doc<"invites"> };
function decideInvite(
  state: InviteState,
  command: InviteCommand,
): InviteDecision {
  switch (command) {
    case "send":
      return state.kind === "absent"
        ? { kind: "create" }
        : { kind: "refresh", row: state.row };
    case "join":
    case "decline":
      return state.kind === "open"
        ? { kind: command === "join" ? "join" : "delete", row: state.row }
        : { kind: "reject" };
    case "expire":
      return state.kind === "expired"
        ? { kind: "delete", row: state.row }
        : { kind: "ignore" };
    case "close":
      return state.kind === "absent"
        ? { kind: "ignore" }
        : { kind: "delete", row: state.row };
  }
}

export function isOpen(invite: Doc<"invites">, now: number) {
  return inviteState(invite, now).kind === "open";
}

// Shared terminal transition for admission, Room end and former-Friend cleanup.
// Closing is unconditional: unlike expiry, it does not depend on the clock.
async function closeInvite(
  ctx: WriteCtx,
  row: Doc<"invites"> | null,
  now = Date.now(),
) {
  const decision = decideInvite(inviteState(row, now), "close");
  if (decision.kind === "delete")
    await ctx.db.delete("invites", decision.row._id);
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
  const decision = decideInvite(inviteState(existing, now), "send");
  const inviteId =
    decision.kind === "create"
      ? await ctx.db.insert("invites", {
          roomId,
          recipientUserId: recipient,
          senderUserId: sender,
          expiresAt,
        })
      : decision.row._id;
  if (decision.kind === "refresh") {
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
  const decision = decideInvite(inviteState(row, now), response);
  if (
    row === null ||
    row.recipientUserId !== recipient ||
    decision.kind === "reject"
  ) {
    throw appError("inviteNotFound");
  }
  if (decision.kind === "delete") {
    await closeInvite(ctx, row, now);
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
  const decision = decideInvite(inviteState(row, now), "expire");
  if (decision.kind === "delete") await closeInvite(ctx, decision.row, now);
}

export async function endInvite(
  ctx: WriteCtx,
  roomId: Id<"rooms">,
  recipient: UserId,
) {
  const row = await findInvite(ctx, roomId, recipient);
  await closeInvite(ctx, row);
}

export async function endInvitesForRoom(ctx: WriteCtx, roomId: Id<"rooms">) {
  for await (const row of ctx.db
    .query("invites")
    .withIndex("by_roomId_and_recipientUserId", (q) =>
      q.eq("roomId", roomId),
    )) {
    await closeInvite(ctx, row);
  }
}

export async function endInvitesBetween(ctx: WriteCtx, a: UserId, b: UserId) {
  for (const [sender, recipient] of [
    [a, b],
    [b, a],
  ]) {
    for await (const row of ctx.db
      .query("invites")
      .withIndex("by_senderUserId_and_recipientUserId", (q) =>
        q.eq("senderUserId", sender).eq("recipientUserId", recipient),
      )) {
      await closeInvite(ctx, row);
    }
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
