import { getAuthSessionId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { evaluateCounterRules } from "./achievementRules";
import { getAchievementDefinition } from "./achievements";
import { longestStreak } from "./localTime";

type MergeCtx = Pick<MutationCtx, "auth" | "db">;

async function currentUserFromSession(
  ctx: MergeCtx,
): Promise<Id<"users"> | null> {
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId === null) return null;
  const session = await ctx.db.get("authSessions", sessionId);
  return session?.userId ?? null;
}

export async function mergeCurrentGuestIntoUser(
  ctx: MergeCtx,
  targetUserId: Id<"users">,
): Promise<Id<"users"> | null> {
  const guestUserId = await currentUserFromSession(ctx);
  if (guestUserId === null || guestUserId === targetUserId) return null;
  const [guest, target] = await Promise.all([
    ctx.db.get("users", guestUserId),
    ctx.db.get("users", targetUserId),
  ]);
  if (guest?.isAnonymous !== true || target === null) return null;

  const overlappingSolvesPromise = mergeHistory(ctx, guestUserId, targetUserId);
  await Promise.all([
    patchGuestHostedRooms(ctx, guestUserId, targetUserId),
    mergeRoomMemberships(ctx, guestUserId, targetUserId),
    patchGuestGuesses(ctx, guestUserId, targetUserId),
    patchGuestRequests(ctx, guestUserId, targetUserId),
    patchGuestWins(ctx, guestUserId, targetUserId),
    overlappingSolvesPromise,
    mergeAchievements(ctx, guestUserId, targetUserId),
    mergeAchievementProgress(ctx, guestUserId, targetUserId),
    mergeSolveDays(ctx, guestUserId, targetUserId),
  ]);
  const mergeResults = {
    overlappingSolves: await overlappingSolvesPromise,
  };
  await Promise.all([
    mergeAchievementStats(
      ctx,
      guestUserId,
      targetUserId,
      mergeResults.overlappingSolves,
    ),
    mergeGamePlayerStats(ctx, guestUserId, targetUserId),
  ]);
  await reconcileCounterAchievements(ctx, targetUserId);
  await reconcileStreakAchievements(ctx, targetUserId);
  return guestUserId;
}

async function patchGuestHostedRooms(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("rooms")
    .withIndex("by_host_user", (q) => q.eq("hostUserId", guestUserId))
    .collect();
  for (const row of rows) {
    await ctx.db.patch("rooms", row._id, { hostUserId: targetUserId });
  }
}

async function mergeRoomMemberships(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("roomMembers")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .collect();
  for (const row of rows) {
    const existing = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) =>
        q.eq("roomId", row.roomId).eq("userId", targetUserId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("roomMembers", row._id, { userId: targetUserId });
    } else {
      await ctx.db.patch("roomMembers", existing._id, {
        joinedAt: Math.min(existing.joinedAt, row.joinedAt),
      });
      await ctx.db.delete("roomMembers", row._id);
    }
  }
}

async function patchGuestGuesses(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("gameGuesses")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .collect();
  for (const row of rows) {
    await ctx.db.patch("gameGuesses", row._id, { userId: targetUserId });
  }
}

async function patchGuestRequests(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("pendingRequests")
    .withIndex("by_requester_game_type_status", (q) =>
      q.eq("requesterUserId", guestUserId),
    )
    .collect();
  for (const row of rows) {
    const existing = await ctx.db
      .query("pendingRequests")
      .withIndex("by_requester_game_type_status", (q) =>
        q
          .eq("requesterUserId", targetUserId)
          .eq("gameId", row.gameId)
          .eq("type", row.type)
          .eq("status", row.status),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("pendingRequests", row._id, {
        requesterUserId: targetUserId,
      });
    } else {
      await ctx.db.delete("pendingRequests", row._id);
    }
  }
}

async function patchGuestWins(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("games")
    .withIndex("by_winner_user", (q) => q.eq("winnerUserId", guestUserId))
    .collect();
  for (const row of rows) {
    await ctx.db.patch("games", row._id, { winnerUserId: targetUserId });
  }
}

async function mergeHistory(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  let overlappingSolves = 0;
  const rows = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) => q.eq("userId", guestUserId))
    .collect();
  for (const row of rows) {
    const existing = await ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) =>
        q.eq("userId", targetUserId).eq("contextoGameId", row.contextoGameId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userGameHistory", row._id, { userId: targetUserId });
      continue;
    }
    if (
      existing.firstSolvedAt !== undefined &&
      row.firstSolvedAt !== undefined
    ) {
      overlappingSolves += 1;
    }
    await ctx.db.patch("userGameHistory", existing._id, {
      firstPlayedAt: Math.min(existing.firstPlayedAt, row.firstPlayedAt),
      firstAttemptAt: earliest(existing.firstAttemptAt, row.firstAttemptAt),
      firstAttemptDistance:
        existing.firstAttemptAt === undefined ||
        (row.firstAttemptAt !== undefined &&
          row.firstAttemptAt < existing.firstAttemptAt)
          ? row.firstAttemptDistance
          : existing.firstAttemptDistance,
      firstAttemptGameId:
        existing.firstAttemptAt === undefined ||
        (row.firstAttemptAt !== undefined &&
          row.firstAttemptAt < existing.firstAttemptAt)
          ? row.firstAttemptGameId
          : existing.firstAttemptGameId,
      firstSolvedAt: earliest(existing.firstSolvedAt, row.firstSolvedAt),
      firstSolvedGameId:
        existing.firstSolvedAt === undefined ||
        (row.firstSolvedAt !== undefined &&
          row.firstSolvedAt < existing.firstSolvedAt)
          ? row.firstSolvedGameId
          : existing.firstSolvedGameId,
    });
    await ctx.db.delete("userGameHistory", row._id);
  }
  return overlappingSolves;
}

async function mergeAchievements(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("userAchievements")
    .withIndex("by_user_achievement", (q) => q.eq("userId", guestUserId))
    .collect();
  for (const row of rows) {
    const existing = await ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", targetUserId).eq("achievementId", row.achievementId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userAchievements", row._id, { userId: targetUserId });
    } else {
      await ctx.db.patch("userAchievements", existing._id, {
        unlockedAt: Math.min(existing.unlockedAt, row.unlockedAt),
      });
      await ctx.db.delete("userAchievements", row._id);
    }
  }
}

async function mergeAchievementProgress(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("userAchievementProgress")
    .withIndex("by_user_achievement", (q) => q.eq("userId", guestUserId))
    .collect();
  for (const row of rows) {
    const existing = await ctx.db
      .query("userAchievementProgress")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", targetUserId).eq("achievementId", row.achievementId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userAchievementProgress", row._id, {
        userId: targetUserId,
      });
    } else {
      await ctx.db.patch("userAchievementProgress", existing._id, {
        current: Math.max(existing.current, row.current),
        target: Math.max(existing.target, row.target),
        hidden: existing.hidden && row.hidden,
        updatedAt: Math.max(existing.updatedAt, row.updatedAt),
      });
      await ctx.db.delete("userAchievementProgress", row._id);
    }
  }
}

async function mergeAchievementStats(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
  overlappingSolves: number,
) {
  const guest = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .unique();
  if (guest === null) return;
  const target = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", targetUserId))
    .unique();
  if (target === null) {
    await ctx.db.patch("userAchievementStats", guest._id, {
      userId: targetUserId,
    });
    return;
  }
  await ctx.db.patch("userAchievementStats", target._id, {
    redGuesses: target.redGuesses + guest.redGuesses,
    yellowGuesses: target.yellowGuesses + guest.yellowGuesses,
    greenGuesses: target.greenGuesses + guest.greenGuesses,
    uniqueSolves: Math.max(
      0,
      target.uniqueSolves + guest.uniqueSolves - overlappingSolves,
    ),
  });
  await ctx.db.delete("userAchievementStats", guest._id);
}

async function mergeSolveDays(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("userSolveDays")
    .withIndex("by_user_and_dayKey", (q) => q.eq("userId", guestUserId))
    .collect();
  for (const row of rows) {
    const existing = await ctx.db
      .query("userSolveDays")
      .withIndex("by_user_and_dayKey", (q) =>
        q.eq("userId", targetUserId).eq("dayKey", row.dayKey),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("userSolveDays", row._id, { userId: targetUserId });
    } else {
      await ctx.db.delete("userSolveDays", row._id);
    }
  }
}

async function mergeGamePlayerStats(
  ctx: MergeCtx,
  guestUserId: Id<"users">,
  targetUserId: Id<"users">,
) {
  const rows = await ctx.db
    .query("gamePlayerStats")
    .withIndex("by_user", (q) => q.eq("userId", guestUserId))
    .collect();
  for (const row of rows) {
    const existing = await ctx.db
      .query("gamePlayerStats")
      .withIndex("by_game_user", (q) =>
        q.eq("gameId", row.gameId).eq("userId", targetUserId),
      )
      .unique();
    if (existing === null) {
      await ctx.db.patch("gamePlayerStats", row._id, { userId: targetUserId });
      await applyCounterValue(
        ctx,
        targetUserId,
        "gameRealGuesses",
        row.realGuessCount,
        Date.now(),
      );
    } else {
      const realGuessCount = existing.realGuessCount + row.realGuessCount;
      await ctx.db.patch("gamePlayerStats", existing._id, {
        realGuessCount,
        bestDistance: Math.min(existing.bestDistance, row.bestDistance),
        lastDistance:
          row.updatedAt > existing.updatedAt
            ? row.lastDistance
            : existing.lastDistance,
        noBacktrackingSoFar:
          existing.noBacktrackingSoFar && row.noBacktrackingSoFar,
        updatedAt: Math.max(existing.updatedAt, row.updatedAt),
      });
      await ctx.db.delete("gamePlayerStats", row._id);
      await applyCounterValue(
        ctx,
        targetUserId,
        "gameRealGuesses",
        realGuessCount,
        Date.now(),
      );
    }
  }
}

async function reconcileCounterAchievements(
  ctx: MergeCtx,
  userId: Id<"users">,
) {
  const stats = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats === null) return;
  const counters = {
    redGuesses: stats.redGuesses,
    yellowGuesses: stats.yellowGuesses,
    greenGuesses: stats.greenGuesses,
    uniqueSolves: stats.uniqueSolves,
  };
  const now = Date.now();
  for (const [counterId, value] of Object.entries(counters)) {
    await applyCounterValue(
      ctx,
      userId,
      counterId as keyof typeof counters,
      value,
      now,
    );
  }
}

async function applyCounterValue(
  ctx: MergeCtx,
  userId: Id<"users">,
  counterId: Parameters<typeof evaluateCounterRules>[0],
  value: number,
  now: number,
) {
  for (const rule of evaluateCounterRules(counterId, value)) {
    const definition = getAchievementDefinition(rule.achievementId);
    if (definition?.active !== true) continue;
    const progress = await ctx.db
      .query("userAchievementProgress")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", userId).eq("achievementId", rule.achievementId),
      )
      .unique();
    const current = Math.min(value, rule.threshold);
    if (progress === null) {
      await ctx.db.insert("userAchievementProgress", {
        userId,
        achievementId: rule.achievementId,
        current,
        target: rule.threshold,
        hidden: definition.hidden,
        updatedAt: now,
      });
    } else if (current > progress.current) {
      await ctx.db.patch("userAchievementProgress", progress._id, {
        current,
        updatedAt: now,
      });
    }
    if (!rule.shouldUnlock) continue;
    const unlocked = await ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) =>
        q.eq("userId", userId).eq("achievementId", rule.achievementId),
      )
      .unique();
    if (unlocked === null) {
      await ctx.db.insert("userAchievements", {
        userId,
        achievementId: rule.achievementId,
        unlockedAt: now,
      });
    }
  }
}

// Guest and account solve days can interleave into a longer streak than
// either side had alone.
async function reconcileStreakAchievements(ctx: MergeCtx, userId: Id<"users">) {
  const rows = await ctx.db
    .query("userSolveDays")
    .withIndex("by_user_and_dayKey", (q) => q.eq("userId", userId))
    .collect();
  if (rows.length === 0) return;
  await applyCounterValue(
    ctx,
    userId,
    "streakDays",
    longestStreak(new Set(rows.map((row) => row.dayKey))),
    Date.now(),
  );
}

function earliest(a: number | undefined, b: number | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}
