import { expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { GUEST_MERGE_BATCH_SIZE, startGuestMerge } from "../lib/guestMerge";
import {
  asUser,
  asUserWithSession,
  seedUser,
  setupTest,
} from "../testHelpers.test";
import { api, internal } from "../_generated/api";

async function mergeGuest(
  t: ReturnType<typeof setupTest>,
  guest: Id<"users">,
  target: Id<"users">,
) {
  const guestSession = await asUserWithSession(t, guest);
  await guestSession.run(async (ctx) => startGuestMerge(ctx, target));
  await finishMerge(t);
}

async function finishMerge(t: ReturnType<typeof setupTest>) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

test("startGuestMerge ignores sessions that cannot be merged", async () => {
  const t = setupTest();
  const registered = await seedUser(t, { isAnonymous: false });
  const target = await seedUser(t);

  await expect(
    t.run(async (ctx) => startGuestMerge(ctx, target)),
  ).resolves.toBeNull();
  await expect(
    (await asUserWithSession(t, target)).run(async (ctx) =>
      startGuestMerge(ctx, target),
    ),
  ).resolves.toBeNull();
  await expect(
    (await asUserWithSession(t, registered)).run(async (ctx) =>
      startGuestMerge(ctx, target),
    ),
  ).resolves.toBeNull();

  const guest = await seedUser(t, { isAnonymous: true });
  const missingTarget = await seedUser(t);
  await t.run(async (ctx) => ctx.db.delete("users", missingTarget));
  await expect(
    (await asUserWithSession(t, guest)).run(async (ctx) =>
      startGuestMerge(ctx, missingTarget),
    ),
  ).resolves.toBeNull();
});

test("guest merge moves guest room and progress rows to registered user", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t, { email: "registered@test.dev" });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.join, { code });
  await asUser(t, target).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId: guest,
      lemma: "guestword",
      distance: 42,
      source: "guess",
      createdAt: 10,
    });
    await ctx.db.insert("userGameHistory", {
      userId: guest,
      contextoGameId: 1336,
      firstPlayedAt: 10,
      firstAttemptAt: 11,
      firstAttemptDistance: 42,
      firstAttemptGameId: gameId,
    });
    await ctx.db.insert("userGameHistory", {
      userId: target,
      contextoGameId: 1336,
      firstPlayedAt: 20,
    });
    await ctx.db.insert("userAchievements", {
      userId: guest,
      achievementId: "youll_get_there",
      unlockedAt: 10,
    });
    await ctx.db.insert("userAchievements", {
      userId: target,
      achievementId: "youll_get_there",
      unlockedAt: 20,
    });
  });

  await mergeGuest(t, guest, target);

  const result = await t.run(async (ctx) => {
    const members = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
      .collect();
    const guesses = await ctx.db
      .query("gameGuesses")
      .withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
      .collect();
    const history = await ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) =>
        q.eq("userId", target).eq("contextoGameId", 1336),
      )
      .unique();
    const achievements = await ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) => q.eq("userId", target))
      .collect();
    const guestRows = {
      memberships: (
        await ctx.db
          .query("roomMembers")
          .withIndex("by_user", (q) => q.eq("userId", guest))
          .collect()
      ).length,
      history: (
        await ctx.db
          .query("userGameHistory")
          .withIndex("by_user_game", (q) => q.eq("userId", guest))
          .collect()
      ).length,
      achievements: (
        await ctx.db
          .query("userAchievements")
          .withIndex("by_user_achievement", (q) => q.eq("userId", guest))
          .collect()
      ).length,
    };
    return { members, guesses, history, achievements, guestRows };
  });

  expect(result.members.filter((m) => m.userId === target)).toHaveLength(1);
  expect(result.members.some((m) => m.userId === guest)).toBe(false);
  expect(result.guesses.map((g) => g.userId)).toEqual([target]);
  expect(result.history).toMatchObject({
    userId: target,
    firstPlayedAt: 10,
    firstAttemptAt: 11,
    firstAttemptDistance: 42,
  });
  expect(result.achievements).toContainEqual(
    expect.objectContaining({
      userId: target,
      achievementId: "youll_get_there",
      unlockedAt: 10,
    }),
  );
  expect(result.guestRows).toEqual({
    memberships: 0,
    history: 0,
    achievements: 0,
  });
});

test("guest merge transfers guest-hosted rooms", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const { roomId } = await asUser(t, guest).mutation(api.rooms.create, {});

  await mergeGuest(t, guest, target);

  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  expect(room?.hostUserId).toBe(target);
});

test("guest merge deduplicates overlapping pending requests", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.join, { code });
  await asUser(t, target).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await asUser(t, guest).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  await asUser(t, target).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });

  await mergeGuest(t, guest, target);

  const requests = await asUser(t, host).query(api.requests.listPending, {
    gameId,
  });
  expect(requests).toHaveLength(1);
});

test("guest merge unlocks achievements crossed by combined progress", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t, {
    username: "target",
    displayUsername: "Target",
  });
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await t.run(async (ctx) => {
    for (const userId of [guest, target]) {
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("gameGuesses", {
          gameId,
          userId,
          lemma: `${userId}-${i}`,
          distance: 500,
          source: "guess",
          createdAt: i,
        });
      }
      await ctx.db.insert("userAchievementStats", {
        userId,
        redGuesses: 0,
        yellowGuesses: 60,
        greenGuesses: 0,
        uniqueSolves: 0,
      });
      await ctx.db.insert("userAchievementProgress", {
        userId,
        achievementId: "the_mellow_yellow",
        current: 60,
        target: 100,
        hidden: false,
        updatedAt: 1,
      });
    }
  });

  await mergeGuest(t, guest, target);

  const profile = await asUser(t, target).query(
    api.achievements.listForProfile,
    {
      username: "target",
    },
  );
  const achievement = profile?.achievements.find(
    (item) => item.achievementId === "the_mellow_yellow",
  );
  expect(achievement?.unlocked).toBe(true);
});

test("guest merge removes the guest identity once transfer finishes", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const accountId = await t.run(async (ctx) =>
    ctx.db.insert("authAccounts", {
      userId: guest,
      provider: "anonymous",
      providerAccountId: "guest-account",
    }),
  );
  await mergeGuest(t, guest, target);

  const result = await t.run(async (ctx) => ({
    guest: await ctx.db.get("users", guest),
    account: await ctx.db.get("authAccounts", accountId),
    jobs: await ctx.db.query("guestMerges").take(1),
  }));
  expect(result).toEqual({ guest: null, account: null, jobs: [] });
});

test("guest merge counts overlapping puzzle solves once", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t, {
    username: "solver",
    displayUsername: "Solver",
  });
  await t.run(async (ctx) => {
    for (const userId of [guest, target]) {
      for (let contextoGameId = 1; contextoGameId <= 5; contextoGameId++) {
        await ctx.db.insert("userGameHistory", {
          userId,
          contextoGameId,
          firstPlayedAt: contextoGameId,
          firstSolvedAt: contextoGameId,
        });
      }
      await ctx.db.insert("userAchievementStats", {
        userId,
        redGuesses: 0,
        yellowGuesses: 0,
        greenGuesses: 0,
        uniqueSolves: 5,
      });
      await ctx.db.insert("userAchievementProgress", {
        userId,
        achievementId: "word_explorer",
        current: 5,
        target: 10,
        hidden: false,
        updatedAt: 1,
      });
    }
  });
  await mergeGuest(t, guest, target);

  const profile = await asUser(t, target).query(
    api.achievements.listForProfile,
    {
      username: "solver",
    },
  );
  const achievement = profile?.achievements.find(
    (item) => item.achievementId === "word_explorer",
  );
  expect(achievement).toMatchObject({
    unlocked: false,
    progress: { current: 5, target: 10 },
  });
});

test("guest merge clamps inconsistent unique solve totals to zero", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  await t.run(async (ctx) => {
    for (const userId of [guest, target]) {
      await ctx.db.insert("userGameHistory", {
        userId,
        contextoGameId: 1,
        firstPlayedAt: 1,
        firstSolvedAt: 1,
      });
      await ctx.db.insert("userAchievementStats", {
        userId,
        redGuesses: 0,
        yellowGuesses: 0,
        greenGuesses: 0,
        uniqueSolves: 0,
      });
    }
  });
  await mergeGuest(t, guest, target);

  const stats = await t.run(async (ctx) =>
    ctx.db
      .query("userAchievementStats")
      .withIndex("by_user", (q) => q.eq("userId", target))
      .unique(),
  );
  expect(stats?.uniqueSolves).toBe(0);
});

test("guest merge preserves guest-only progress and combines game stats", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t, {
    username: "mergedplayer",
    displayUsername: "MergedPlayer",
  });
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const guestOnlyGame = await t.run(async (ctx) =>
    ctx.db.insert("games", {
      roomId,
      contextoGameId: 1,
      status: "won",
      startedAt: 1,
      endedAt: 2,
    }),
  );
  const sharedGame = await t.run(async (ctx) =>
    ctx.db.insert("games", {
      roomId,
      contextoGameId: 2,
      status: "won",
      startedAt: 3,
      endedAt: 4,
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("userGameHistory", {
      userId: guest,
      contextoGameId: 1,
      firstPlayedAt: 1,
    });
    await ctx.db.insert("userAchievements", {
      userId: guest,
      achievementId: "bullseye",
      unlockedAt: 1,
    });
    await ctx.db.insert("userAchievementProgress", {
      userId: guest,
      achievementId: "word_explorer",
      current: 2,
      target: 10,
      hidden: false,
      updatedAt: 1,
    });
    await ctx.db.insert("userAchievementStats", {
      userId: guest,
      redGuesses: 1,
      yellowGuesses: 2,
      greenGuesses: 3,
      uniqueSolves: 1,
    });
    await ctx.db.insert("gamePlayerStats", {
      gameId: guestOnlyGame,
      userId: guest,
      realGuessCount: 2,
      bestDistance: 10,
      lastDistance: 10,
      noBacktrackingSoFar: true,
      updatedAt: 1,
    });
    await ctx.db.insert("gamePlayerStats", {
      gameId: sharedGame,
      userId: guest,
      realGuessCount: 3,
      bestDistance: 20,
      lastDistance: 20,
      noBacktrackingSoFar: false,
      updatedAt: 2,
    });
    await ctx.db.insert("gamePlayerStats", {
      gameId: sharedGame,
      userId: target,
      realGuessCount: 4,
      bestDistance: 30,
      lastDistance: 30,
      noBacktrackingSoFar: true,
      updatedAt: 1,
    });
  });

  await mergeGuest(t, guest, target);

  const result = await t.run(async (ctx) => ({
    history: await ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) => q.eq("userId", target))
      .collect(),
    achievements: await ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) => q.eq("userId", target))
      .collect(),
    stats: await ctx.db
      .query("userAchievementStats")
      .withIndex("by_user", (q) => q.eq("userId", target))
      .unique(),
    playerStats: await ctx.db
      .query("gamePlayerStats")
      .withIndex("by_user", (q) => q.eq("userId", target))
      .collect(),
  }));

  expect(result.history).toHaveLength(1);
  expect(result.achievements).toContainEqual(
    expect.objectContaining({ achievementId: "bullseye" }),
  );
  expect(result.stats).toMatchObject({
    redGuesses: 1,
    yellowGuesses: 2,
    greenGuesses: 3,
    uniqueSolves: 1,
  });
  expect(result.playerStats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        gameId: guestOnlyGame,
        realGuessCount: 2,
      }),
      expect.objectContaining({
        gameId: sharedGame,
        realGuessCount: 7,
        bestDistance: 20,
        lastDistance: 20,
        noBacktrackingSoFar: false,
      }),
    ]),
  );
});

test("guest merge combines interleaved solve days into one streak", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t, {
    username: "streaker",
    displayUsername: "Streaker",
  });
  await t.run(async (ctx) => {
    for (const dayKey of ["2026-03-01", "2026-03-03"]) {
      await ctx.db.insert("userSolveDays", { userId: guest, dayKey });
    }
    for (const dayKey of ["2026-03-02", "2026-03-03"]) {
      await ctx.db.insert("userSolveDays", { userId: target, dayKey });
    }
  });

  await mergeGuest(t, guest, target);

  const profile = await asUser(t, target).query(
    api.achievements.listForProfile,
    { username: "streaker" },
  );
  const find = (id: string) =>
    profile?.achievements.find((item) => item.achievementId === id);
  expect(find("on_a_roll")?.unlocked).toBe(true);
  expect(find("habit_formed")?.progress).toEqual({ current: 3, target: 7 });
  const days = await t.run(async (ctx) =>
    ctx.db
      .query("userSolveDays")
      .withIndex("by_user_and_dayKey", (q) => q.eq("userId", target))
      .collect(),
  );
  expect(days.map((row) => row.dayKey)).toEqual([
    "2026-03-01",
    "2026-03-02",
    "2026-03-03",
  ]);
});

test("guest merge transfers more rows than fit in one batch", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const rowCount = GUEST_MERGE_BATCH_SIZE * 2 + 1;
  const sharedCount = GUEST_MERGE_BATCH_SIZE + 1;
  const gameIds = await t.run(async (ctx) => {
    const ids: Id<"games">[] = [];
    for (let i = 0; i < rowCount; i++) {
      ids.push(
        await ctx.db.insert("games", {
          roomId,
          contextoGameId: i,
          status: "won",
          startedAt: i,
          endedAt: i,
        }),
      );
    }
    return ids;
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < rowCount; i++) {
      await ctx.db.insert("gameGuesses", {
        gameId: gameIds[i],
        userId: guest,
        lemma: `word${i}`,
        distance: 500,
        source: "guess",
        createdAt: i,
      });
      await ctx.db.insert("userGameHistory", {
        userId: guest,
        contextoGameId: i,
        firstPlayedAt: i,
        firstSolvedAt: i,
      });
      await ctx.db.insert("gamePlayerStats", {
        gameId: gameIds[i],
        userId: guest,
        realGuessCount: 1,
        bestDistance: 500,
        lastDistance: 500,
        noBacktrackingSoFar: true,
        updatedAt: i,
      });
    }
    for (let i = 0; i < sharedCount; i++) {
      await ctx.db.insert("userGameHistory", {
        userId: target,
        contextoGameId: i,
        firstPlayedAt: i,
        firstSolvedAt: i,
      });
      await ctx.db.insert("gamePlayerStats", {
        gameId: gameIds[i],
        userId: target,
        realGuessCount: 2,
        bestDistance: 500,
        lastDistance: 500,
        noBacktrackingSoFar: true,
        updatedAt: i,
      });
    }
    await ctx.db.insert("userAchievementStats", {
      userId: guest,
      redGuesses: 0,
      yellowGuesses: rowCount,
      greenGuesses: 0,
      uniqueSolves: rowCount,
    });
    await ctx.db.insert("userAchievementStats", {
      userId: target,
      redGuesses: 0,
      yellowGuesses: 0,
      greenGuesses: 0,
      uniqueSolves: sharedCount,
    });
  });

  await mergeGuest(t, guest, target);

  const result = await t.run(async (ctx) => {
    const byUser = async (userId: Id<"users">) => ({
      guesses: (
        await ctx.db
          .query("gameGuesses")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      ).length,
      history: (
        await ctx.db
          .query("userGameHistory")
          .withIndex("by_user_game", (q) => q.eq("userId", userId))
          .collect()
      ).length,
      playerStats: await ctx.db
        .query("gamePlayerStats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    });
    return {
      guest: await byUser(guest),
      target: await byUser(target),
      stats: await ctx.db
        .query("userAchievementStats")
        .withIndex("by_user", (q) => q.eq("userId", target))
        .unique(),
      guestUser: await ctx.db.get("users", guest),
    };
  });

  expect(result.guest).toEqual({ guesses: 0, history: 0, playerStats: [] });
  expect(result.target.guesses).toBe(rowCount);
  expect(result.target.history).toBe(rowCount);
  expect(result.target.playerStats).toHaveLength(rowCount);
  expect(
    result.target.playerStats.reduce((sum, row) => sum + row.realGuessCount, 0),
  ).toBe(rowCount + sharedCount * 2);
  expect(result.stats).toMatchObject({
    yellowGuesses: rowCount,
    uniqueSolves: rowCount,
  });
  expect(result.guestUser).toBeNull();
});

test("repeated sign-in for a merging guest starts only one merge", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const otherTarget = await seedUser(t);
  await t.run(async (ctx) => {
    for (let contextoGameId = 1; contextoGameId <= 3; contextoGameId++) {
      await ctx.db.insert("userGameHistory", {
        userId: guest,
        contextoGameId,
        firstPlayedAt: contextoGameId,
        firstSolvedAt: contextoGameId,
      });
    }
    await ctx.db.insert("userAchievementStats", {
      userId: guest,
      redGuesses: 0,
      yellowGuesses: 0,
      greenGuesses: 0,
      uniqueSolves: 3,
    });
  });
  const guestSession = await asUserWithSession(t, guest);

  const first = await guestSession.run(async (ctx) =>
    startGuestMerge(ctx, target),
  );
  const retry = await guestSession.run(async (ctx) =>
    startGuestMerge(ctx, target),
  );
  const elsewhere = await guestSession.run(async (ctx) =>
    startGuestMerge(ctx, otherTarget),
  );
  const jobs = await t.run(async (ctx) =>
    ctx.db.query("guestMerges").collect(),
  );
  await finishMerge(t);

  expect(first).not.toBeNull();
  expect(retry).toBeNull();
  expect(elsewhere).toBeNull();
  expect(jobs).toEqual([
    expect.objectContaining({ guestUserId: guest, targetUserId: target }),
  ]);
  const result = await t.run(async (ctx) => ({
    history: (
      await ctx.db
        .query("userGameHistory")
        .withIndex("by_user_game", (q) => q.eq("userId", target))
        .collect()
    ).length,
    otherHistory: (
      await ctx.db
        .query("userGameHistory")
        .withIndex("by_user_game", (q) => q.eq("userId", otherTarget))
        .collect()
    ).length,
    stats: await ctx.db
      .query("userAchievementStats")
      .withIndex("by_user", (q) => q.eq("userId", target))
      .unique(),
  }));
  expect(result).toMatchObject({
    history: 3,
    otherHistory: 0,
    stats: { uniqueSolves: 3 },
  });
});

test("guest merge finds streaks that span solve-day batches", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t, {
    username: "longstreak",
    displayUsername: "LongStreak",
  });
  // Solve days two apart, except one 3-day run straddling the first batch
  // boundary.
  const runStart = GUEST_MERGE_BATCH_SIZE - 2;
  await t.run(async (ctx) => {
    let day = Date.parse("2020-01-01T00:00:00Z");
    for (let i = 0; i < GUEST_MERGE_BATCH_SIZE * 2; i++) {
      const inRun = i > runStart && i <= runStart + 2;
      day += (inRun ? 1 : 2) * 24 * 60 * 60 * 1000;
      await ctx.db.insert("userSolveDays", {
        userId: target,
        dayKey: new Date(day).toISOString().slice(0, 10),
      });
    }
  });

  await mergeGuest(t, guest, target);

  const profile = await asUser(t, target).query(
    api.achievements.listForProfile,
    { username: "longstreak" },
  );
  const find = (id: string) =>
    profile?.achievements.find((item) => item.achievementId === id);
  expect(find("on_a_roll")?.unlocked).toBe(true);
  expect(find("habit_formed")?.progress).toEqual({ current: 3, target: 7 });
});

test("guest expiry cleanup leaves a merging guest's rows for the merge", async () => {
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  const target = await seedUser(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("userGameHistory", {
      userId: guest,
      contextoGameId: 1,
      firstPlayedAt: 1,
    });
  });
  const guestSession = await asUserWithSession(t, guest);
  await guestSession.run(async (ctx) => startGuestMerge(ctx, target));

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  await finishMerge(t);

  const result = await t.run(async (ctx) => ({
    history: (
      await ctx.db
        .query("userGameHistory")
        .withIndex("by_user_game", (q) => q.eq("userId", target))
        .collect()
    ).length,
    guest: await ctx.db.get("users", guest),
  }));
  expect(result).toEqual({ history: 1, guest: null });
});

test("guest cannot start merging after expiry cleanup has begun", async () => {
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  const target = await seedUser(t);
  const guestSession = await asUserWithSession(t, guest);
  await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("authAccounts", {
      userId: guest,
      provider: "password",
      providerAccountId: "guest",
    });
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("authVerificationCodes", {
        accountId,
        provider: "password",
        code: `test-${i}`,
        expirationTime: Date.now() + 60_000,
      });
    }
    await ctx.db.insert("userGameHistory", {
      userId: guest,
      contextoGameId: 1,
      firstPlayedAt: 1,
    });
  });

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  await expect(
    guestSession.run(async (ctx) => startGuestMerge(ctx, target)),
  ).resolves.toBeNull();
  await finishMerge(t);
  const result = await t.run(async (ctx) => ({
    guest: await ctx.db.get("users", guest),
    targetHistory: await ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) => q.eq("userId", target))
      .collect(),
  }));
  expect(result.guest).toMatchObject({
    name: "Former Guest",
    isAnonymous: false,
  });
  expect(result.targetHistory).toEqual([]);
});

test("guest merge picks up rows a stale guest tab wrote after their phase", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  const guestSession = await asUserWithSession(t, guest);
  const mergeId = await guestSession.run(async (ctx) =>
    startGuestMerge(ctx, target),
  );
  if (mergeId === null) throw new Error("merge did not start");

  // The guesses phase already ran when the stale tab's guess lands.
  await t.run(async (ctx) => {
    await ctx.db.patch("guestMerges", mergeId, { phase: "finalize" });
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId: guest,
      lemma: "late",
      distance: 42,
      source: "guess",
      createdAt: 1,
    });
  });
  await finishMerge(t);

  const result = await t.run(async (ctx) => ({
    guesses: (
      await ctx.db
        .query("gameGuesses")
        .withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
        .collect()
    ).map((row) => row.userId),
    guest: await ctx.db.get("users", guest),
  }));
  expect(result).toEqual({ guesses: [target], guest: null });
});

test("guest merge re-sweep counts a stale tab's repeat solve once", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const guest = await seedUser(t, { isAnonymous: true });
    const target = await seedUser(t);
    await t.run(async (ctx) => {
      for (const userId of [guest, target]) {
        await ctx.db.insert("userGameHistory", {
          userId,
          contextoGameId: 1,
          firstPlayedAt: 1,
          firstSolvedAt: 1,
        });
        await ctx.db.insert("userAchievementStats", {
          userId,
          redGuesses: 0,
          yellowGuesses: 0,
          greenGuesses: 0,
          uniqueSolves: 1,
        });
      }
    });
    const mergeId = await (
      await asUserWithSession(t, guest)
    ).run(async (ctx) => startGuestMerge(ctx, target));
    if (mergeId === null) throw new Error("merge did not start");
    const phase = () =>
      t.run(async (ctx) => (await ctx.db.get("guestMerges", mergeId))?.phase);
    while ((await phase()) !== "finalize") {
      vi.runAllTimers();
      await t.finishInProgressScheduledFunctions();
    }

    // The history phase already moved puzzle 1, so a stale tab solving it
    // again credits the guest with a new unique solve and a new history row.
    await t.run(async (ctx) => {
      await ctx.db.insert("userGameHistory", {
        userId: guest,
        contextoGameId: 1,
        firstPlayedAt: 2,
        firstSolvedAt: 2,
      });
      const stats = await ctx.db
        .query("userAchievementStats")
        .withIndex("by_user", (q) => q.eq("userId", guest))
        .unique();
      if (stats === null) throw new Error("missing guest stats");
      await ctx.db.patch("userAchievementStats", stats._id, {
        uniqueSolves: stats.uniqueSolves + 1,
      });
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const stats = await t.run(async (ctx) =>
      ctx.db
        .query("userAchievementStats")
        .withIndex("by_user", (q) => q.eq("userId", target))
        .unique(),
    );
    expect(stats?.uniqueSolves).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
