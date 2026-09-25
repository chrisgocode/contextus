import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import { asUser, seedUser, setupTest } from "../testHelpers.test";

// With E2E_TEST=1 the word oracle is a deterministic fake, so Playwright runs
// never depend on api.contexto.me. "wordN" scores N, and "word0" is the answer.

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("E2E_TEST", "1");
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function startedGame(t: ReturnType<typeof setupTest>) {
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  return { host, other, gameId };
}

async function approveRequest(
  t: ReturnType<typeof setupTest>,
  game: Awaited<ReturnType<typeof startedGame>>,
  type: "hint" | "giveup",
) {
  await asUser(t, game.other).mutation(api.requests.create, {
    gameId: game.gameId,
    type,
  });
  const request = await t.run(async (ctx) =>
    ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) =>
        q.eq("gameId", game.gameId).eq("status", "pending"),
      )
      .unique(),
  );
  await asUser(t, game.host).action(api.requests.approve, {
    requestId: request!._id,
  });
}

async function hintGuesses(
  t: ReturnType<typeof setupTest>,
  gameId: Id<"games">,
) {
  const guesses = await t.run(async (ctx) =>
    ctx.db
      .query("gameGuesses")
      .withIndex("by_game_lemma", (q) => q.eq("gameId", gameId))
      .collect(),
  );
  return guesses
    .filter((g) => g.source === "hint")
    .map(({ lemma, distance }) => ({ lemma, distance }));
}

test("scores wordN at distance N", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "Word42" }),
  ).resolves.toMatchObject({ lemma: "word42", distance: 42, won: false });
});

test("scores other words at a stable distance beyond the hint floor", async () => {
  const t = setupTest();
  const first = await startedGame(t);
  const second = await startedGame(t);
  const a = await asUser(t, first.host).action(api.guesses.submit, {
    gameId: first.gameId,
    word: "house",
  });
  const b = await asUser(t, second.host).action(api.guesses.submit, {
    gameId: second.gameId,
    word: "house",
  });
  expect(a).toMatchObject({ lemma: "house", won: false });
  expect(b).toMatchObject({ lemma: "house", distance: a.distance });
  expect(a.distance).toBeGreaterThanOrEqual(1000);
});

test("rejects words that are not plain letters", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "zz9" }),
  ).resolves.toEqual({
    message: "I'm sorry, I don't know this word",
    won: false,
    unlockedAchievementIds: [],
  });
});

test("rejects wordN with leading zeroes", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "word00" }),
  ).resolves.toMatchObject({
    message: "I'm sorry, I don't know this word",
    won: false,
  });
});

test("guessing word0 wins the game", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "word0" }),
  ).resolves.toMatchObject({ lemma: "word0", distance: 0, won: true });
});

test("hints return the wordN lemma for the requested distance", async () => {
  const t = setupTest();
  const game = await startedGame(t);
  await asUser(t, game.host).action(api.guesses.submit, {
    gameId: game.gameId,
    word: "house",
  });
  await approveRequest(t, game, "hint");
  expect(await hintGuesses(t, game.gameId)).toEqual([
    { lemma: "word299", distance: 299 },
  ]);
});

test("ignores Contexto scores already in the distance cache", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("wordDistances", {
      contextoGameId: 1336,
      lemma: "word0",
      distance: 812,
    });
  });
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "word0" }),
  ).resolves.toMatchObject({ lemma: "word0", distance: 0, won: true });
});

test("leaves the distance cache untouched", async () => {
  const t = setupTest();
  const game = await startedGame(t);
  await asUser(t, game.host).action(api.guesses.submit, {
    gameId: game.gameId,
    word: "house",
  });
  await approveRequest(t, game, "hint");
  const cached = await t.run(async (ctx) =>
    ctx.db.query("wordDistances").collect(),
  );
  expect(cached).toEqual([]);
});

test("giving up reveals word0", async () => {
  const t = setupTest();
  const game = await startedGame(t);
  await approveRequest(t, game, "giveup");
  const ended = await t.run(async (ctx) => ctx.db.get("games", game.gameId));
  expect(ended).toMatchObject({ status: "given_up", answerLemma: "word0" });
});
