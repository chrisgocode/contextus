import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import {
  type AcceptedGuessEvent,
  type AchievementId,
  type AchievementRepository,
  type AchievementStats,
  achievementDefinitions,
  createAchievementService,
} from "./lib/achievements";

const INITIAL_STATS: AchievementStats = {
  redGuesses: 0,
  yellowGuesses: 0,
  greenGuesses: 0,
  uniqueSolves: 0,
};

export const listForProfile = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await getUserByUsername(ctx, username.trim());
    if (user === null) return null;

    const currentUserId = await getAuthUserId(ctx);
    const isCurrentUser = currentUserId === user._id;
    const [unlocks, progressRows] = await Promise.all([
      ctx.db
        .query("userAchievements")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect(),
      ctx.db
        .query("userAchievementProgress")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect(),
    ]);

    const unlockByAchievement = new Map(
      unlocks.map((row) => [row.achievementId, row]),
    );
    const progressByAchievement = new Map(
      progressRows.map((row) => [row.achievementId, row]),
    );

    const achievements = achievementDefinitions.map((definition) => {
      const unlock = unlockByAchievement.get(definition.id);
      const unlocked = unlock !== undefined;
      const progress = progressByAchievement.get(definition.id);
      const masked = definition.hidden && !unlocked;
      const includeProgress = isCurrentUser && !masked && !unlocked;

      return {
        achievementId: definition.id,
        hidden: definition.hidden,
        masked,
        unlocked,
        unlockedAt: unlock?.unlockedAt ?? null,
        progress: includeProgress
          ? {
              current: progress?.current ?? 0,
              target: progress?.target ?? definition.target,
            }
          : null,
        target: definition.target,
      };
    });

    return {
      isCurrentUser,
      achievements,
      unlockedCount: unlocks.length,
    };
  },
});

export async function recordAcceptedGuessForAchievements(
  ctx: MutationCtx,
  event: AcceptedGuessEvent,
): Promise<AchievementId[]> {
  const service = createAchievementService({
    repo: createConvexAchievementRepository(ctx),
  });
  return await service.recordAcceptedGuess(event);
}

function createConvexAchievementRepository(
  ctx: MutationCtx,
): AchievementRepository {
  return {
    async getOrCreateStats(userId) {
      const row = await getStatsRow(ctx, userId);
      if (row !== null) return statsFromRow(row);
      await ctx.db.insert("userAchievementStats", {
        userId,
        ...INITIAL_STATS,
      });
      return { ...INITIAL_STATS };
    },

    async saveStats(userId, stats) {
      const row = await getStatsRow(ctx, userId);
      if (row === null) {
        await ctx.db.insert("userAchievementStats", { userId, ...stats });
      } else {
        await ctx.db.patch(row._id, stats);
      }
    },

    async updateProgress(userId, achievementId, current, target, hidden, now) {
      const row = await getProgressRow(ctx, userId, achievementId);
      const clampedCurrent = Math.min(current, target);
      if (row === null) {
        await ctx.db.insert("userAchievementProgress", {
          userId,
          achievementId,
          current: clampedCurrent,
          target,
          hidden,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(row._id, {
          current: Math.max(row.current, clampedCurrent),
          target,
          hidden,
          updatedAt: now,
        });
      }
    },

    async unlock(userId, achievementId, now) {
      const existing = await ctx.db
        .query("userAchievements")
        .withIndex("by_user_achievement", (q) =>
          q.eq("userId", userId).eq("achievementId", achievementId),
        )
        .unique();
      if (existing === null) {
        await ctx.db.insert("userAchievements", {
          userId,
          achievementId,
          unlockedAt: now,
        });
        return true;
      }
      return false;
    },

    async recordRealGuess(event) {
      const existing = await ctx.db
        .query("gamePlayerStats")
        .withIndex("by_game_user", (q) =>
          q.eq("gameId", event.gameId).eq("userId", event.userId),
        )
        .unique();
      const history = await getOrCreateHistory(
        ctx,
        event.userId,
        event.contextoGameId,
        event.now,
      );
      const isFirstEverAttemptForPuzzle = history.firstAttemptAt === undefined;
      if (isFirstEverAttemptForPuzzle) {
        await ctx.db.patch(history._id, {
          firstAttemptAt: event.now,
          firstAttemptDistance: event.distance,
          firstAttemptGameId: event.gameId,
        });
      }

      if (existing === null) {
        const stats = {
          realGuessCount: 1,
          bestDistance: event.distance,
          lastDistance: event.distance,
          noBacktrackingSoFar: true,
        };
        await ctx.db.insert("gamePlayerStats", {
          gameId: event.gameId,
          userId: event.userId,
          ...stats,
          updatedAt: event.now,
        });
        return {
          playerStats: stats,
          history,
          isFirstEverAttemptForPuzzle,
        };
      }

      const stats = {
        realGuessCount: existing.realGuessCount + 1,
        bestDistance: Math.min(existing.bestDistance, event.distance),
        lastDistance: event.distance,
        noBacktrackingSoFar:
          existing.noBacktrackingSoFar &&
          event.distance < existing.lastDistance,
      };
      await ctx.db.patch(existing._id, {
        ...stats,
        updatedAt: event.now,
      });
      return {
        playerStats: stats,
        history,
        isFirstEverAttemptForPuzzle,
      };
    },

    async listActiveGuessers(gameId) {
      const rows = await ctx.db
        .query("gamePlayerStats")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .take(500);
      return rows.map((row) => row.userId);
    },

    async markSolvedOnce(userId, gameId, contextoGameId, now) {
      const history = await getOrCreateHistory(
        ctx,
        userId,
        contextoGameId,
        now,
      );
      if (history.firstSolvedAt !== undefined) return false;
      await ctx.db.patch(history._id, {
        firstSolvedAt: now,
        firstSolvedGameId: gameId,
      });
      return true;
    },

    async countTeamRealGuesses(gameId) {
      let count = 0;
      const guesses = await ctx.db
        .query("gameGuesses")
        .withIndex("by_game_created", (q) => q.eq("gameId", gameId))
        .take(500);
      for (const guess of guesses) {
        if (guess.source === "guess") count += 1;
      }
      return count;
    },
  };
}

async function getStatsRow(ctx: MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function statsFromRow(row: Doc<"userAchievementStats">): AchievementStats {
  return {
    redGuesses: row.redGuesses,
    yellowGuesses: row.yellowGuesses,
    greenGuesses: row.greenGuesses,
    uniqueSolves: row.uniqueSolves,
  };
}

async function getProgressRow(
  ctx: MutationCtx,
  userId: Id<"users">,
  achievementId: AchievementId,
) {
  return await ctx.db
    .query("userAchievementProgress")
    .withIndex("by_user_achievement", (q) =>
      q.eq("userId", userId).eq("achievementId", achievementId),
    )
    .unique();
}

async function getOrCreateHistory(
  ctx: MutationCtx,
  userId: Id<"users">,
  contextoGameId: number,
  now: number,
) {
  const existing = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) =>
      q.eq("userId", userId).eq("contextoGameId", contextoGameId),
    )
    .unique();
  if (existing !== null) return existing;
  const id = await ctx.db.insert("userGameHistory", {
    userId,
    contextoGameId,
    firstPlayedAt: now,
  });
  const inserted = await ctx.db.get(id);
  if (inserted === null) {
    throw new Error("Inserted userGameHistory row could not be read");
  }
  return inserted;
}

async function getUserByUsername(ctx: Pick<QueryCtx, "db">, username: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_username", (q) => q.eq("username", username.toLowerCase()))
    .unique();
}
