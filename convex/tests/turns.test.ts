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
      .withIndex("by_requester_game_type_status", (q) =>
        q
          .eq("requesterUserId", requester)
          .eq("gameId", gameId)
          .eq("type", type)
          .eq("status", "pending"),
      )
      .unique(),
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
    requests: await ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) => q.eq("gameId", gameId))
      .collect(),
  }));
}

test("apply rejects a hint turn from a non-host member", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  const before = await snapshot(t, gameId);
  await expect(
    asUser(t, other).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "hint", lemma: "pomelo", distance: 299 },
    }),
  ).rejects.toThrow("Host only");
  expect(await snapshot(t, gameId)).toEqual(before);
});

test("apply rejects a give-up turn from a non-host member", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  const before = await snapshot(t, gameId);
  await expect(
    asUser(t, other).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "giveup", answerLemma: "persimmon" },
    }),
  ).rejects.toThrow("Host only");
  expect(await snapshot(t, gameId)).toEqual(before);
});

test("apply rejects approving a request from a non-host member", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  const hintRequestId = await createRequest(t, other, gameId, "hint");
  const giveupRequestId = await createRequest(t, other, gameId, "giveup");
  const before = await snapshot(t, gameId);
  await expect(
    asUser(t, other).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "hint", lemma: "pomelo", distance: 299 },
      requestId: hintRequestId,
    }),
  ).rejects.toThrow("Host only");
  await expect(
    asUser(t, other).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "giveup", answerLemma: "persimmon" },
      requestId: giveupRequestId,
    }),
  ).rejects.toThrow("Host only");
  expect(await snapshot(t, gameId)).toEqual(before);
});

test("apply rejects a guess turn from a non-member", async () => {
  const t = setupTest();
  const { gameId } = await startedGame(t);
  const stranger = await seedUser(t);
  await expect(
    asUser(t, stranger).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "guess", lemma: "hello", distance: 42 },
    }),
  ).rejects.toThrow("Not a member of this room");
});

test("apply rejects an unauthenticated caller", async () => {
  const t = setupTest();
  const { gameId } = await startedGame(t);
  await expect(
    t.mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "giveup", answerLemma: "persimmon" },
    }),
  ).rejects.toThrow("Not authenticated");
});

test("apply attributes a guess turn to the caller", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  const result = await asUser(t, other).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "guess", lemma: "hello", distance: 42 },
  });
  expect(result).toMatchObject({ status: "recorded", won: false });
  const { guesses } = await snapshot(t, gameId);
  expect(guesses).toMatchObject([
    { userId: other, lemma: "hello", source: "guess" },
  ]);
});

test("apply attributes an approved hint to the requester, not the host", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");
  await asUser(t, host).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "hint", lemma: "pomelo", distance: 299 },
    requestId,
  });
  const { guesses, requests } = await snapshot(t, gameId);
  expect(guesses).toMatchObject([
    { userId: other, lemma: "pomelo", source: "hint" },
  ]);
  expect(requests.map((r) => r.status)).toEqual(["approved"]);
});

test("apply rejects a request whose type does not match the turn", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  const hintRequestId = await createRequest(t, other, gameId, "hint");
  const before = await snapshot(t, gameId);
  await expect(
    asUser(t, host).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "giveup", answerLemma: "persimmon" },
      requestId: hintRequestId,
    }),
  ).rejects.toThrow("Request not found or already handled");
  await expect(
    asUser(t, host).mutation(internal.turns._apply, {
      gameId,
      turn: { kind: "guess", lemma: "hello", distance: 42 },
      requestId: hintRequestId,
    }),
  ).rejects.toThrow("Request not found or already handled");
  expect(await snapshot(t, gameId)).toEqual(before);
});

test("guess turns go through the word oracle, not fetch", async () => {
  const t = setupTest();
  const oracle = fakeWordOracle({ guesses: { 1336: { hello: 42 } } });
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const { host, gameId } = await startedGame(t);
  const res = await asUser(t, host).action(api.guesses.submit, {
    gameId,
    word: "hello",
  });
  expect(res).toMatchObject({ lemma: "hello", distance: 42 });
  expect(oracle.distance).toHaveBeenCalledWith(1336, "hello");
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("unknown words are not cached", async () => {
  const t = setupTest();
  const oracle = fakeWordOracle({ guesses: { 1336: {} } });
  const { host, gameId } = await startedGame(t);
  const res = await asUser(t, host).action(api.guesses.submit, {
    gameId,
    word: "zzz",
  });
  expect(res.message).toBe("I'm sorry, I don't know this word");
  const cached = await t.run(async (ctx) =>
    ctx.db.query("wordDistances").collect(),
  );
  expect(cached).toEqual([]);
  expect(oracle.distance).toHaveBeenCalledTimes(1);
});
