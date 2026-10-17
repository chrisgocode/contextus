// Friendship module: Friend requests and Friends, and every rule about them.
// Nothing else writes `friendships`.
//
// Each unordered pair of users has at most one row, so a request crossing
// one the other way, or a repeat, finds the row already there.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { track } from "../analytics";
import { appError } from "./errors";
import { enforceRateLimit } from "./rateLimits";
import { findUserByUsername } from "./usernames";

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db" | "scheduler">;
type UserId = Id<"users">;

export const MAX_FRIENDS = 200;
export const MAX_PENDING_OUTGOING = 50;

export type Relationship = "none" | "requested" | "incoming" | "friends";

function pair(a: UserId, b: UserId) {
  return a < b
    ? { firstUserId: a, secondUserId: b }
    : { firstUserId: b, secondUserId: a };
}

async function findPair(ctx: ReadCtx, a: UserId, b: UserId) {
  const { firstUserId, secondUserId } = pair(a, b);
  return await ctx.db
    .query("friendships")
    .withIndex("by_first_and_second", (q) =>
      q.eq("firstUserId", firstUserId).eq("secondUserId", secondUserId),
    )
    .unique();
}

function relationshipFrom(
  row: Doc<"friendships"> | null,
  viewer: UserId,
): Relationship {
  if (row === null) return "none";
  if (row.status === "friends") return "friends";
  if (row.requesterUserId === viewer) return "requested";
  return row.declined ? "none" : "incoming";
}

async function hasMaxFriends(ctx: ReadCtx, userId: UserId) {
  const first = await side(ctx, userId, "first", "friends", false).take(
    MAX_FRIENDS,
  );
  if (first.length === MAX_FRIENDS) return true;
  const second = await side(ctx, userId, "second", "friends", false).take(
    MAX_FRIENDS - first.length,
  );
  return first.length + second.length >= MAX_FRIENDS;
}

async function assertRoomForFriend(ctx: ReadCtx, actor: UserId, other: UserId) {
  const [actorFull, otherFull] = await Promise.all([
    hasMaxFriends(ctx, actor),
    hasMaxFriends(ctx, other),
  ]);
  if (actorFull) throw appError("friendLimit");
  if (otherFull) throw appError("friendLimitOther");
}

async function isRegistered(ctx: ReadCtx, userId: UserId) {
  const user = await ctx.db.get("users", userId);
  return user !== null && user.isAnonymous !== true;
}

// A request you declined still rules its sender out: adding them would make
// you Friends at once.
export async function isSuggestable(
  ctx: ReadCtx,
  viewer: UserId,
  other: UserId,
) {
  if (viewer === other || !(await isRegistered(ctx, other))) return false;
  return (await findPair(ctx, viewer, other)) === null;
}

// Null when the two can't be Friends: a Guest on either side, or one user.
export async function relationshipBetween(
  ctx: ReadCtx,
  viewer: UserId,
  other: UserId,
): Promise<Relationship | null> {
  if (viewer === other) return null;
  const [viewerRegistered, otherRegistered] = await Promise.all([
    isRegistered(ctx, viewer),
    isRegistered(ctx, other),
  ]);
  if (!viewerRegistered || !otherRegistered) return null;
  return relationshipFrom(await findPair(ctx, viewer, other), viewer);
}

export async function sendRequest(
  ctx: MutationCtx,
  sender: UserId,
  target: UserId,
): Promise<"requested" | "friends"> {
  if (sender === target) throw appError("friendSelf");
  const [senderUser, targetUser] = await Promise.all([
    ctx.db.get("users", sender),
    ctx.db.get("users", target),
  ]);
  if (targetUser === null) throw appError("userNotFound");
  if (senderUser?.isAnonymous === true || targetUser.isAnonymous === true) {
    throw appError("friendsNeedAccount");
  }
  const existing = await findPair(ctx, sender, target);
  if (existing?.status === "friends") return "friends";
  if (existing?.requesterUserId === sender) return "requested";
  await enforceRateLimit(ctx, "friendRequest", sender);
  await assertRoomForFriend(ctx, sender, target);
  if (existing !== null) {
    await ctx.db.patch("friendships", existing._id, {
      status: "friends",
      declined: false,
    });
    await track(ctx, sender, {
      name: "friend_added",
      properties: { friend_user_id: target, via: "crossed_request" },
    });
    return "friends";
  }
  const pendingOutgoing = await listOutgoing(ctx, sender);
  if (pendingOutgoing.length >= MAX_PENDING_OUTGOING) {
    throw appError("friendRequestLimit");
  }
  await ctx.db.insert("friendships", {
    ...pair(sender, target),
    requesterUserId: sender,
    status: "pending",
    declined: false,
  });
  await track(ctx, sender, {
    name: "friend_request_sent",
    properties: { recipient_user_id: target },
  });
  return "requested";
}

export async function sendRequestByUsername(
  ctx: MutationCtx,
  sender: UserId,
  username: string,
): Promise<"requested" | "friends"> {
  const target = await findUserByUsername(ctx, username);
  if (target === null) throw appError("userNotFound");
  return await sendRequest(ctx, sender, target._id);
}

export async function answerRequest(
  ctx: WriteCtx,
  recipient: UserId,
  sender: UserId,
  answer: "accept" | "decline",
) {
  const row = await findPair(ctx, recipient, sender);
  if (row === null || relationshipFrom(row, recipient) !== "incoming") {
    throw appError("friendRequestNotFound");
  }
  if (answer === "accept") {
    await assertRoomForFriend(ctx, recipient, sender);
    await ctx.db.patch("friendships", row._id, { status: "friends" });
    await track(ctx, recipient, {
      name: "friend_added",
      properties: { friend_user_id: sender, via: "accept" },
    });
  } else {
    await ctx.db.patch("friendships", row._id, { declined: true });
    await track(ctx, recipient, {
      name: "friend_request_declined",
      properties: { sender_user_id: sender },
    });
  }
}

export async function cancelRequest(
  ctx: WriteCtx,
  sender: UserId,
  target: UserId,
) {
  const row = await findPair(ctx, sender, target);
  if (row === null || relationshipFrom(row, sender) !== "requested") {
    throw appError("friendRequestNotFound");
  }
  await ctx.db.delete("friendships", row._id);
  await track(ctx, sender, {
    name: "friend_request_cancelled",
    properties: { recipient_user_id: target },
  });
}

export async function unfriend(ctx: WriteCtx, userId: UserId, friend: UserId) {
  const row = await findPair(ctx, userId, friend);
  if (row?.status !== "friends") throw appError("notFriends");
  await ctx.db.delete("friendships", row._id);
  await track(ctx, userId, {
    name: "friend_removed",
    properties: { friend_user_id: friend },
  });
}

// Incoming requests listed at most. Senders are capped, recipients aren't.
const MAX_INCOMING_LISTED = 100;

function side(
  ctx: ReadCtx,
  userId: UserId,
  which: "first" | "second",
  status: Doc<"friendships">["status"],
  declined: boolean,
) {
  return which === "first"
    ? ctx.db
        .query("friendships")
        .withIndex("by_first_and_status_and_declined", (q) =>
          q
            .eq("firstUserId", userId)
            .eq("status", status)
            .eq("declined", declined),
        )
    : ctx.db
        .query("friendships")
        .withIndex("by_second_and_status_and_declined", (q) =>
          q
            .eq("secondUserId", userId)
            .eq("status", status)
            .eq("declined", declined),
        );
}

function otherOf(row: Doc<"friendships">, userId: UserId) {
  return row.firstUserId === userId ? row.secondUserId : row.firstUserId;
}

export async function listFriends(
  ctx: ReadCtx,
  userId: UserId,
): Promise<UserId[]> {
  const rows = (
    await Promise.all(
      (["first", "second"] as const).map((which) =>
        side(ctx, userId, which, "friends", false).take(MAX_FRIENDS),
      ),
    )
  ).flat();
  return rows.map((row) => otherOf(row, userId));
}

export async function listIncoming(
  ctx: ReadCtx,
  userId: UserId,
): Promise<{ senders: UserId[]; more: boolean }> {
  const senders: UserId[] = [];
  for (const which of ["first", "second"] as const) {
    for await (const row of side(ctx, userId, which, "pending", false)) {
      if (row.requesterUserId === userId) continue;
      if (senders.length === MAX_INCOMING_LISTED) {
        return { senders, more: true };
      }
      senders.push(row.requesterUserId);
    }
  }
  return { senders, more: false };
}

export async function listOutgoing(
  ctx: ReadCtx,
  userId: UserId,
): Promise<UserId[]> {
  const rows = await ctx.db
    .query("friendships")
    .withIndex("by_requester_and_status", (q) =>
      q.eq("requesterUserId", userId).eq("status", "pending"),
    )
    .take(MAX_PENDING_OUTGOING);
  return rows.map((row) => otherOf(row, userId));
}
