// Pending request module: when a request stops holding its type, and how
// requests leave the pending state outside of a Host's answer.
//
// Liveness takes `now` so every caller judges a request against one clock
// reading, and tests can check it without waiting.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { track } from "../analytics";

export type RequestType = Doc<"pendingRequests">["type"];

const REQUEST_TYPES: RequestType[] = ["hint", "giveup"];

// A request nobody answers expires after this long.
export const REQUEST_TTL_MS = 60_000;
// An approval started before the deadline gets this long to finish, so a
// slow Contexto fetch isn't overtaken by the expiry. An approval that never
// finishes still lets the request expire.
export const APPROVAL_GRACE_MS = 30_000;

// Rows from before requests expired have no expiresAt. Every one of them was
// handled or went overdue long ago, so a missing deadline is one already past.
export function deadlineOf(req: Doc<"pendingRequests">) {
  return req.expiresAt ?? 0;
}

// Effective state is time-aware; persisted status can lag a scheduled expiry.
// Withdrawal is deletion, so absent includes cancelled/departed requesters.
export type RequestState =
  | { kind: "absent" }
  | { kind: "waiting"; until: number }
  | { kind: "approval-started"; until: number }
  | { kind: "approval-grace"; until: number }
  | { kind: "overdue" }
  | { kind: "approved" | "denied" | "expired" };

export function effectiveState(
  req: Doc<"pendingRequests"> | null,
  now: number,
): RequestState {
  if (req === null) return { kind: "absent" };
  if (req.status !== "pending") return { kind: req.status };
  const deadline = deadlineOf(req);
  const graceUntil =
    req.approvalStartedAt === undefined
      ? 0
      : req.approvalStartedAt + APPROVAL_GRACE_MS;
  const until = Math.max(deadline, graceUntil);
  if (now >= until) return { kind: "overdue" };
  if (now >= deadline) return { kind: "approval-grace", until };
  return {
    kind: req.approvalStartedAt === undefined ? "waiting" : "approval-started",
    until,
  };
}

// Keep the liveness interface shared by create, queries and turn validation.
export function isLive(req: Doc<"pendingRequests"> | null, now: number) {
  return "until" in effectiveState(req, now);
}

export function publicStatus(
  req: Doc<"pendingRequests">,
  now: number,
): Doc<"pendingRequests">["status"] {
  const state = effectiveState(req, now);
  switch (state.kind) {
    case "waiting":
    case "approval-started":
    case "approval-grace":
      return "pending";
    case "overdue":
    case "absent":
      return "expired";
    default:
      return state.kind;
  }
}

export function pendingOfType(
  ctx: QueryCtx,
  gameId: Id<"games">,
  type: RequestType,
) {
  return ctx.db
    .query("pendingRequests")
    .withIndex("by_game_type_status", (q) =>
      q.eq("gameId", gameId).eq("type", type).eq("status", "pending"),
    );
}

// The pending request holding this type. An overdue request stays pending
// until its expiry runs, so skip past those.
export async function livePendingOfType(
  ctx: QueryCtx,
  gameId: Id<"games">,
  type: RequestType,
  now: number,
) {
  for await (const row of pendingOfType(ctx, gameId, type)) {
    if (isLive(row, now)) return row;
  }
  return null;
}

// Every live request in this Game. The Host sees all of them; anyone else
// sees only their own. At most one per type is live, so this reads one row
// per type plus any overdue rows ahead of it.
export async function livePendingFor(
  ctx: QueryCtx,
  gameId: Id<"games">,
  viewer: { userId: Id<"users">; isHost: boolean },
  now: number,
) {
  const holders = await Promise.all(
    REQUEST_TYPES.map((type) => livePendingOfType(ctx, gameId, type, now)),
  );
  return holders.filter(
    (r): r is Doc<"pendingRequests"> =>
      r !== null && (viewer.isHost || r.requesterUserId === viewer.userId),
  );
}

export async function markExpired(
  ctx: MutationCtx,
  req: Doc<"pendingRequests">,
) {
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

// A member who leaves can't take their requests back, and a member who
// becomes Host answers them instead of asking. Either way each one would keep
// other members from asking for the same thing, so it goes away.
export async function withdrawAllFor(
  ctx: Pick<MutationCtx, "db">,
  member: { roomId: Id<"rooms">; userId: Id<"users"> },
) {
  for await (const request of ctx.db
    .query("pendingRequests")
    .withIndex("by_room_status", (q) =>
      q.eq("roomId", member.roomId).eq("status", "pending"),
    )) {
    if (request.requesterUserId === member.userId) {
      await ctx.db.delete("pendingRequests", request._id);
    }
  }
}
