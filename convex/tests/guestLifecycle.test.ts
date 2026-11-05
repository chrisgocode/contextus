import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  asUser,
  finishScheduledFunctions,
  seedUser,
  setupTest,
} from "../testHelpers.test";

afterEach(() => vi.useRealTimers());

test("an interrupted merge owns the Guest even after postponed expiry", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  const target = await seedUser(t);
  // Arrange a persisted job left by an interrupted sign-in worker.
  const mergeId = await t.run(async (ctx) => {
    await ctx.db.insert("userGameHistory", {
      userId: guest,
      contextoGameId: 1336,
      firstPlayedAt: 1,
    });
    return ctx.db.insert("guestMerges", {
      guestUserId: guest,
      targetUserId: target,
      phase: "history",
      overlappingSolves: 0,
      streakRun: 0,
      streakBest: 0,
    });
  });

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  expect(await asUser(t, guest).query(api.users.getUser, {})).toMatchObject({
    isAnonymous: true,
  });
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  await finishScheduledFunctions(t);
  expect(await asUser(t, target).query(api.games.listMyHistory, {})).toEqual([
    1336,
  ]);
  expect(
    await asUser(t, target).query(api.users.getUser, { userId: guest }),
  ).toBeNull();
  // A delivered-again worker is harmless after completion.
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  expect(await asUser(t, target).query(api.games.listMyHistory, {})).toEqual([
    1336,
  ]);
});

test("cleanup advances past a full page of merge-owned Guests", async () => {
  vi.useFakeTimers();
  const t = setupTest({ transactionLimits: { documentsRead: 250 } });
  const viewer = await seedUser(t);
  for (let i = 0; i < 50; i++) {
    const guest = await seedUser(t, {
      isAnonymous: true,
      guestExpiresAt: Date.now() - 2,
    });
    await t.run((ctx) =>
      ctx.db.insert("guestMerges", {
        guestUserId: guest,
        targetUserId: viewer,
        phase: "history",
        overlappingSolves: 0,
        streakRun: 0,
        streakBest: 0,
      }),
    );
  }
  const expired = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  await finishScheduledFunctions(t);
  expect(
    await asUser(t, viewer).query(api.users.getUser, { userId: expired }),
  ).toMatchObject({ name: "Former Guest", isAnonymous: false, username: null });
});

test("full merge batches repeat, short batches advance, and stale Guest Rooms are re-swept", async () => {
  vi.useFakeTimers();
  const t = setupTest({ transactionLimits: { documentsRead: 350 } });
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const mergeId = await t.run(async (ctx) => {
    for (let i = 1; i <= 101; i++) {
      await ctx.db.insert("userGameHistory", {
        userId: guest,
        contextoGameId: i,
        firstPlayedAt: i,
      });
    }
    return ctx.db.insert("guestMerges", {
      guestUserId: guest,
      targetUserId: target,
      phase: "history",
      overlappingSolves: 0,
      streakRun: 0,
      streakBest: 0,
    });
  });
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  expect(
    await asUser(t, target).query(api.games.listMyHistory, {}),
  ).toHaveLength(100);
  expect(await asUser(t, guest).query(api.games.listMyHistory, {})).toEqual([
    101,
  ]);
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  expect(
    await asUser(t, target).query(api.games.listMyHistory, {}),
  ).toHaveLength(101);

  // A restored worker is at finalization when another Guest tab creates a
  // Room and starts a Game: these writes must survive the final re-sweep.
  await t.run((ctx) =>
    ctx.db.patch("guestMerges", mergeId, { phase: "finalize" }),
  );
  const { roomId, code } = await asUser(t, guest).mutation(
    api.rooms.create,
    {},
  );
  await asUser(t, guest).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  await finishScheduledFunctions(t);
  const room = await asUser(t, target).query(api.rooms.getByCode, { code });
  expect(room).toMatchObject({
    isViewerHost: true,
    room: { hostUserId: target },
  });
  expect(room?.members.map((member) => member.userId)).toEqual([target]);
  expect(await asUser(t, target).query(api.games.listMyHistory, {})).toContain(
    1336,
  );
  expect(
    await asUser(t, target).query(api.users.getUser, { userId: guest }),
  ).toBeNull();
});

test("merge finalization removes auth data within a transaction budget", async () => {
  vi.useFakeTimers();
  const t = setupTest({ transactionLimits: { documentsRead: 250 } });
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId: guest,
      expirationTime: Date.now() + 60_000,
    }),
  );
  for (let batch = 0; batch < 3; batch++) {
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) {
        await ctx.db.insert("authRefreshTokens", {
          sessionId,
          expirationTime: Date.now() + 60_000,
        });
      }
    });
  }
  const mergeId = await t.run((ctx) =>
    ctx.db.insert("guestMerges", {
      guestUserId: guest,
      targetUserId: target,
      phase: "finalize",
      overlappingSolves: 0,
      streakRun: 0,
      streakBest: 0,
    }),
  );
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  await finishScheduledFunctions(t);
  expect(
    await asUser(t, target).query(api.users.getUser, { userId: guest }),
  ).toBeNull();
  expect(await asUser(t, guest).query(api.users.getUser, {})).toBeNull();
});

test("interrupted cleanup retains shared history, transfers the Host, and excludes an obsolete merge", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  const member = await seedUser(t);
  const { roomId, code } = await asUser(t, guest).mutation(
    api.rooms.create,
    {},
  );
  await asUser(t, member).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, guest).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("authAccounts", {
      userId: guest,
      provider: "anonymous",
      providerAccountId: "interrupted",
    });
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("authVerificationCodes", {
        accountId,
        provider: "anonymous",
        code: `code-${i}`,
        expirationTime: Date.now() + 60_000,
      });
    }
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId: guest,
      lemma: "kept",
      distance: 42,
      source: "guess",
      createdAt: 1,
    });
  });
  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  expect(await asUser(t, guest).query(api.users.getUser, {})).toBeNull();
  // Arrange a delivered obsolete job after cleanup has committed its claim.
  const mergeId = await t.run((ctx) =>
    ctx.db.insert("guestMerges", {
      guestUserId: guest,
      targetUserId: member,
      phase: "history",
      overlappingSolves: 0,
      streakRun: 0,
      streakBest: 0,
    }),
  );
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  await finishScheduledFunctions(t);
  expect(await asUser(t, member).query(api.games.listMyHistory, {})).toEqual(
    [],
  );
  expect(
    await asUser(t, member).query(api.guesses.listForGame, { gameId }),
  ).toMatchObject({
    sorted: [
      { lemma: "kept", userId: guest, player: { name: "Former Guest" } },
    ],
  });
  expect(
    await asUser(t, member).query(api.users.getUser, { userId: guest }),
  ).toMatchObject({
    name: "Former Guest",
    isAnonymous: false,
    username: null,
    image: null,
  });
  expect(
    await asUser(t, member).query(api.rooms.getByCode, { code }),
  ).toMatchObject({ isViewerHost: true, members: [{ userId: member }] });
  // Calling cleanup again must preserve the retained identity and Room.
  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  expect(
    await asUser(t, member).query(api.games.getActive, { roomId }),
  ).toMatchObject({ _id: gameId });
});
