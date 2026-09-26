import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Deletes a user's per-user stats, progress, and membership rows. Shared by
// guest expiry and E2E account cleanup. Each table is queried through its own
// index because the tables don't share a common index name.
//
// Intentionally leaves `gameGuesses` and `pendingRequests`: they belong to a
// shared game/room that other players still see, so guest expiry keeps them
// pointing at the anonymized user. E2E purge deletes them itself because it
// removes the user row too.
export async function deleteUserStatsAndMemberships(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const roomMembers = await ctx.db
    .query("roomMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of roomMembers) {
    await ctx.db.delete("roomMembers", row._id);
  }

  const userGameHistory = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) => q.eq("userId", userId))
    .collect();
  for (const row of userGameHistory) {
    await ctx.db.delete("userGameHistory", row._id);
  }

  const userAchievements = await ctx.db
    .query("userAchievements")
    .withIndex("by_user_achievement", (q) => q.eq("userId", userId))
    .collect();
  for (const row of userAchievements) {
    await ctx.db.delete("userAchievements", row._id);
  }

  const userAchievementProgress = await ctx.db
    .query("userAchievementProgress")
    .withIndex("by_user_achievement", (q) => q.eq("userId", userId))
    .collect();
  for (const row of userAchievementProgress) {
    await ctx.db.delete("userAchievementProgress", row._id);
  }

  const gamePlayerStats = await ctx.db
    .query("gamePlayerStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of gamePlayerStats) {
    await ctx.db.delete("gamePlayerStats", row._id);
  }

  const userSolveDays = await ctx.db
    .query("userSolveDays")
    .withIndex("by_user_and_dayKey", (q) => q.eq("userId", userId))
    .collect();
  for (const row of userSolveDays) {
    await ctx.db.delete("userSolveDays", row._id);
  }

  const userAchievementStats = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (userAchievementStats !== null) {
    await ctx.db.delete("userAchievementStats", userAchievementStats._id);
  }
}

// Deletes a user's auth graph: accounts with their verification codes and
// sessions with their refresh tokens. Shared by guest expiry, guest merge and
// E2E account cleanup.
export async function deleteUserAuthData(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const code of codes)
      await ctx.db.delete("authVerificationCodes", code._id);
    await ctx.db.delete("authAccounts", account._id);
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
    for (const token of tokens)
      await ctx.db.delete("authRefreshTokens", token._id);
    await ctx.db.delete("authSessions", session._id);
  }
}
