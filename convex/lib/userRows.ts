import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Deletes the per-user rows shared by guest expiry and E2E account cleanup.
// Each table is queried through its own index because the tables don't
// share a common index name.
export async function deleteUserOwnedRows(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const memberships = await ctx.db
    .query("roomMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of memberships) await ctx.db.delete("roomMembers", row._id);

  const history = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) => q.eq("userId", userId))
    .collect();
  for (const row of history) await ctx.db.delete("userGameHistory", row._id);

  const achievements = await ctx.db
    .query("userAchievements")
    .withIndex("by_user_achievement", (q) => q.eq("userId", userId))
    .collect();
  for (const row of achievements) {
    await ctx.db.delete("userAchievements", row._id);
  }

  const progress = await ctx.db
    .query("userAchievementProgress")
    .withIndex("by_user_achievement", (q) => q.eq("userId", userId))
    .collect();
  for (const row of progress) {
    await ctx.db.delete("userAchievementProgress", row._id);
  }

  const stats = await ctx.db
    .query("gamePlayerStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of stats) await ctx.db.delete("gamePlayerStats", row._id);
}
