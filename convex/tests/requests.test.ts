import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { posthog } from "../posthog";
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
  const { other, roomId, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.rooms.leave, { roomId });
  const res = await asUser(t, other).query(api.requests.listPending, {
    gameId,
  });
  expect(res).toEqual([]);
});

test("listPending shows a non-Host only their own requests", async () => {
  const t = setupTest();
  const { host, other, roomId, gameId } = await startedGame(t);
  const third = await seedUser(t, { name: "Third" });
  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  await asUser(t, third).mutation(api.rooms.join, { code: room!.code });
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  await asUser(t, third).mutation(api.requests.create, {
    gameId,
    type: "giveup",
  });

  const requesters = async (userId: Id<"users">) =>
    (await asUser(t, userId).query(api.requests.listPending, { gameId })).map(
      (r) => r.requesterUserId,
    );
  expect(await requesters(other)).toEqual([other]);
  expect(await requesters(third)).toEqual([third]);
  expect(new Set(await requesters(host))).toEqual(new Set([other, third]));
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

test("creating and denying a Pending request records both outcomes", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  capture.mockClear();

  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  const request = await t.run(async (ctx) =>
    ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) =>
        q.eq("gameId", gameId).eq("status", "pending"),
      )
      .first(),
  );
  expect(request).not.toBeNull();
  await asUser(t, host).mutation(api.requests.deny, {
    requestId: request!._id,
  });
  await expect(
    asUser(t, host).mutation(api.requests.deny, { requestId: request!._id }),
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });

  expect(capture.mock.calls.map(([, event]) => event)).toEqual([
    expect.objectContaining({
      distinctId: other,
      event: "request_created",
      properties: expect.objectContaining({
        request_id: request!._id,
        game_id: gameId,
        request_type: "hint",
      }),
    }),
    expect.objectContaining({
      distinctId: host,
      event: "request_denied",
      properties: expect.objectContaining({
        request_id: request!._id,
        game_id: gameId,
        request_type: "hint",
      }),
    }),
  ]);
});

test("create rejects host", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).mutation(api.requests.create, { gameId, type: "hint" }),
  ).rejects.toThrow("Host should use the direct hint action");
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
  ).rejects.toMatchObject({ data: { code: "notMember" } });
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
  ).rejects.toMatchObject({ data: { code: "requestAlreadyPending" } });
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
  ).rejects.toMatchObject({ data: { code: "gameEnded" } });
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
  ).rejects.toMatchObject({ data: { code: "hostOnly" } });
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
  ).rejects.toMatchObject({ data: { code: "hostOnly" } });
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
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
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

// Seeded sessions last a minute; keep everyone signed in past that.
async function extendSessions(t: ReturnType<typeof setupTest>) {
  await t.run(async (ctx) => {
    for (const session of await ctx.db.query("authSessions").collect()) {
      await ctx.db.patch("authSessions", session._id, {
        expirationTime: Date.now() + 10 * 60_000,
      });
    }
  });
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
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
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
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
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
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
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
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
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
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
  await expect(
    asUser(t, b.host).mutation(internal.turns._apply, {
      gameId: b.gameId,
      turn: { kind: "giveup", answerLemma: "answer" },
      requestId: giveupRequestId,
    }),
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
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

test("cancel lets the requester take back a Pending request", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");
  capture.mockClear();

  await asUser(t, other).mutation(api.requests.cancel, { requestId });

  expect(
    await asUser(t, host).query(api.requests.listPending, { gameId }),
  ).toEqual([]);
  expect(
    await asUser(t, other).query(api.requests.latestMine, { gameId }),
  ).toEqual({ hint: null, giveup: null });
  expect(capture.mock.calls.map(([, event]) => event)).toEqual([
    expect.objectContaining({
      distinctId: other,
      event: "request_cancelled",
      properties: expect.objectContaining({
        request_id: requestId,
        game_id: gameId,
        request_type: "hint",
      }),
    }),
  ]);
  // Asking again works once the old request is gone.
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
});

test("cancel rejects anyone but the requester", async () => {
  const t = setupTest();
  const { host, other, roomId, gameId } = await startedGame(t);
  const third = await seedUser(t, { name: "Third" });
  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  await asUser(t, third).mutation(api.rooms.join, { code: room!.code });
  const requestId = await createRequest(t, other, gameId, "giveup");

  for (const userId of [host, third]) {
    await expect(
      asUser(t, userId).mutation(api.requests.cancel, { requestId }),
    ).rejects.toMatchObject({ data: { code: "requestHandled" } });
  }
  const row = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", requestId),
  );
  expect(row?.status).toBe("pending");
});

test("cancel rejects a request the Host already handled", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");
  await asUser(t, host).mutation(api.requests.deny, { requestId });
  await expect(
    asUser(t, other).mutation(api.requests.cancel, { requestId }),
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
  const row = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", requestId),
  );
  expect(row?.status).toBe("denied");
});

test("approve rejects a request cancelled while Contexto is fetching and writes nothing", async () => {
  const t = setupTest();
  const oracle = fakeWordOracle({});
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");
  const before = await snapshot(t, gameId);
  oracle.tip.mockImplementationOnce(async () => {
    await asUser(t, other).mutation(api.requests.cancel, { requestId });
    return { lemma: "pomelo", distance: 299 };
  });
  await expect(
    asUser(t, host).action(api.requests.approve, { requestId }),
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
  expect(await snapshot(t, gameId)).toEqual(before);
});

test("latestMine returns the viewer's newest request of each type", async () => {
  const t = setupTest();
  fakeWordOracle({ tips: { 1336: { 299: "pomelo" } } });
  const { host, other, gameId } = await startedGame(t);
  const deniedHint = await createRequest(t, other, gameId, "hint");
  await asUser(t, host).mutation(api.requests.deny, { requestId: deniedHint });
  const hintId = await createRequest(t, other, gameId, "hint");
  const giveupId = await createRequest(t, other, gameId, "giveup");

  const pending = await asUser(t, other).query(api.requests.latestMine, {
    gameId,
  });
  const times = {
    createdAt: expect.any(Number),
    expiresAt: expect.any(Number),
  };
  expect(pending).toEqual({
    hint: { _id: hintId, status: "pending", ...times },
    giveup: { _id: giveupId, status: "pending", ...times },
  });

  await asUser(t, host).action(api.requests.approve, { requestId: hintId });
  await asUser(t, host).mutation(api.requests.deny, { requestId: giveupId });
  const resolved = await asUser(t, other).query(api.requests.latestMine, {
    gameId,
  });
  expect(resolved).toEqual({
    hint: {
      _id: hintId,
      status: "approved",
      ...times,
      hint: { lemma: "pomelo", distance: 299 },
    },
    giveup: { _id: giveupId, status: "denied", ...times },
  });
});

test("latestMine hides other members' requests and answers non-members with nothing", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  await createRequest(t, other, gameId, "hint");
  const stranger = await seedUser(t);
  const empty = { hint: null, giveup: null };
  expect(
    await asUser(t, host).query(api.requests.latestMine, { gameId }),
  ).toEqual(empty);
  expect(
    await asUser(t, stranger).query(api.requests.latestMine, { gameId }),
  ).toEqual(empty);
});

test("latestMine prefers a Pending request over a newer handled one", async () => {
  const t = setupTest();
  const { other, roomId, gameId } = await startedGame(t);
  // Guest merge can leave an older pending row behind a newer denied one.
  const createdAt = Date.now();
  const pendingId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("pendingRequests", {
      roomId,
      gameId,
      requesterUserId: other,
      type: "hint",
      status: "pending",
      createdAt,
      expiresAt: createdAt + 60_000,
    });
    await ctx.db.insert("pendingRequests", {
      roomId,
      gameId,
      requesterUserId: other,
      type: "hint",
      status: "denied",
      createdAt: createdAt + 1,
    });
    return id;
  });
  const latest = await asUser(t, other).query(api.requests.latestMine, {
    gameId,
  });
  expect(latest.hint).toEqual({
    _id: pendingId,
    status: "pending",
    createdAt,
    expiresAt: createdAt + 60_000,
  });
});

test("create allows one Pending request of each type per Game", async () => {
  const t = setupTest();
  const { other, roomId, gameId } = await startedGame(t);
  const third = await seedUser(t, { name: "Third" });
  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  await asUser(t, third).mutation(api.rooms.join, { code: room!.code });
  await createRequest(t, other, gameId, "hint");

  await expect(
    asUser(t, third).mutation(api.requests.create, { gameId, type: "hint" }),
  ).rejects.toMatchObject({ data: { code: "requestPendingByOther" } });
  await asUser(t, third).mutation(api.requests.create, {
    gameId,
    type: "giveup",
  });
  await expect(
    asUser(t, other).mutation(api.requests.create, {
      gameId,
      type: "giveup",
    }),
  ).rejects.toMatchObject({ data: { code: "requestPendingByOther" } });
});

test("a Pending request expires after a minute without an answer", async () => {
  vi.useFakeTimers();
  try {
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
    vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
    const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
    const t = setupTest();
    const { host, other, gameId } = await startedGame(t);
    // Seeded sessions last a minute too; keep both players signed in.
    await t.run(async (ctx) => {
      for (const session of await ctx.db.query("authSessions").collect()) {
        await ctx.db.patch("authSessions", session._id, {
          expirationTime: Date.now() + 10 * 60_000,
        });
      }
    });
    const requestId = await createRequest(t, other, gameId, "hint");
    const created = await asUser(t, other).query(api.requests.latestMine, {
      gameId,
    });
    expect(created.hint?.expiresAt).toBe(created.hint!.createdAt + 60_000);
    capture.mockClear();

    vi.advanceTimersByTime(59_000);
    await t.finishInProgressScheduledFunctions();
    expect(
      await asUser(t, host).query(api.requests.listPending, { gameId }),
    ).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
    expect(
      await asUser(t, host).query(api.requests.listPending, { gameId }),
    ).toEqual([]);
    const latest = await asUser(t, other).query(api.requests.latestMine, {
      gameId,
    });
    expect(latest.hint).toMatchObject({ _id: requestId, status: "expired" });
    expect(capture.mock.calls.map(([, event]) => event)).toEqual([
      expect.objectContaining({
        distinctId: other,
        event: "request_expired",
        properties: expect.objectContaining({
          request_id: requestId,
          game_id: gameId,
          request_type: "hint",
        }),
      }),
    ]);
    // Asking again works once it has expired.
    await asUser(t, other).mutation(api.requests.create, {
      gameId,
      type: "hint",
    });
  } finally {
    vi.useRealTimers();
  }
});

test("expiry leaves a request the Host already answered alone", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const { host, other, gameId } = await startedGame(t);
    const requestId = await createRequest(t, other, gameId, "giveup");
    await asUser(t, host).mutation(api.requests.deny, { requestId });

    vi.advanceTimersByTime(60_000);
    await t.finishInProgressScheduledFunctions();
    const row = await t.run(async (ctx) =>
      ctx.db.get("pendingRequests", requestId),
    );
    expect(row?.status).toBe("denied");
  } finally {
    vi.useRealTimers();
  }
});

test("listPending tells the Host when each request expires", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  await createRequest(t, other, gameId, "hint");
  const [request] = await asUser(t, host).query(api.requests.listPending, {
    gameId,
  });
  expect(request.expiresAt).toBe(request.createdAt + 60_000);
});

test("pendingFromOthers names who holds each request type", async () => {
  const t = setupTest();
  const { other, roomId, gameId } = await startedGame(t);
  const third = await seedUser(t, { name: "Third" });
  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  await asUser(t, third).mutation(api.rooms.join, { code: room!.code });
  await createRequest(t, other, gameId, "hint");

  expect(
    await asUser(t, third).query(api.requests.pendingFromOthers, { gameId }),
  ).toEqual({ hint: { name: "Other" }, giveup: null });
  // The requester's own request isn't someone else's.
  expect(
    await asUser(t, other).query(api.requests.pendingFromOthers, { gameId }),
  ).toEqual({ hint: null, giveup: null });
  const stranger = await seedUser(t);
  expect(
    await asUser(t, stranger).query(api.requests.pendingFromOthers, {
      gameId,
    }),
  ).toEqual({ hint: null, giveup: null });
});

test("approve finishes a request that expires while Contexto is fetching", async () => {
  const t = setupTest();
  const oracle = fakeWordOracle({});
  const { host, other, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");
  // The expiry fires after the Host pressed Give hint, mid-fetch.
  oracle.tip.mockImplementationOnce(async () => {
    await t.mutation(internal.requests._expire, { requestId });
    return { lemma: "pomelo", distance: 299 };
  });

  const result = await asUser(t, host).action(api.requests.approve, {
    requestId,
  });

  expect(result).toEqual({ lemma: "pomelo", distance: 299 });
  const row = await t.run(async (ctx) =>
    ctx.db.get("pendingRequests", requestId),
  );
  expect(row?.status).toBe("approved");
});

test("a request still expires if its approval never finishes", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const oracle = fakeWordOracle({});
    const { host, other, gameId } = await startedGame(t);
    const requestId = await createRequest(t, other, gameId, "hint");
    oracle.tip.mockRejectedValueOnce(new Error("Contexto is down"));
    await expect(
      asUser(t, host).action(api.requests.approve, { requestId }),
    ).rejects.toThrow();

    vi.advanceTimersByTime(60_000);
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(60_000);
    await t.finishInProgressScheduledFunctions();
    const row = await t.run(async (ctx) =>
      ctx.db.get("pendingRequests", requestId),
    );
    expect(row?.status).toBe("expired");
  } finally {
    vi.useRealTimers();
  }
});

test("leaving the Room withdraws the member's pending requests", async () => {
  const t = setupTest();
  const { host, other, roomId, gameId } = await startedGame(t);
  const third = await seedUser(t, { name: "Third" });
  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  await asUser(t, third).mutation(api.rooms.join, { code: room!.code });
  await createRequest(t, other, gameId, "hint");
  await createRequest(t, other, gameId, "giveup");

  await asUser(t, other).mutation(api.rooms.leave, { roomId });

  expect(
    await asUser(t, host).query(api.requests.listPending, { gameId }),
  ).toEqual([]);
  expect(
    await asUser(t, third).query(api.requests.pendingFromOthers, { gameId }),
  ).toEqual({ hint: null, giveup: null });
  await asUser(t, third).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
});

test("an overdue request doesn't block a new one", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const { other, roomId, gameId } = await startedGame(t);
    const third = await seedUser(t, { name: "Third" });
    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    await asUser(t, third).mutation(api.rooms.join, { code: room!.code });
    await extendSessions(t);
    const staleId = await createRequest(t, other, gameId, "hint");

    // Moves the clock without running the scheduled expiry.
    vi.setSystemTime(Date.now() + 60_000);

    expect(
      await asUser(t, third).query(api.requests.pendingFromOthers, { gameId }),
    ).toEqual({ hint: null, giveup: null });
    await asUser(t, third).mutation(api.requests.create, {
      gameId,
      type: "hint",
    });
    const stale = await t.run(async (ctx) =>
      ctx.db.get("pendingRequests", staleId),
    );
    expect(stale?.status).toBe("expired");
  } finally {
    vi.useRealTimers();
  }
});

test("approve rejects a request that is past its deadline", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const oracle = fakeWordOracle({});
    const { host, other, gameId } = await startedGame(t);
    await extendSessions(t);
    const staleId = await createRequest(t, other, gameId, "hint");

    // Moves the clock without running the scheduled expiry.
    vi.setSystemTime(Date.now() + 60_000);

    await expect(
      asUser(t, host).action(api.requests.approve, { requestId: staleId }),
    ).rejects.toMatchObject({ data: { code: "requestHandled" } });

    expect(oracle.tip).not.toHaveBeenCalled();
    const stale = await t.run(async (ctx) =>
      ctx.db.get("pendingRequests", staleId),
    );
    expect(stale?.status).toBe("expired");
  } finally {
    vi.useRealTimers();
  }
});

test("latestMine reports an overdue request as expired", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const { other, gameId } = await startedGame(t);
    await extendSessions(t);
    const staleId = await createRequest(t, other, gameId, "hint");

    // Moves the clock without running the scheduled expiry.
    vi.setSystemTime(Date.now() + 60_000);

    const latest = await asUser(t, other).query(api.requests.latestMine, {
      gameId,
    });
    expect(latest.hint).toMatchObject({ _id: staleId, status: "expired" });
  } finally {
    vi.useRealTimers();
  }
});

test("a request with no deadline counts as overdue", async () => {
  const t = setupTest();
  const { host, other, roomId, gameId } = await startedGame(t);
  // Only rows from before requests expired look like this.
  await t.run(async (ctx) =>
    ctx.db.insert("pendingRequests", {
      roomId,
      gameId,
      requesterUserId: other,
      type: "hint",
      status: "pending",
      createdAt: Date.now(),
    }),
  );

  expect(
    await asUser(t, host).query(api.requests.listPending, { gameId }),
  ).toEqual([]);
});

test("listPending hides a request past its deadline before its expiry runs", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const { host, other, gameId } = await startedGame(t);
    await extendSessions(t);
    await createRequest(t, other, gameId, "hint");

    // Moves the clock without running the scheduled expiry.
    vi.setSystemTime(Date.now() + 60_000);

    expect(
      await asUser(t, host).query(api.requests.listPending, { gameId }),
    ).toEqual([]);
    expect(
      await asUser(t, other).query(api.requests.listPending, { gameId }),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("approve rejects a request that stops being live while Contexto is fetching", async () => {
  vi.useFakeTimers();
  try {
    const t = setupTest();
    const oracle = fakeWordOracle({});
    const { host, other, gameId } = await startedGame(t);
    await extendSessions(t);
    const requestId = await createRequest(t, other, gameId, "hint");
    const before = await snapshot(t, gameId);
    // The fetch outlasts both the deadline and the approval's grace period.
    oracle.tip.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 2 * 60_000);
      return { lemma: "pomelo", distance: 299 };
    });

    await expect(
      asUser(t, host).action(api.requests.approve, { requestId }),
    ).rejects.toMatchObject({ data: { code: "requestHandled" } });

    expect(await snapshot(t, gameId)).toEqual(before);
    const row = await t.run(async (ctx) =>
      ctx.db.get("pendingRequests", requestId),
    );
    expect(row?.status).toBe("pending");
  } finally {
    vi.useRealTimers();
  }
});

test("a member who becomes Host has their pending requests withdrawn", async () => {
  const t = setupTest();
  fakeWordOracle({ tips: { 1336: { 299: "pomelo" } } });
  const { host, other, roomId, gameId } = await startedGame(t);
  const requestId = await createRequest(t, other, gameId, "hint");

  await asUser(t, host).mutation(api.rooms.leave, { roomId });

  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  expect(room?.hostUserId).toBe(other);
  expect(
    await asUser(t, other).query(api.requests.listPending, { gameId }),
  ).toEqual([]);
  await expect(
    asUser(t, other).action(api.requests.approve, { requestId }),
  ).rejects.toMatchObject({ data: { code: "requestHandled" } });
});
