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
  const { roomId, code } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
  await asUser(t, other).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  return { host, other, roomId, gameId };
}

test("non-host request creates pending row", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.hints.request, { gameId });
  const pending = await t.run(async (ctx) =>
    ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) =>
        q.eq("gameId", gameId).eq("status", "pending"),
      )
      .collect(),
  );
  expect(pending).toHaveLength(1);
  expect(pending[0].type).toBe("hint");
});

test("non-host listPending shows only own requests", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  const third = await seedUser(t);
  const { code } = await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", "AAAAAA"))
      .first();
    return { code: room?.code ?? "" };
  });
  void code;
  // join third
  const room = await t.run(async (ctx) =>
    (await ctx.db.query("rooms").first())!,
  );
  await asUser(t, third).mutation(api.rooms.join, { code: room.code });
  await asUser(t, other).mutation(api.hints.request, { gameId });
  await asUser(t, third).mutation(api.hints.request, { gameId });
  const asOther = await asUser(t, other).query(api.requests.listPending, {
    gameId,
  });
  expect(asOther).toHaveLength(1);
  const asHost = await asUser(t, host).query(api.requests.listPending, {
    gameId,
  });
  expect(asHost).toHaveLength(2);
});

test("non-host duplicate request rejected", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.hints.request, { gameId });
  await expect(
    asUser(t, other).mutation(api.hints.request, { gameId }),
  ).rejects.toThrow();
});

test("non-host approve rejected", async () => {
  const t = setupTest();
  mockContextoFetch({ tips: { 1336: { 299: "pomelo" } } });
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.hints.request, { gameId });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await expect(
    asUser(t, other).action(api.hints.approve, { requestId: req!._id }),
  ).rejects.toThrow();
});

test("host approve writes hint row + marks approved (no guesses → 299)", async () => {
  const t = setupTest();
  mockContextoFetch({ tips: { 1336: { 299: "pomelo" } } });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.hints.request, { gameId });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  const result = await asUser(t, host).action(api.hints.approve, {
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
  expect(rows[0].userId).toBe(other); // attributed to requester
  const reqRow = await t.run(async (ctx) => ctx.db.get(req!._id));
  expect(reqRow?.status).toBe("approved");
});

test("hostHint shortcut works with no pending row", async () => {
  const t = setupTest();
  mockContextoFetch({ tips: { 1336: { 299: "pomelo" } } });
  const { host, gameId } = await startedGame(t);
  const result = await asUser(t, host).action(api.hints.hostHint, { gameId });
  expect(result.lemma).toBe("pomelo");
});

test("hint target reflects best score", async () => {
  const t = setupTest();
  mockContextoFetch({
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
  mockContextoFetch({
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

test("host deny patches request", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.hints.request, { gameId });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await asUser(t, host).mutation(api.hints.deny, { requestId: req!._id });
  const row = await t.run(async (ctx) => ctx.db.get(req!._id));
  expect(row?.status).toBe("denied");
});
