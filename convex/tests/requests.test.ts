import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
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

test("listPending returns empty for ex-member after leaving room", async () => {
  const t = setupTest();
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await asUser(t, other).mutation(api.rooms.leave, { roomId });
  const res = await asUser(t, other).query(api.requests.listPending, {
    gameId,
  });
  expect(res).toEqual([]);
});

test("create inserts pending row of correct type", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
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
  expect(pending[0].requesterUserId).toBe(other);
});

test("create rejects host", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).mutation(api.requests.create, { gameId, type: "hint" }),
  ).rejects.toThrow();
});

test("create rejects non-member", async () => {
  const t = setupTest();
  const { gameId } = await startedGame(t);
  const stranger = await seedUser(t);
  await expect(
    asUser(t, stranger).mutation(api.requests.create, {
      gameId,
      type: "giveup",
    }),
  ).rejects.toThrow();
});

test("create rejects duplicate pending of same type", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  await expect(
    asUser(t, other).mutation(api.requests.create, { gameId, type: "hint" }),
  ).rejects.toThrow();
});

test("create allows different types from same requester", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "giveup",
  });
  const pending = await t.run(async (ctx) =>
    ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) =>
        q.eq("gameId", gameId).eq("status", "pending"),
      )
      .collect(),
  );
  expect(pending).toHaveLength(2);
});

test("create rejects when game not in_progress", async () => {
  const t = setupTest();
  fakeWordOracle({ answers: { 1336: "answer" } });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, host).action(api.giveup.hostGiveup, { gameId });
  await expect(
    asUser(t, other).mutation(api.requests.create, { gameId, type: "hint" }),
  ).rejects.toThrow();
});

test("deny requires host", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await expect(
    asUser(t, other).mutation(api.requests.deny, { requestId: req!._id }),
  ).rejects.toThrow();
});

test("deny patches status to denied", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "giveup",
  });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await asUser(t, host).mutation(api.requests.deny, { requestId: req!._id });
  const row = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", req!._id),
  );
  expect(row?.status).toBe("denied");
});

test("approve requires host", async () => {
  const t = setupTest();
  fakeWordOracle({ tips: { 1336: { 299: "pomelo" } } });
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await expect(
    asUser(t, other).action(api.requests.approve, { requestId: req!._id }),
  ).rejects.toThrow();
});

test("approve rejects non-pending request", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "giveup",
  });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await asUser(t, host).mutation(api.requests.deny, { requestId: req!._id });
  await expect(
    asUser(t, host).action(api.requests.approve, { requestId: req!._id }),
  ).rejects.toThrow();
});

async function createRequest(
  t: ReturnType<typeof setupTest>,
  requester: Id<"users">,
  gameId: Id<"games">,
  type: "hint" | "giveup",
) {
  await asUser(t, requester).mutation(api.requests.create, { gameId, type });
  const req = await t.run(async (ctx) =>
    ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) =>
        q.eq("gameId", gameId).eq("status", "pending"),
      )
      .first(),
  );
  return req!._id;
}

async function snapshot(t: ReturnType<typeof setupTest>, gameId: Id<"games">) {
  return await t.run(async (ctx) => ({
    game: await ctx.db.get("games", gameId),
    guesses: await ctx.db
      .query("gameGuesses")
      .withIndex("by_game_lemma", (q) => q.eq("gameId", gameId))
      .collect(),
  }));
}

test("approve rejects a hint request denied while Contexto is fetching and writes nothing", async () => {
  const t = setupTest();
  const oracle = fakeWordOracle({});
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");
  const before = await snapshot(t, gameId);
  // Approve has passed its pending check; the host denies mid-fetch.
  oracle.tip.mockImplementationOnce(async () => {
    await asUser(t, host).mutation(api.requests.deny, { requestId });
    return { lemma: "pomelo", distance: 299 };
  });
  await expect(
    asUser(t, host).action(api.requests.approve, { requestId }),
  ).rejects.toThrow("Request not found or already handled");
  expect(oracle.tip).toHaveBeenCalledTimes(1);
  const row = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", requestId),
  );
  expect(row?.status).toBe("denied");
  expect(await snapshot(t, gameId)).toEqual(before);
  expect(before.guesses).toHaveLength(0);
});

test("approve rejects a give-up request denied while Contexto is fetching and leaves game in_progress", async () => {
  const t = setupTest();
  const oracle = fakeWordOracle({});
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "giveup");
  const before = await snapshot(t, gameId);
  oracle.answer.mockImplementationOnce(async () => {
    await asUser(t, host).mutation(api.requests.deny, { requestId });
    return { lemma: "answer" };
  });
  await expect(
    asUser(t, host).action(api.requests.approve, { requestId }),
  ).rejects.toThrow("Request not found or already handled");
  expect(oracle.answer).toHaveBeenCalledTimes(1);
  const row = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", requestId),
  );
  expect(row?.status).toBe("denied");
  const after = await snapshot(t, gameId);
  expect(after).toEqual(before);
  expect(after.game?.status).toBe("in_progress");
});

test("second apply of the same hint request is rejected", async () => {
  const t = setupTest();
  fakeWordOracle({ tips: { 1336: { 299: "pomelo", 149: "lime" } } });
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");
  await asUser(t, host).action(api.requests.approve, { requestId });
  await expect(
    asUser(t, host).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "hint", lemma: "pomelo", distance: 299 },
      requestId,
    }),
  ).rejects.toThrow("Request not found or already handled");
  const { guesses } = await snapshot(t, gameId);
  expect(guesses.filter((g) => g.source === "hint")).toHaveLength(1);
});

test("second apply of the same hint request is rejected while the hint walk is active", async () => {
  const t = setupTest();
  fakeWordOracle({
    guesses: { 1336: { close: 1 } },
    tips: { 1336: { 2: "second", 3: "third" } },
  });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "close" });
  const requestId = await createRequest(t, other, gameId, "hint");
  const first = await asUser(t, host).action(api.requests.approve, {
    requestId,
  });
  expect(first).toEqual({ lemma: "second", distance: 2 });
  await expect(
    asUser(t, host).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "hint", lemma: "pomelo", distance: 299 },
      requestId,
    }),
  ).rejects.toThrow("Request not found or already handled");
  const { guesses } = await snapshot(t, gameId);
  expect(guesses.filter((g) => g.source === "hint")).toHaveLength(1);
});

test("hint walk still retries for a pending request", async () => {
  const t = setupTest();
  fakeWordOracle({
    guesses: { 1336: { close: 1, second: 2 } },
    tips: { 1336: { 2: "second", 3: "third" } },
  });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "close" });
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "second" });
  const requestId = await createRequest(t, other, gameId, "hint");
  const result = await asUser(t, host).action(api.requests.approve, {
    requestId,
  });
  expect(result).toEqual({ lemma: "third", distance: 3 });
  const row = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", requestId),
  );
  expect(row?.status).toBe("approved");
});

test("closeRequestId from a different game is rejected and neither game changes", async () => {
  const t = setupTest();
  fakeWordOracle({
    tips: { 1336: { 299: "pomelo" } },
    answers: { 1336: "answer" },
  });
  const a = await startedGame(t);
  const b = await startedGame(t);
  const hintRequestId = await createRequest(t, a.other, a.gameId, "hint");
  const giveupRequestId = await createRequest(t, a.other, a.gameId, "giveup");
  const beforeA = await snapshot(t, a.gameId);
  const beforeB = await snapshot(t, b.gameId);
  await expect(
    asUser(t, b.host).mutation(internal.turns._apply, {
      gameId: b.gameId,
      turn: { kind: "hint", lemma: "pomelo", distance: 299 },
      requestId: hintRequestId,
    }),
  ).rejects.toThrow("Request not found or already handled");
  await expect(
    asUser(t, b.host).mutation(internal.turns._apply, {
      gameId: b.gameId,
      turn: { kind: "giveup", answerLemma: "answer" },
      requestId: giveupRequestId,
    }),
  ).rejects.toThrow("Request not found or already handled");
  expect(await snapshot(t, a.gameId)).toEqual(beforeA);
  expect(await snapshot(t, b.gameId)).toEqual(beforeB);
  const rows = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.get("pendingRequests", hintRequestId),
      ctx.db.get("pendingRequests", giveupRequestId),
    ]),
  );
  expect(rows.map((r) => r?.status)).toEqual(["pending", "pending"]);
});
