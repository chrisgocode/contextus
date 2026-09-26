import type { NamedTableInfo, Query } from "convex/server";
import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  type MergeState,
  mergeAchievement,
  mergeAchievementProgress,
  mergeAchievementStats,
  mergeGamePlayerStats,
  mergeGuess,
  mergeHistory,
  mergeHostedRoom,
  mergeRequest,
  mergeRoomMembership,
  mergeSolveDay,
  mergeWin,
} from "./guestMergeRows";

// What happens to a user's rows when a Guest signs in (merge), a Guest
// expires (expire), or an E2E account is deleted (purge). Every schema field
// that references `users` is declared here once; `accountLifecycle.test.ts`
// fails when one is missing. Retention rules are explained in
// docs/adr/0002-expired-guest-retention.md.

type LifecycleCtx = Pick<MutationCtx, "db">;
type UserId = Id<"users">;
type RowMerge<T extends TableNames> = (
  ctx: LifecycleCtx,
  row: Doc<T>,
  merge: MergeState,
) => Promise<void>;

// Batch phases of the scheduled merge in `guestMerge.ts` that move a table.
export type MergePhase = Exclude<
  Doc<"guestMerges">["phase"],
  "streak" | "finalize"
>;

type Policy<T extends TableNames> = {
  table: T;
  field: keyof Doc<T> & string;
  rows: (
    ctx: LifecycleCtx,
    userId: UserId,
  ) => Query<NamedTableInfo<DataModel, T>>;
  // Deletes a row and anything that only exists through it. Defaults to
  // deleting just the row.
  remove?: (ctx: LifecycleCtx, row: Doc<T>) => Promise<void>;
  // How a guest's rows reach the account:
  // - `phase`: moved in bounded batches during that phase.
  // - `atFinalize`: combined in the merge's last transaction, once every
  //   batch phase has run.
  // - "removeWithGuest": left on the guest and deleted with it.
  merge:
    | { phase: MergePhase; row: RowMerge<T> }
    | { atFinalize: RowMerge<T> }
    | "removeWithGuest";
  // "keep" rows stay pointed at the anonymized "Former Guest" user.
  expire: "delete" | "keep";
  purge: "delete" | ((ctx: LifecycleCtx, row: Doc<T>) => Promise<void>);
};

function policy<T extends TableNames>(p: Policy<T>) {
  const remove =
    p.remove ??
    (async (ctx: LifecycleCtx, row: Doc<T>) => {
      await ctx.db.delete(p.table, row._id);
    });
  const forEachRow = async (
    ctx: LifecycleCtx,
    userId: UserId,
    fn: (row: Doc<T>) => Promise<void>,
  ) => {
    for (const row of await p.rows(ctx, userId).collect()) await fn(row);
  };
  const { merge, purge } = p;
  const batched = typeof merge === "object" && "phase" in merge ? merge : null;
  const atFinalize =
    typeof merge === "object" && "atFinalize" in merge
      ? merge.atFinalize
      : null;
  return {
    table: p.table,
    field: p.field,
    merge:
      merge === "removeWithGuest"
        ? merge
        : batched !== null
          ? ("batched" as const)
          : ("atFinalize" as const),
    mergePhase: batched?.phase,
    expire: p.expire,
    // Moves up to `limit` guest rows. Each moved row leaves the guest's
    // index, so the next call picks up where this one stopped.
    runMergeBatch: async (
      ctx: LifecycleCtx,
      guest: UserId,
      state: MergeState,
      limit: number,
    ) => {
      if (batched === null) return 0;
      const rows = await p.rows(ctx, guest).take(limit);
      for (const row of rows) await batched.row(ctx, row, state);
      return rows.length;
    },
    hasBatchedRows: async (ctx: LifecycleCtx, guest: UserId) =>
      batched !== null && (await p.rows(ctx, guest).first()) !== null,
    runMergeAtFinalize: async (
      ctx: LifecycleCtx,
      guest: UserId,
      state: MergeState,
    ) => {
      if (atFinalize === null) return;
      await forEachRow(ctx, guest, (row) => atFinalize(ctx, row, state));
    },
    runRemoveWithGuest: async (ctx: LifecycleCtx, guest: UserId) => {
      if (merge !== "removeWithGuest") return;
      await forEachRow(ctx, guest, (row) => remove(ctx, row));
    },
    runExpire: async (ctx: LifecycleCtx, guest: UserId) => {
      if (p.expire === "keep") return;
      await forEachRow(ctx, guest, (row) => remove(ctx, row));
    },
    runPurge: async (ctx: LifecycleCtx, userId: UserId) => {
      await forEachRow(ctx, userId, (row) =>
        purge === "delete" ? remove(ctx, row) : purge(ctx, row),
      );
    },
  };
}

// Operations walk this list in order, and the merge runs its batch phases in
// this order. `rooms` purges before the game and per-user tables, so its
// cascade removes the room's games before later entries look for rows in
// them.
export const USER_KEYED_TABLES = [
  policy({
    table: "authAccounts",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", userId)),
    remove: deleteAuthAccount,
    merge: "removeWithGuest",
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "authSessions",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", userId)),
    remove: deleteAuthSession,
    merge: "removeWithGuest",
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "guestMerges",
    field: "guestUserId",
    rows: (ctx, userId) =>
      ctx.db
        .query("guestMerges")
        .withIndex("by_guest_user", (q) => q.eq("guestUserId", userId)),
    // The finished job is deleted along with its guest.
    merge: "removeWithGuest",
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "guestMerges",
    field: "targetUserId",
    rows: (ctx, userId) =>
      ctx.db
        .query("guestMerges")
        .withIndex("by_target_user", (q) => q.eq("targetUserId", userId)),
    merge: "removeWithGuest",
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "rooms",
    field: "hostUserId",
    rows: (ctx, userId) =>
      ctx.db
        .query("rooms")
        .withIndex("by_host_user", (q) => q.eq("hostUserId", userId)),
    remove: deleteRoom,
    merge: { phase: "hostedRooms", row: mergeHostedRoom },
    // Other members still see the Room in their group history.
    expire: "keep",
    purge: "delete",
  }),
  policy({
    table: "roomMembers",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("roomMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId)),
    merge: { phase: "memberships", row: mergeRoomMembership },
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "gameGuesses",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("gameGuesses")
        .withIndex("by_user", (q) => q.eq("userId", userId)),
    merge: { phase: "guesses", row: mergeGuess },
    // A Game's Guesses are shared history; they show as "Former Guest".
    expire: "keep",
    purge: "delete",
  }),
  policy({
    table: "pendingRequests",
    field: "requesterUserId",
    rows: (ctx, userId) =>
      ctx.db
        .query("pendingRequests")
        .withIndex("by_requester_game_type_status", (q) =>
          q.eq("requesterUserId", userId),
        ),
    merge: { phase: "requests", row: mergeRequest },
    // Part of the Game's record, like its Guesses.
    expire: "keep",
    purge: "delete",
  }),
  policy({
    table: "games",
    field: "winnerUserId",
    rows: (ctx, userId) =>
      ctx.db
        .query("games")
        .withIndex("by_winner_user", (q) => q.eq("winnerUserId", userId)),
    merge: { phase: "wins", row: mergeWin },
    expire: "keep",
    // The Game belongs to the Room; purge only forgets who won it.
    purge: async (ctx, row) => {
      await ctx.db.patch("games", row._id, { winnerUserId: undefined });
    },
  }),
  policy({
    table: "userGameHistory",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("userGameHistory")
        .withIndex("by_user_game", (q) => q.eq("userId", userId)),
    merge: { phase: "history", row: mergeHistory },
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "userAchievements",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("userAchievements")
        .withIndex("by_user_achievement", (q) => q.eq("userId", userId)),
    merge: { phase: "achievements", row: mergeAchievement },
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "userAchievementProgress",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("userAchievementProgress")
        .withIndex("by_user_achievement", (q) => q.eq("userId", userId)),
    merge: { phase: "achievementProgress", row: mergeAchievementProgress },
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "userSolveDays",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("userSolveDays")
        .withIndex("by_user_and_dayKey", (q) => q.eq("userId", userId)),
    merge: { phase: "solveDays", row: mergeSolveDay },
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "gamePlayerStats",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("gamePlayerStats")
        .withIndex("by_user", (q) => q.eq("userId", userId)),
    // Runs after achievement progress so per-game counters land on the
    // merged progress rows.
    merge: { phase: "gamePlayerStats", row: mergeGamePlayerStats },
    expire: "delete",
    purge: "delete",
  }),
  policy({
    table: "userAchievementStats",
    field: "userId",
    rows: (ctx, userId) =>
      ctx.db
        .query("userAchievementStats")
        .withIndex("by_user", (q) => q.eq("userId", userId)),
    // Needs the overlapping-solve count from every history batch.
    merge: { atFinalize: mergeAchievementStats },
    expire: "delete",
    purge: "delete",
  }),
];

// Deletes what a finished merge leaves on the guest, then the guest itself.
export async function deleteMergedGuest(
  ctx: LifecycleCtx,
  guestUserId: UserId,
) {
  for (const p of USER_KEYED_TABLES) {
    await p.runRemoveWithGuest(ctx, guestUserId);
  }
  if ((await ctx.db.get("users", guestUserId)) !== null) {
    await ctx.db.delete("users", guestUserId);
  }
}

// Guests are anonymized rather than deleted so the rows kept for shared Room
// history still point at a user.
export async function expireGuest(ctx: LifecycleCtx, guestUserId: UserId) {
  for (const p of USER_KEYED_TABLES) await p.runExpire(ctx, guestUserId);
  await ctx.db.patch("users", guestUserId, {
    name: "Former Guest",
    image: undefined,
    email: undefined,
    username: undefined,
    displayUsername: undefined,
    isAnonymous: false,
    guestCompletedGames: undefined,
    guestPromptedGames: undefined,
    guestExpiresAt: undefined,
  });
}

export async function deleteAccount(
  ctx: Pick<MutationCtx, "db" | "storage">,
  userId: UserId,
) {
  // ponytail: E2E accounts are deleted every run; batch this if a test can
  // create hundreds of rows before cleanup.
  for (const p of USER_KEYED_TABLES) await p.runPurge(ctx, userId);
  const user = await ctx.db.get("users", userId);
  if (user?.avatarStorageId !== undefined) {
    await ctx.storage.delete(user.avatarStorageId);
  }
  await ctx.db.delete("users", userId);
}

async function deleteAuthAccount(
  ctx: LifecycleCtx,
  account: Doc<"authAccounts">,
) {
  const codes = await ctx.db
    .query("authVerificationCodes")
    .withIndex("accountId", (q) => q.eq("accountId", account._id))
    .collect();
  for (const code of codes) {
    await ctx.db.delete("authVerificationCodes", code._id);
  }
  await ctx.db.delete("authAccounts", account._id);
}

async function deleteAuthSession(
  ctx: LifecycleCtx,
  session: Doc<"authSessions">,
) {
  const tokens = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
    .collect();
  for (const token of tokens) {
    await ctx.db.delete("authRefreshTokens", token._id);
  }
  await ctx.db.delete("authSessions", session._id);
}

async function deleteRoom(ctx: LifecycleCtx, room: Doc<"rooms">) {
  for (const status of ["pending", "approved", "denied"] as const) {
    const requests = await ctx.db
      .query("pendingRequests")
      .withIndex("by_room_status", (q) =>
        q.eq("roomId", room._id).eq("status", status),
      )
      .collect();
    for (const request of requests) {
      await ctx.db.delete("pendingRequests", request._id);
    }
  }
  const games = await ctx.db
    .query("games")
    .withIndex("by_room_started", (q) => q.eq("roomId", room._id))
    .collect();
  for (const game of games) {
    const [guesses, playerStats] = await Promise.all([
      ctx.db
        .query("gameGuesses")
        .withIndex("by_game_created", (q) => q.eq("gameId", game._id))
        .collect(),
      ctx.db
        .query("gamePlayerStats")
        .withIndex("by_game_user", (q) => q.eq("gameId", game._id))
        .collect(),
    ]);
    for (const row of guesses) await ctx.db.delete("gameGuesses", row._id);
    for (const row of playerStats) {
      await ctx.db.delete("gamePlayerStats", row._id);
    }
    await ctx.db.delete("games", game._id);
  }
  const [members, activity] = await Promise.all([
    ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", room._id))
      .collect(),
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .unique(),
  ]);
  for (const member of members) await ctx.db.delete("roomMembers", member._id);
  if (activity !== null) await ctx.db.delete("roomActivity", activity._id);
  await ctx.db.delete("rooms", room._id);
}
