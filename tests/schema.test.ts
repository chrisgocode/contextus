import { expect, test } from "vitest";
import { setupTest, seedUser } from "./helpers";

test("schema accepts all table shapes", async () => {
  const t = setupTest();
  const userId = await seedUser(t);

  await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      code: "ABCDEF",
      hostUserId: userId,
      status: "active",
    });
    await ctx.db.insert("roomActivity", {
      roomId,
      lastActivityAt: Date.now(),
    });
    await ctx.db.insert("roomMembers", {
      roomId,
      userId,
      joinedAt: Date.now(),
    });
    const gameId = await ctx.db.insert("games", {
      roomId,
      contextoGameId: 1336,
      status: "in_progress",
      startedAt: Date.now(),
    });
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId,
      lemma: "hello",
      distance: 42591,
      source: "guess",
      createdAt: Date.now(),
    });
    await ctx.db.insert("wordDistances", {
      contextoGameId: 1336,
      lemma: "hello",
      distance: 42591,
    });
    await ctx.db.insert("pendingRequests", {
      roomId,
      gameId,
      requesterUserId: userId,
      type: "hint",
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.insert("userGameHistory", {
      userId,
      contextoGameId: 1336,
      firstPlayedAt: Date.now(),
      firstAttemptAt: Date.now(),
      firstAttemptDistance: 42591,
      firstAttemptGameId: gameId,
      firstSolvedAt: Date.now(),
      firstSolvedGameId: gameId,
    });
    await ctx.db.insert("userAchievements", {
      userId,
      achievementId: "youll_get_there",
      unlockedAt: Date.now(),
    });
    await ctx.db.insert("userAchievementProgress", {
      userId,
      achievementId: "it_happens",
      current: 1,
      target: 250,
      hidden: false,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("userAchievementStats", {
      userId,
      redGuesses: 1,
      yellowGuesses: 0,
      greenGuesses: 0,
      uniqueSolves: 0,
    });
    await ctx.db.insert("gamePlayerStats", {
      gameId,
      userId,
      realGuessCount: 1,
      bestDistance: 42591,
      lastDistance: 42591,
      noBacktrackingSoFar: true,
      updatedAt: Date.now(),
    });
  });

  const counts = await t.run(async (ctx) => ({
    rooms: (await ctx.db.query("rooms").collect()).length,
    members: (await ctx.db.query("roomMembers").collect()).length,
    games: (await ctx.db.query("games").collect()).length,
    guesses: (await ctx.db.query("gameGuesses").collect()).length,
    wordDistances: (await ctx.db.query("wordDistances").collect()).length,
    pending: (await ctx.db.query("pendingRequests").collect()).length,
    history: (await ctx.db.query("userGameHistory").collect()).length,
    achievements: (await ctx.db.query("userAchievements").collect()).length,
    progress: (await ctx.db.query("userAchievementProgress").collect()).length,
    stats: (await ctx.db.query("userAchievementStats").collect()).length,
    gamePlayerStats: (await ctx.db.query("gamePlayerStats").collect()).length,
  }));

  expect(counts).toEqual({
    rooms: 1,
    members: 1,
    games: 1,
    guesses: 1,
    wordDistances: 1,
    pending: 1,
    history: 1,
    achievements: 1,
    progress: 1,
    stats: 1,
    gamePlayerStats: 1,
  });
});
