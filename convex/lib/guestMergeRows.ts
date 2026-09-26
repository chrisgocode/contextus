import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { evaluateCounterRules } from "./achievementRules";
import { getAchievementDefinition } from "./achievements";

// Per-row merge handlers registered in `accountLifecycle.ts` and run by the
// batched merge in `guestMerge.ts`. Each one moves a guest row onto the
// target user, combining it with the target's matching row when there is one.

type MergeCtx = Pick<MutationCtx, "db">;

// What a merge carries between rows. `guestMerge.ts` loads it from the
// `guestMerges` job and saves `overlappingSolves` back after each batch.
export type MergeState = {
  targetUserId: Id<"users">;
  // Puzzles both sides solved, so combined uniqueSolves counts them once.
  overlappingSolves: number;
};

export async function mergeHostedRoom(
  ctx: MergeCtx,
  row: Doc<"rooms">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
  await ctx.db.patch("rooms", row._id, { hostUserId: targetUserId });
}

export async function mergeRoomMembership(
  ctx: MergeCtx,
  row: Doc<"roomMembers">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
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

export async function mergeGuess(
  ctx: MergeCtx,
  row: Doc<"gameGuesses">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
  await ctx.db.patch("gameGuesses", row._id, { userId: targetUserId });
}

export async function mergeRequest(
  ctx: MergeCtx,
  row: Doc<"pendingRequests">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
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

export async function mergeWin(
  ctx: MergeCtx,
  row: Doc<"games">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
  await ctx.db.patch("games", row._id, { winnerUserId: targetUserId });
}

export async function mergeHistory(
  ctx: MergeCtx,
  row: Doc<"userGameHistory">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
  const existing = await ctx.db
    .query("userGameHistory")
    .withIndex("by_user_game", (q) =>
      q.eq("userId", targetUserId).eq("contextoGameId", row.contextoGameId),
    )
    .unique();
  if (existing === null) {
    await ctx.db.patch("userGameHistory", row._id, { userId: targetUserId });
    return;
  }
  if (existing.firstSolvedAt !== undefined && row.firstSolvedAt !== undefined) {
    merge.overlappingSolves += 1;
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

export async function mergeAchievement(
  ctx: MergeCtx,
  row: Doc<"userAchievements">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
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

export async function mergeAchievementProgress(
  ctx: MergeCtx,
  row: Doc<"userAchievementProgress">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
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

// Runs in the merge's final transaction, after every history row has moved
// and counted its overlapping solves.
export async function mergeAchievementStats(
  ctx: MergeCtx,
  row: Doc<"userAchievementStats">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
  const target = await ctx.db
    .query("userAchievementStats")
    .withIndex("by_user", (q) => q.eq("userId", targetUserId))
    .unique();
  if (target === null) {
    await ctx.db.patch("userAchievementStats", row._id, {
      userId: targetUserId,
    });
    return;
  }
  await ctx.db.patch("userAchievementStats", target._id, {
    redGuesses: target.redGuesses + row.redGuesses,
    yellowGuesses: target.yellowGuesses + row.yellowGuesses,
    greenGuesses: target.greenGuesses + row.greenGuesses,
    uniqueSolves: Math.max(
      0,
      target.uniqueSolves + row.uniqueSolves - merge.overlappingSolves,
    ),
  });
  await ctx.db.delete("userAchievementStats", row._id);
}

export async function mergeSolveDay(
  ctx: MergeCtx,
  row: Doc<"userSolveDays">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
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

export async function mergeGamePlayerStats(
  ctx: MergeCtx,
  row: Doc<"gamePlayerStats">,
  merge: MergeState,
) {
  const { targetUserId } = merge;
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
    return;
  }
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

export async function reconcileCounterAchievements(
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

export async function applyCounterValue(
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

function earliest(a: number | undefined, b: number | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}
