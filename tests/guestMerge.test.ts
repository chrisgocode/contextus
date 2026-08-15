import { expect, test } from "vitest";
import { mergeCurrentGuestIntoUser } from "../convex/lib/guestMerge";
import { asUser, asUserWithSession, seedUser, setupTest } from "./helpers";
import { api, internal } from "../convex/_generated/api";

test("mergeCurrentGuestIntoUser moves guest room and progress rows to registered user", async () => {
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

  const guestSession = await asUserWithSession(t, guest);
  await guestSession.run(async (ctx) => {
    await mergeCurrentGuestIntoUser(ctx, target);
  });

  const result = await t.run(async (ctx) => {
    const members = await ctx.db
      .query("roomMembers")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
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
      .withIndex("by_user", (q) => q.eq("userId", target))
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
          .withIndex("by_user", (q) => q.eq("userId", guest))
          .collect()
      ).length,
      achievements: (
        await ctx.db
          .query("userAchievements")
          .withIndex("by_user", (q) => q.eq("userId", guest))
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

test("mergeCurrentGuestIntoUser transfers guest-hosted rooms", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const { roomId } = await asUser(t, guest).mutation(api.rooms.create, {});
  const guestSession = await asUserWithSession(t, guest);

  await guestSession.run(async (ctx) => {
    await mergeCurrentGuestIntoUser(ctx, target);
  });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room?.hostUserId).toBe(target);
});

test("mergeCurrentGuestIntoUser deduplicates overlapping pending requests", async () => {
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
  const guestSession = await asUserWithSession(t, guest);

  await guestSession.run(async (ctx) => {
    await mergeCurrentGuestIntoUser(ctx, target);
  });

  const requests = await asUser(t, host).query(api.requests.listPending, {
    gameId,
  });
  expect(requests).toHaveLength(1);
});

test("mergeCurrentGuestIntoUser unlocks achievements crossed by combined progress", async () => {
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
  const guestSession = await asUserWithSession(t, guest);

  await guestSession.run(async (ctx) => {
    await mergeCurrentGuestIntoUser(ctx, target);
  });

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

test("merged guest identities can be removed after auth switches sessions", async () => {
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
  const guestSession = await asUserWithSession(t, guest);
  await guestSession.run(async (ctx) => {
    await mergeCurrentGuestIntoUser(ctx, target);
  });

  await t.mutation(internal.cleanup.removeMergedGuest, { guestUserId: guest });

  const result = await t.run(async (ctx) => ({
    guest: await ctx.db.get(guest),
    account: await ctx.db.get(accountId),
  }));
  expect(result).toEqual({ guest: null, account: null });
});

test("mergeCurrentGuestIntoUser counts overlapping puzzle solves once", async () => {
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
  const guestSession = await asUserWithSession(t, guest);
  await guestSession.run(async (ctx) => {
    await mergeCurrentGuestIntoUser(ctx, target);
  });

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
