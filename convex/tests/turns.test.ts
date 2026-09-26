import { expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { asUser, seedUser, setupTest } from "../testHelpers.test";
import { posthog } from "../posthog";

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

test("a duplicate Guess and a win record their Game outcomes once", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);

  await asUser(t, other).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "guess", lemma: "orange", distance: 42 },
  });
  await asUser(t, other).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "guess", lemma: "orange", distance: 42 },
  });
  await asUser(t, other).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "guess", lemma: "persimmon", distance: 0 },
  });
  vi.runAllTimers();
  await t.finishInProgressScheduledFunctions();
  vi.useRealTimers();

  expect(capture.mock.calls.map(([, event]) => event.event)).toEqual([
    "guess_recorded",
    "guess_recorded",
    "guess_recorded",
    "game_won",
  ]);
  expect(capture.mock.calls[1][1]).toMatchObject({
    distinctId: other,
    properties: { lemma: "orange", distance: 42, duplicate: true },
  });
  expect(capture.mock.calls[3][1]).toMatchObject({
    distinctId: other,
    properties: {
      game_id: gameId,
      guess_count: 2,
      hint_count: 0,
      member_count: 2,
      duration_ms: expect.any(Number),
    },
  });
});

test("approved hint and give-up requests record the committed outcomes", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  const hintRequestId = await createRequest(t, other, gameId, "hint");
  const giveupRequestId = await createRequest(t, other, gameId, "giveup");
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);

  await asUser(t, host).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "hint", lemma: "orange", distance: 42 },
    requestId: hintRequestId,
  });
  await asUser(t, host).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "giveup", answerLemma: "persimmon" },
    requestId: giveupRequestId,
  });
  vi.runAllTimers();
  await t.finishInProgressScheduledFunctions();
  vi.useRealTimers();

  expect(capture.mock.calls.map(([, event]) => event.event)).toEqual([
    "guess_recorded",
    "hint_given",
    "request_approved",
    "request_approved",
    "game_given_up",
  ]);
  expect(capture.mock.calls[1][1]).toMatchObject({
    distinctId: host,
    properties: { game_id: gameId, source: "request" },
  });
  expect(capture.mock.calls[4][1]).toMatchObject({
    properties: {
      game_id: gameId,
      guess_count: 0,
      hint_count: 1,
      member_count: 2,
      duration_ms: expect.any(Number),
    },
  });
});

test("a Game outcome counts Guesses beyond one page", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 1001; i++) {
      await ctx.db.insert("gameGuesses", {
        gameId,
        userId: host,
        lemma: `word${i}`,
        distance: i + 1,
        source: "guess",
        createdAt: Date.now(),
      });
    }
  });
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  await asUser(t, host).mutation(internal.turns._apply, {
    gameId,
    turn: { kind: "giveup", answerLemma: "answer" },
  });
  vi.runAllTimers();
  await t.finishInProgressScheduledFunctions();
  vi.useRealTimers();
  expect(
    capture.mock.calls.find(
      ([, event]) => event.event === "game_given_up",
    )?.[1],
  ).toMatchObject({ properties: { guess_count: 1001 } });
});

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
