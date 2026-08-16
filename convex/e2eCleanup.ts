import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";

const E2E_EMAIL = /^contextus-e2e-[a-z0-9-]{1,32}-w\d+-u[01]@example\.com$/;

export const purgeAccount = mutation({
  args: { email: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, { email }) => {
    if (process.env.E2E_TEST !== "1" || !E2E_EMAIL.test(email)) {
      throw new ConvexError("E2E cleanup is unavailable");
    }
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (user === null) return { deleted: false };

    await deleteUserData(ctx, user._id, email);
    if (user.avatarStorageId !== undefined) {
      await ctx.storage.delete(user.avatarStorageId);
    }
    await ctx.db.delete(user._id);
    return { deleted: true };
  },
});

async function deleteUserData(
  ctx: MutationCtx,
  userId: Id<"users">,
  email: string,
) {
  // ponytail: E2E accounts are deleted every run; batch this if a test can create
  // hundreds of rows before cleanup.
  const hostedRooms = await ctx.db
    .query("rooms")
    .withIndex("by_host_user", (q) => q.eq("hostUserId", userId))
    .collect();
  for (const room of hostedRooms) await deleteRoom(ctx, room._id);

  for (const table of [
    "roomMembers",
    "gameGuesses",
    "userGameHistory",
    "userAchievements",
    "userAchievementProgress",
    "gamePlayerStats",
  ] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  }
  const stats = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats !== null) await ctx.db.delete(stats._id);

  const requests = await ctx.db
    .query("pendingRequests")
    .withIndex("by_requester", (q) => q.eq("requesterUserId", userId))
    .collect();
  for (const request of requests) await ctx.db.delete(request._id);
  const wins = await ctx.db
    .query("games")
    .withIndex("by_winner_user", (q) => q.eq("winnerUserId", userId))
    .collect();
  for (const game of wins)
    await ctx.db.patch(game._id, { winnerUserId: undefined });

  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const code of codes) await ctx.db.delete(code._id);
    await ctx.db.delete(account._id);
  }
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    await ctx.db.delete(session._id);
  }
  const rateLimit = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", email))
    .unique();
  if (rateLimit !== null) await ctx.db.delete(rateLimit._id);
}

async function deleteRoom(ctx: MutationCtx, roomId: Id<"rooms">) {
  for (const status of ["pending", "approved", "denied"] as const) {
    const requests = await ctx.db
      .query("pendingRequests")
      .withIndex("by_room_status", (q) =>
        q.eq("roomId", roomId).eq("status", status),
      )
      .collect();
    for (const request of requests) await ctx.db.delete(request._id);
  }
  const games = await ctx.db
    .query("games")
    .withIndex("by_room_started", (q) => q.eq("roomId", roomId))
    .collect();
  for (const game of games) {
    const [guesses, playerStats] = await Promise.all([
      ctx.db
        .query("gameGuesses")
        .withIndex("by_game_created", (q) => q.eq("gameId", game._id))
        .collect(),
      ctx.db
        .query("gamePlayerStats")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .collect(),
    ]);
    for (const row of [...guesses, ...playerStats])
      await ctx.db.delete(row._id);
    await ctx.db.delete(game._id);
  }
  const [members, activity] = await Promise.all([
    ctx.db
      .query("roomMembers")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique(),
  ]);
  for (const member of members) await ctx.db.delete(member._id);
  if (activity !== null) await ctx.db.delete(activity._id);
  await ctx.db.delete(roomId);
}
