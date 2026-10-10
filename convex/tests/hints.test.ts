import { afterEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { MAX_WALK_ITERATIONS } from "../lib/hint";
import { rateLimits } from "../lib/rateLimits";
import {
  asUser,
  fakeWordOracle,
  seedUser,
  setupTest,
} from "../testHelpers.test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  return { host, other, roomId, gameId };
}

test("hostHint shortcut works with no pending row", async () => {
  const t = setupTest();
  fakeWordOracle({ tips: { 1336: { 299: "pomelo" } } });
  const { host, gameId } = await startedGame(t);
  const result = await asUser(t, host).action(api.hints.hostHint, { gameId });
  expect(result.lemma).toBe("pomelo");
});

test("hint target reflects best score", async () => {
  const t = setupTest();
  fakeWordOracle({
    guesses: { 1336: { onion: 100 } },
    tips: { 1336: { 50: "garlic" } },
  });
  const { host, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, {
    gameId,
    word: "onion",
  });
  const result = await asUser(t, host).action(api.hints.hostHint, { gameId });
  expect(result.distance).toBe(50);
  expect(result.lemma).toBe("garlic");
});

test("hint walks past already-guessed when best=1", async () => {
  const t = setupTest();
  fakeWordOracle({
    guesses: { 1336: { close: 1, second: 2 } },
    tips: { 1336: { 2: "second", 3: "third" } },
  });
  const { host, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "close" });
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "second" });
  const result = await asUser(t, host).action(api.hints.hostHint, { gameId });
  expect(result.lemma).toBe("third");
  expect(result.distance).toBe(3);
});

test("approve attributes hint to requester and marks request approved", async () => {
  const t = setupTest();
  fakeWordOracle({ tips: { 1336: { 299: "pomelo" } } });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  const result = await asUser(t, host).action(api.requests.approve, {
    requestId: req!._id,
  });
  expect(result).toEqual({ lemma: "pomelo", distance: 299 });
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("gameGuesses")
      .withIndex("by_game_lemma", (q) =>
        q.eq("gameId", gameId).eq("lemma", "pomelo"),
      )
      .collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].source).toBe("hint");
  expect(rows[0].userId).toBe(other);
  const reqRow = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", req!._id),
  );
  expect(reqRow?.status).toBe("approved");
});

test("a hint is rejected when its tip is guessed while Contexto is fetching it", async () => {
  const t = setupTest();
  const oracle = fakeWordOracle({ guesses: { 1336: { pomelo: 299 } } });
  const { host, other, gameId } = await startedGame(t);
  oracle.tip.mockImplementationOnce(async () => {
    await asUser(t, other).action(api.guesses.submit, {
      gameId,
      word: "pomelo",
    });
    return { lemma: "pomelo", distance: 299 };
  });

  await expect(
    asUser(t, host).action(api.hints.hostHint, { gameId }),
  ).rejects.toMatchObject({ data: { code: "hintDuplicate" } });
  expect(oracle.tip).toHaveBeenCalledTimes(1);
});

test("a walking hint gives up once every nearby tip is already guessed", async () => {
  const t = setupTest();
  // Every tip the walk gets back was guessed at another rank, as if guessed
  // mid-walk, so ranks 2 and up stay open but every tip is taken.
  const tips: Record<number, string> = {};
  for (let distance = 2; distance <= MAX_WALK_ITERATIONS + 1; distance++) {
    tips[distance] = `near${distance}`;
  }
  const oracle = fakeWordOracle({ tips: { 1336: tips } });
  const { host, gameId } = await startedGame(t);
  await t.run(async (ctx) => {
    for (const [distance, lemma] of [
      [1, "close"],
      ...Object.entries(tips).map(([d, l]) => [Number(d) + 1000, l]),
    ]) {
      await ctx.db.insert("gameGuesses", {
        gameId,
        userId: host,
        lemma: String(lemma),
        distance: Number(distance),
        source: "guess",
        createdAt: 1,
      });
    }
  });

  await expect(
    asUser(t, host).action(api.hints.hostHint, { gameId }),
  ).rejects.toMatchObject({ data: { code: "hintExhausted" } });
  expect(oracle.tip).toHaveBeenCalledTimes(MAX_WALK_ITERATIONS);
});

test("a walking hint starts at the first unguessed rank", async () => {
  const t = setupTest();
  // Ranks 1 to 11 are guessed, so the nearest hint is rank 12, past what a
  // walk from rank 2 could reach.
  const tips: Record<number, string> = { 12: "twelve" };
  const oracle = fakeWordOracle({ tips: { 1336: tips } });
  const { host, gameId } = await startedGame(t);
  await t.run(async (ctx) => {
    for (let distance = 1; distance <= 11; distance++) {
      await ctx.db.insert("gameGuesses", {
        gameId,
        userId: host,
        lemma: `near${distance}`,
        distance,
        source: "guess",
        createdAt: 1,
      });
    }
  });

  await expect(
    asUser(t, host).action(api.hints.hostHint, { gameId }),
  ).resolves.toEqual({ lemma: "twelve", distance: 12 });
  expect(oracle.tip).toHaveBeenCalledOnce();
});

test("hostHint: spends a rate limit token per tip it asks for", async () => {
  const t = setupTest();
  // Tips for ranks 2 to 10 were guessed at other ranks, as if guessed
  // mid-walk, so each hint walks the full MAX_WALK_ITERATIONS tips.
  const taken = Array.from(
    { length: MAX_WALK_ITERATIONS - 1 },
    (_, i) => i + 2,
  );
  const oracle = fakeWordOracle({
    guesses: {
      1336: {
        close: 1,
        ...Object.fromEntries(
          taken.map((rank) => [`taken${rank}`, rank + 1000]),
        ),
      },
    },
    tips: {
      1336: {
        ...Object.fromEntries(taken.map((rank) => [rank, `taken${rank}`])),
        [MAX_WALK_ITERATIONS + 1]: "open",
      },
    },
  });
  const { host, gameId } = await startedGame(t);
  for (const rank of [1, ...taken]) {
    await asUser(t, host).action(api.guesses.submit, {
      gameId,
      word: rank === 1 ? "close" : `taken${rank}`,
    });
  }
  // One full walk fits in the bucket, but two don't.
  await asUser(t, host).action(api.hints.hostHint, { gameId });
  await expect(
    asUser(t, host).action(api.hints.hostHint, { gameId }),
  ).rejects.toMatchObject({ data: { code: "rateLimited" } });
  expect(oracle.tip).toHaveBeenCalledTimes(rateLimits.hint.capacity);
});
