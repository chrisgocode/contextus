import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { env, mutation, type MutationCtx } from "./_generated/server";
import {
  deleteUserAuthData,
  deleteUserStatsAndMemberships,
} from "./lib/userStatsRows";

const E2E_EMAIL = /^contextus-e2e-[a-z0-9-]{1,32}-w\d+-u[01]@example\.com$/;

export const purgeAccount = mutation({
  args: { email: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, { email }) => {
    if (env.E2E_TEST !== "1" || !E2E_EMAIL.test(email)) {
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
    await ctx.db.delete("users", user._id);
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

  await deleteUserStatsAndMemberships(ctx, userId);
  const guesses = await ctx.db
    .query("gameGuesses")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of guesses) await ctx.db.delete("gameGuesses", row._id);

  const requests = await ctx.db
    .query("pendingRequests")
    .withIndex("by_requester_game_type_status", (q) =>
      q.eq("requesterUserId", userId),
    )
    .collect();
  for (const request of requests)
    await ctx.db.delete("pendingRequests", request._id);
  const wins = await ctx.db
    .query("games")
    .withIndex("by_winner_user", (q) => q.eq("winnerUserId", userId))
    .collect();
  for (const game of wins)
    await ctx.db.patch("games", game._id, { winnerUserId: undefined });

  await deleteUserAuthData(ctx, userId);
  const rateLimit = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", email))
    .unique();
  if (rateLimit !== null) await ctx.db.delete("authRateLimits", rateLimit._id);
}

async function deleteRoom(ctx: MutationCtx, roomId: Id<"rooms">) {
  for (const status of ["pending", "approved", "denied"] as const) {
    const requests = await ctx.db
      .query("pendingRequests")
      .withIndex("by_room_status", (q) =>
        q.eq("roomId", roomId).eq("status", status),
      )
      .collect();
    for (const request of requests)
      await ctx.db.delete("pendingRequests", request._id);
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
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
      .collect(),
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique(),
  ]);
  for (const member of members) await ctx.db.delete("roomMembers", member._id);
  if (activity !== null) await ctx.db.delete("roomActivity", activity._id);
  await ctx.db.delete("rooms", roomId);
}
