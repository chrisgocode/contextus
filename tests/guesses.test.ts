import { afterEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, mockContextoFetch, seedUser, setupTest } from "./helpers";

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

test("submit: rejects unknown word", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: {} } });
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "zzz" }),
  ).rejects.toThrow();
});

test("submit: updates roomActivity", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { hello: 42591 } } });
  const { host, roomId, gameId } = await startedGame(t);
  const before = await t.run(async (ctx) =>
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique(),
  );
  await new Promise((r) => setTimeout(r, 5));
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "hello" });
  const after = await t.run(async (ctx) =>
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique(),
  );
  expect(after).not.toBeNull();
  expect(after!.lastActivityAt).toBeGreaterThan(before!.lastActivityAt);
});

test("submit: success returns distance and writes guess + cache", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { hello: 42591 } } });
  const { host, gameId } = await startedGame(t);
  const res = await asUser(t, host).action(api.guesses.submit, {
    gameId,
    word: "hello",
  });
  expect(res).toEqual({
    lemma: "hello",
    distance: 42591,
    won: false,
    unlockedAchievementIds: ["youll_get_there"],
  });
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("gameGuesses")
      .withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
      .collect(),
  );
  expect(rows.map((r) => r.lemma)).toEqual(["hello"]);
  const cache = await t.run(async (ctx) =>
    ctx.db
      .query("wordDistances")
      .withIndex("by_game_lemma", (q) =>
        q.eq("contextoGameId", 1336).eq("lemma", "hello"),
      )
      .unique(),
  );
  expect(cache?.distance).toBe(42591);
});

test("submit: anonymous room member can guess", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { guestword: 1234 } } });
  const host = await seedUser(t, { name: "Host" });
  const guest = await seedUser(t, {
    name: "Guest",
    isAnonymous: true,
  });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });

  const res = await asUser(t, guest).action(api.guesses.submit, {
    gameId,
    word: "guestword",
  });

  expect(res).toMatchObject({ lemma: "guestword", distance: 1234 });
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("gameGuesses")
      .withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
      .collect(),
  );
  expect(rows.map((r) => r.userId)).toEqual([guest]);
});

test("guest account prompt is due after every third completed game", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const { roomId } = await asUser(t, guest).mutation(api.rooms.create, {});
  mockContextoFetch({
    guesses: Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [i + 1, { winner: 0 }]),
    ),
  });

  for (let contextoGameId = 1; contextoGameId <= 3; contextoGameId++) {
    const { gameId } = await asUser(t, guest).mutation(api.games.start, {
      roomId,
      contextoGameId,
    });
    await asUser(t, guest).action(api.guesses.submit, {
      gameId,
      word: "winner",
    });
  }

  await expect(
    asUser(t, guest).query(api.users.getGuestAccountPrompt, {}),
  ).resolves.toMatchObject({ completedGames: 3, messageIndex: 0 });
  await asUser(t, guest).mutation(api.users.dismissGuestAccountPrompt, {});
  await expect(
    asUser(t, guest).query(api.users.getGuestAccountPrompt, {}),
  ).resolves.toBeNull();

  for (let contextoGameId = 4; contextoGameId <= 6; contextoGameId++) {
    const { gameId } = await asUser(t, guest).mutation(api.games.start, {
      roomId,
      contextoGameId,
    });
    await asUser(t, guest).action(api.guesses.submit, {
      gameId,
      word: "winner",
    });
  }
  await expect(
    asUser(t, guest).query(api.users.getGuestAccountPrompt, {}),
  ).resolves.toMatchObject({ completedGames: 6, messageIndex: 1 });
});

test("submit: duplicate lemma in same game returns already guessed result", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { hello: 42591 } } });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "hello" });
  const res = await asUser(t, other).action(api.guesses.submit, {
    gameId,
    word: "hello",
  });
  expect(res).toEqual({
    lemma: "hello",
    distance: 42591,
    won: false,
    alreadyGuessed: true,
    message: "The word was already guessed.",
    unlockedAchievementIds: [],
  });
});

test("submit: second player hits cache, no second fetch call", async () => {
  const t = setupTest();
  const fetchMock = mockContextoFetch({ guesses: { 1336: { hello: 42591 } } });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "hello" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  // dedup returns without fetching because the distance is cached.
  const res = await asUser(t, other).action(api.guesses.submit, {
    gameId,
    word: "hello",
  });
  expect(res.alreadyGuessed).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("submit: distance 0 ends game with winner", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { persimmon: 0 } } });
  const { host, gameId } = await startedGame(t);
  const res = await asUser(t, host).action(api.guesses.submit, {
    gameId,
    word: "persimmon",
  });
  expect(res.won).toBe(true);
  const game = await t.run(async (ctx) => ctx.db.get(gameId));
  expect(game?.status).toBe("won");
  expect(game?.winnerUserId).toBe(host);
  expect(game?.answerLemma).toBe("persimmon");
  expect(game?.endedAt).toBeTypeOf("number");
});

test("submit: rejected on ended game", async () => {
  const t = setupTest();
  mockContextoFetch({
    guesses: { 1336: { persimmon: 0, apple: 5 } },
  });
  const { host, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, {
    gameId,
    word: "persimmon",
  });
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "apple" }),
  ).rejects.toThrow();
});

test("submit: non-member rejected", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { hello: 42591 } } });
  const { gameId } = await startedGame(t);
  const outsider = await seedUser(t);
  await expect(
    asUser(t, outsider).action(api.guesses.submit, { gameId, word: "hello" }),
  ).rejects.toThrow();
});

test("listForGame returns empty for ex-member after leaving room", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { hello: 42591 } } });
  const { host, other, roomId, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "hello" });
  await asUser(t, other).mutation(api.rooms.leave, { roomId });
  const res = await asUser(t, other).query(api.guesses.listForGame, {
    gameId,
  });
  expect(res).toEqual({ sorted: [], latest: null });
});

test("listForGame returns sorted asc + latest", async () => {
  const t = setupTest();
  mockContextoFetch({
    guesses: { 1336: { hello: 42591, apple: 100, peach: 10 } },
  });
  const { host, gameId } = await startedGame(t);
  const u = asUser(t, host);
  await u.action(api.guesses.submit, { gameId, word: "hello" });
  await u.action(api.guesses.submit, { gameId, word: "apple" });
  await u.action(api.guesses.submit, { gameId, word: "peach" });
  const { sorted, latest } = await u.query(api.guesses.listForGame, {
    gameId,
  });
  expect(sorted.map((g) => g.lemma)).toEqual(["peach", "apple", "hello"]);
  expect(latest?.lemma).toBe("peach");
});
