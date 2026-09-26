import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { env, internalMutation, query } from "./_generated/server";

const ONLINE_WINDOW_MS = 45_000;
const HISTORY_MS = 24 * 60 * 60_000;
const RETENTION_MS = 7 * HISTORY_MS;
// ponytail: bounded scan; use a sharded counter if concurrency exceeds 1,000.
const COUNT_LIMIT = 1_000;

export const overview = query({
  args: { refresh: v.number() },
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const user = userId === null ? null : await ctx.db.get("users", userId);
    const ownerEmail = env.PLAYER_COUNT_OWNER_EMAIL?.trim().toLowerCase();
    if (
      !ownerEmail ||
      user?.isAnonymous !== false ||
      user.email?.toLowerCase() !== ownerEmail
    ) {
      return null;
    }

    const now = Date.now();
    const online = await ctx.db
      .query("playerPresence")
      .withIndex("by_lastSeenAt", (q) =>
        q.gte("lastSeenAt", now - ONLINE_WINDOW_MS),
      )
      .take(COUNT_LIMIT + 1);
    const samples = await ctx.db
      .query("playerCountSamples")
      .withIndex("by_sampledAt", (q) => q.gte("sampledAt", now - HISTORY_MS))
      .order("desc")
      .take(1_440);
    return {
      count: Math.min(online.length, COUNT_LIMIT),
      capped: online.length > COUNT_LIMIT,
      asOf: now,
      samples: samples.reverse().map(({ sampledAt, count }) => ({
        sampledAt,
        count,
      })),
    };
  },
});

export const sample = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const online = await ctx.db
      .query("playerPresence")
      .withIndex("by_lastSeenAt", (q) =>
        q.gte("lastSeenAt", now - ONLINE_WINDOW_MS),
      )
      .take(COUNT_LIMIT + 1);
    await ctx.db.insert("playerCountSamples", {
      sampledAt: now,
      count: online.length,
    });

    const stalePresence = await ctx.db
      .query("playerPresence")
      .withIndex("by_lastSeenAt", (q) => q.lt("lastSeenAt", now - RETENTION_MS))
      .take(100);
    const staleSamples = await ctx.db
      .query("playerCountSamples")
      .withIndex("by_sampledAt", (q) => q.lt("sampledAt", now - RETENTION_MS))
      .take(100);
    for (const row of stalePresence) {
      await ctx.db.delete("playerPresence", row._id);
    }
    for (const row of staleSamples) {
      await ctx.db.delete("playerCountSamples", row._id);
    }
  },
});
