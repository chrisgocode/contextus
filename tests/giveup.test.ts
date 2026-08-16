import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
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

test("approve via requests dispatcher ends game with answer + marks approved", async () => {
  const t = setupTest();
  mockContextoFetch({ answers: { 1336: "persimmon" } });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "giveup",
  });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  const result = await asUser(t, host).action(api.requests.approve, {
    requestId: req!._id,
  });
  expect(result.lemma).toBe("persimmon");
  const game = await t.run(async (ctx) => ctx.db.get(gameId));
  expect(game?.status).toBe("given_up");
  expect(game?.answerLemma).toBe("persimmon");
  const reqRow = await t.run(async (ctx) => ctx.db.get(req!._id));
  expect(reqRow?.status).toBe("approved");
});

test("hostGiveup shortcut works with no pending row", async () => {
  const t = setupTest();
  mockContextoFetch({ answers: { 1336: "persimmon" } });
  const { host, gameId } = await startedGame(t);
  await asUser(t, host).action(api.giveup.hostGiveup, { gameId });
  const game = await t.run(async (ctx) => ctx.db.get(gameId));
  expect(game?.status).toBe("given_up");
});

test("given-up games count toward guest account prompts after a real guess", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const { roomId } = await asUser(t, guest).mutation(api.rooms.create, {});
  mockContextoFetch({
    guesses: { 1: { try: 500 }, 2: { try: 500 }, 3: { try: 500 } },
    answers: { 1: "one", 2: "two", 3: "three" },
  });

  for (let contextoGameId = 1; contextoGameId <= 3; contextoGameId++) {
    const { gameId } = await asUser(t, guest).mutation(api.games.start, {
      roomId,
      contextoGameId,
    });
    await asUser(t, guest).action(api.guesses.submit, { gameId, word: "try" });
    await asUser(t, guest).action(api.giveup.hostGiveup, { gameId });
  }

  await expect(
    asUser(t, guest).query(api.users.getGuestAccountPrompt, {}),
  ).resolves.toMatchObject({ completedGames: 3 });
});

test("game completion credits participants beyond the first page", async () => {
  const t = setupTest();
  const participantIds = await t.run(async (ctx) => {
    const hostId = await ctx.db.insert("users", { name: "Host" });
    const roomId = await ctx.db.insert("rooms", {
      code: "PAGING",
      hostUserId: hostId,
      status: "active",
    });
    const gameId = await ctx.db.insert("games", {
      roomId,
      contextoGameId: 1336,
      status: "in_progress",
      startedAt: Date.now(),
    });
    const ids = [];
    for (let index = 0; index < 501; index++) {
      const userId = await ctx.db.insert("users", { isAnonymous: true });
      ids.push(userId);
      await ctx.db.insert("gamePlayerStats", {
        gameId,
        userId,
        realGuessCount: 1,
        bestDistance: 100,
        lastDistance: 100,
        noBacktrackingSoFar: true,
        updatedAt: Date.now(),
      });
    }
    return { gameId, first: ids[0], last: ids.at(-1) };
  });

  await t.mutation(internal.gameTransitions.applyGiveup, {
    gameId: participantIds.gameId,
    answerLemma: "persimmon",
  });

  const credited = await t.run(async (ctx) => ({
    first: await ctx.db.get(participantIds.first!),
    last: await ctx.db.get(participantIds.last!),
  }));
  expect(credited.first?.guestCompletedGames).toBe(1);
  expect(credited.last?.guestCompletedGames).toBe(1);
});
