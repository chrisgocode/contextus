import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  asUser,
  fakeWordOracle,
  finishScheduledFunctions,
  seedUser,
  setupTest,
} from "../testHelpers.test";
import { posthog } from "../posthog";

// Observe turns through the app API. Direct inserts only arrange large fixtures;
// the cron entry point is used to exercise scheduled cache maintenance.
afterEach(() => vi.useRealTimers());

async function game() {
  const t = setupTest();
  const host = await seedUser(t);
  const member = await seedUser(t);
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, member).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  return { t, host, member, roomId, gameId, code };
}

test("a departing member cannot commit a prepared Guess", async () => {
  const { t, host, member, roomId, gameId } = await game();
  const oracle = fakeWordOracle({});
  oracle.distance.mockImplementationOnce(async () => {
    await asUser(t, member).mutation(api.rooms.leave, { roomId });
    return { ok: true, lemma: "apple", distance: 5 };
  });
  await expect(
    asUser(t, member).action(api.guesses.submit, { gameId, word: "apple" }),
  ).rejects.toMatchObject({ data: { code: "notMember" } });
  expect(
    await asUser(t, host).query(api.guesses.listForGame, { gameId }),
  ).toEqual({ sorted: [], latest: null });
});

test("Host succession invalidates an in-flight Hint", async () => {
  const { t, host, member, roomId, gameId, code } = await game();
  const oracle = fakeWordOracle({});
  oracle.tip.mockImplementationOnce(async () => {
    await asUser(t, host).mutation(api.rooms.leave, { roomId });
    return { lemma: "apple", distance: 299 };
  });
  await expect(
    asUser(t, host).action(api.hints.hostHint, { gameId }),
  ).rejects.toMatchObject({ data: { code: "hostOnly" } });
  expect(
    await asUser(t, member).query(api.guesses.listForGame, { gameId }),
  ).toEqual({ sorted: [], latest: null });
  expect(
    await asUser(t, member).query(api.rooms.getByCode, { code }),
  ).toMatchObject({ isViewerHost: true, room: { hostUserId: member } });
});

test("transport failure can recover without an unknown-word cache entry", async () => {
  const { t, host, gameId } = await game();
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ lemma: "apple", distance: 5 }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "apple" }),
  ).rejects.toMatchObject({ data: { code: "contextoUnavailable" } });
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "apple" }),
  ).resolves.toMatchObject({ lemma: "apple", distance: 5, won: false });
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "apple" }),
  ).resolves.toMatchObject({ alreadyGuessed: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("pruning continues across three batches and retains recent unknown words", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const t = setupTest();
  await t.run(async (ctx) => {
    for (let i = 0; i < 1001; i++)
      await ctx.db.insert("unknownWords", {
        contextoGameId: 1336,
        word: `old${i}`,
        error: "old cached error",
      });
  });
  vi.setSystemTime(new Date("2026-01-07T00:00:00Z"));
  await t.run((ctx) =>
    ctx.db.insert("unknownWords", {
      contextoGameId: 1336,
      word: "recent",
      error: "recent cached error",
    }),
  );
  vi.setSystemTime(new Date("2026-01-08T00:00:01Z"));
  const host = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  const oracle = fakeWordOracle({
    guesses: { 1336: { old0: 10, old500: 20, old1000: 30, recent: 40 } },
  });
  await t.mutation(internal.wordOracle.pruneUnknownWords, {});
  await finishScheduledFunctions(t);
  for (const word of ["old0", "old500", "old1000"]) {
    await expect(
      asUser(t, host).action(api.guesses.submit, { gameId, word }),
    ).resolves.toMatchObject({ lemma: word, won: false });
  }
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "recent" }),
  ).resolves.toMatchObject({ message: "recent cached error" });
  expect(oracle.distance).toHaveBeenCalledTimes(3);
});

test("Game outcome continuation counts mixed pages exactly once", async () => {
  vi.useFakeTimers();
  const { t, host, gameId, roomId } = await game();
  await t.run(async (ctx) => {
    for (let i = 0; i < 2003; i++)
      await ctx.db.insert("gameGuesses", {
        gameId,
        userId: host,
        lemma: `word${i}`,
        distance: i + 1,
        source: i % 2 === 0 ? "guess" : "hint",
        createdAt: Date.now(),
      });
  });
  fakeWordOracle({ answers: { 1336: "answer" } });
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  await asUser(t, host).action(api.giveup.hostGiveup, { gameId });
  await finishScheduledFunctions(t);
  const outcomes = capture.mock.calls
    .map(([, event]) => event)
    .filter((event) => event.event === "game_given_up");
  expect(outcomes).toMatchObject([
    { properties: { guess_count: 1002, hint_count: 1001, member_count: 2 } },
  ]);
  expect(
    await asUser(t, host).query(api.games.listFinished, { roomId }),
  ).toMatchObject([{ status: "given_up", answerLemma: "answer" }]);
});

test("cached unknown words bypass production network without recording a Guess", async () => {
  const { t, host, member, gameId } = await game();
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: "unknown word" }), { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  for (const user of [host, member]) {
    await expect(
      asUser(t, user).action(api.guesses.submit, { gameId, word: "zzz" }),
    ).resolves.toEqual({
      message: "unknown word",
      won: false,
      unlockedAchievementIds: [],
    });
  }
  expect(fetch).toHaveBeenCalledOnce();
  expect(
    await asUser(t, host).query(api.guesses.listForGame, { gameId }),
  ).toEqual({ sorted: [], latest: null });
});
