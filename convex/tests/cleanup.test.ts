import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  IDLE_TIMEOUT_MS,
  openRoom,
  touchRoomActivity,
} from "../lib/roomMembership";
import type { Id } from "../_generated/dataModel";
import {
  E2E_DEPLOYMENT_URL,
  asUser,
  fakeWordOracle,
  finishScheduledFunctions,
  seedUser,
  setupTest,
} from "../testHelpers.test";

describe("cleanup.tick", () => {
  test("ends idle room when all members are offline (disconnected presence)", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t, { name: "Host" });
    const { roomId } = await asUser(t, hostUser).mutation(api.rooms.create, {});

    // Host comes online, then disconnects (presence record kept as offline).
    const beat = await asUser(t, hostUser).mutation(api.presence.heartbeat, {
      roomId,
      userId: hostUser,
      sessionId: "s1",
      interval: 10000,
    });
    if (beat === null) throw new Error("heartbeat returned null");
    await t.mutation(api.presence.disconnect, {
      sessionToken: beat.sessionToken,
    });

    await backdateRoomActivity(t, roomId);

    await t.action(internal.cleanup.tick, {});

    const status = await t.run(async (ctx) => {
      const room = await ctx.db.get("rooms", roomId);
      return room?.status;
    });
    expect(status).toBe("ended");
  });

  test("migrates host to an online member when the host is offline", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t, { name: "Host" });
    const member = await seedUser(t, { name: "Member" });
    const { roomId, code } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });

    // Only the member is online; the host never sent a heartbeat.
    await asUser(t, member).mutation(api.presence.heartbeat, {
      roomId,
      userId: member,
      sessionId: "s1",
      interval: 10000,
    });

    await t.action(internal.cleanup.tick, {});

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room?.hostUserId).toBe(member);
    expect(room?.status).not.toBe("ended");
  });

  test("ends every idle room when there are more active rooms than one read allows", async () => {
    const t = setupTest({ transactionLimits: { documentsRead: 200 } });
    const hostUser = await seedUser(t);
    const idleAt = Date.now() - IDLE_TIMEOUT_MS - 1000;
    for (let i = 0; i < 300; i++) {
      await t.run((ctx) =>
        openRoom(ctx, { code: `IDLE${i}`, hostUserId: hostUser }, idleAt),
      );
    }

    await t.action(internal.cleanup.tick, {});
    await finishScheduledFunctions(t);

    const active = await t.run(async (ctx) =>
      ctx.db
        .query("rooms")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .take(1),
    );
    expect(active).toEqual([]);
  });
});

async function backdateRoomActivity(
  t: ReturnType<typeof setupTest>,
  roomId: Id<"rooms">,
) {
  await t.run((ctx) =>
    touchRoomActivity(ctx, roomId, Date.now() - IDLE_TIMEOUT_MS - 1000),
  );
}

async function goOnline(
  t: ReturnType<typeof setupTest>,
  roomId: Id<"rooms">,
  userId: Id<"users">,
) {
  await asUser(t, userId).mutation(api.presence.heartbeat, {
    roomId,
    userId,
    sessionId: `s-${userId}`,
    interval: 10000,
  });
}

describe("cleanup._cleanupRoom", () => {
  test("keeps an idle room active when a member joins before cleanup runs", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t);
    const joiner = await seedUser(t);
    const { roomId, code } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );
    await backdateRoomActivity(t, roomId);

    await asUser(t, joiner).mutation(api.rooms.join, { code });
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const state = await t.run(async (ctx) => ({
      room: await ctx.db.get("rooms", roomId),
      members: await ctx.db
        .query("roomMembers")
        .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
        .collect(),
    }));
    expect(state.room?.status).toBe("active");
    expect(state.members.every((m) => m.active === true)).toBe(true);
  });

  test("keeps an idle room active when a guess lands before cleanup runs", async () => {
    const t = setupTest();
    fakeWordOracle({ guesses: { 1337: { close: 50 } } });
    const hostUser = await seedUser(t);
    const { roomId } = await asUser(t, hostUser).mutation(api.rooms.create, {});
    const { gameId } = await asUser(t, hostUser).mutation(api.games.start, {
      roomId,
      contextoGameId: 1337,
    });
    await backdateRoomActivity(t, roomId);

    await asUser(t, hostUser).action(api.guesses.submit, {
      gameId,
      word: "close",
    });
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room?.status).toBe("active");
  });

  test("ends a room that is still idle", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t);
    const { roomId } = await asUser(t, hostUser).mutation(api.rooms.create, {});
    await backdateRoomActivity(t, roomId);

    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room?.status).toBe("ended");
  });

  test("keeps the host when the host comes back online", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t);
    const member = await seedUser(t);
    const { roomId, code } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });
    await goOnline(t, roomId, member);

    await goOnline(t, roomId, hostUser);
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room?.hostUserId).toBe(hostUser);
  });

  test("keeps a room nobody is online in until the idle timeout", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t);
    const member = await seedUser(t);
    const { roomId, code } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });

    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room).toMatchObject({ status: "active", hostUserId: hostUser });
  });

  test("keeps a newer host assignment", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t);
    const member = await seedUser(t);
    const laterMember = await seedUser(t);
    const { roomId, code } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });
    await asUser(t, laterMember).mutation(api.rooms.join, { code });
    // Only the later member is online, so cleanup makes them Host.
    await goOnline(t, roomId, laterMember);
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    await goOnline(t, roomId, member);
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room?.hostUserId).toBe(laterMember);
  });

  test("never promotes a member who left", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t);
    const member = await seedUser(t);
    const { roomId, code } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });
    await goOnline(t, roomId, member);

    await asUser(t, member).mutation(api.rooms.leave, { roomId });
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room?.hostUserId).toBe(hostUser);
  });

  test("leaves an ended room untouched", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t);
    const member = await seedUser(t);
    const { roomId, code } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });
    await goOnline(t, roomId, member);

    await asUser(t, hostUser).mutation(api.rooms.endRoom, { roomId });
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
    expect(room).toMatchObject({ status: "ended", hostUserId: hostUser });
  });
});

test("room activity backfill inserts only missing activity rows", async () => {
  const t = setupTest();
  const hostUser = await seedUser(t);
  const { roomId } = await asUser(t, hostUser).mutation(api.rooms.create, {});
  await t.run(async (ctx) => {
    const activity = await ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique();
    if (activity === null) throw new Error("missing room activity");
    await ctx.db.delete("roomActivity", activity._id);
  });

  await expect(
    t.mutation(internal.cleanup._backfillRoomActivity, {}),
  ).resolves.toEqual({ inserted: 1, scanned: 1 });
  await expect(
    t.mutation(internal.cleanup._backfillRoomActivity, {}),
  ).resolves.toEqual({ inserted: 0, scanned: 1 });
});

test("expired guest stays eligible until all progress and auth rows are deleted", async () => {
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  await t.run(async (ctx) => {
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("userGameHistory", {
        userId: guest,
        contextoGameId: i,
        firstPlayedAt: i,
      });
    }
    const accountId = await ctx.db.insert("authAccounts", {
      userId: guest,
      provider: "password",
      providerAccountId: "guest",
    });
    for (let i = 0; i < 120; i++) {
      await ctx.db.insert("authVerificationCodes", {
        accountId,
        provider: "password",
        code: `test-${i}`,
        expirationTime: Date.now() + 60_000,
      });
    }
    const sessionId = await ctx.db.insert("authSessions", {
      userId: guest,
      expirationTime: Date.now() + 60_000,
    });
    await ctx.db.insert("authRefreshTokens", {
      sessionId,
      expirationTime: Date.now() + 60_000,
    });
  });

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  expect(await t.run(async (ctx) => ctx.db.get("users", guest))).toMatchObject({
    isAnonymous: true,
  });
  await finishScheduledFunctions(t);
  const remaining = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", guest),
    history: await ctx.db.query("userGameHistory").collect(),
    accounts: await ctx.db.query("authAccounts").collect(),
    codes: await ctx.db.query("authVerificationCodes").collect(),
    sessions: await ctx.db.query("authSessions").collect(),
    tokens: await ctx.db.query("authRefreshTokens").collect(),
  }));
  expect(remaining).toMatchObject({
    user: { name: "Former Guest", isAnonymous: false },
    history: [],
    accounts: [],
    codes: [],
    sessions: [],
    tokens: [],
  });
});

test("expired guests share a row budget and all eventually finish", async () => {
  const t = setupTest();
  const guests = await Promise.all([
    seedUser(t, { isAnonymous: true, guestExpiresAt: Date.now() - 1 }),
    seedUser(t, { isAnonymous: true, guestExpiresAt: Date.now() - 1 }),
  ]);
  await t.run(async (ctx) => {
    for (const guest of guests) {
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("userGameHistory", {
          userId: guest,
          contextoGameId: i,
          firstPlayedAt: i,
        });
      }
    }
  });

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  const first = await t.run(async (ctx) =>
    Promise.all(guests.map((guest) => ctx.db.get("users", guest))),
  );
  expect(first.some((guest) => guest?.isAnonymous)).toBe(true);
  await finishScheduledFunctions(t);
  const result = await t.run(async (ctx) => ({
    users: await Promise.all(guests.map((guest) => ctx.db.get("users", guest))),
    history: await ctx.db.query("userGameHistory").collect(),
  }));
  expect(result.users).toEqual([
    expect.objectContaining({ name: "Former Guest", isAnonymous: false }),
    expect.objectContaining({ name: "Former Guest", isAnonymous: false }),
  ]);
  expect(result.history).toEqual([]);
});

test("E2E purge rejects other emails and clears rate limits and hosted Games", async () => {
  vi.stubEnv("E2E_TEST", "1");
  vi.stubEnv("CONVEX_CLOUD_URL", E2E_DEPLOYMENT_URL);
  const t = setupTest();
  const email = "contextus-e2e-local-w0-u0@example.com";
  const userId = await seedUser(t, { email });
  const otherUserId = await seedUser(t, { email: "person@example.com" });
  await expect(
    t.mutation(internal.e2eCleanup.purgeAccount, {
      email: "person@example.com",
      deploymentUrl: E2E_DEPLOYMENT_URL,
    }),
  ).rejects.toThrow("E2E cleanup is unavailable");
  const { roomId } = await asUser(t, userId).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, userId).mutation(api.games.start, {
    roomId,
    contextoGameId: 1337,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("authRateLimits", {
      identifier: email,
      lastAttemptTime: Date.now(),
      attemptsLeft: 5,
    });
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId,
      lemma: "test",
      distance: 10,
      source: "guess",
      createdAt: Date.now(),
    });
  });

  await t.mutation(internal.e2eCleanup.purgeAccount, {
    email,
    deploymentUrl: E2E_DEPLOYMENT_URL,
  });

  const remaining = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", userId),
    otherUser: await ctx.db.get("users", otherUserId),
    room: await ctx.db.get("rooms", roomId),
    game: await ctx.db.get("games", gameId),
    guesses: await ctx.db.query("gameGuesses").collect(),
    authRateLimits: await ctx.db.query("authRateLimits").collect(),
  }));
  expect(remaining).toMatchObject({
    user: null,
    room: null,
    game: null,
    guesses: [],
    authRateLimits: [],
  });
  expect(remaining.otherUser).not.toBeNull();
});

test("E2E purge refuses an e2e email when E2E_TEST is off", async () => {
  vi.stubEnv("E2E_TEST", undefined);
  const t = setupTest();
  const email = "contextus-e2e-local-w0-u0@example.com";
  const userId = await seedUser(t, { email });

  await expect(
    t.mutation(internal.e2eCleanup.purgeAccount, {
      email,
      deploymentUrl: E2E_DEPLOYMENT_URL,
    }),
  ).rejects.toThrow("E2E cleanup is unavailable");
  expect(await t.run((ctx) => ctx.db.get("users", userId))).not.toBeNull();
});

describe("E2E guest expiry", () => {
  test("is unavailable outside E2E runs", async () => {
    vi.stubEnv("E2E_TEST", undefined);
    const t = setupTest();
    const guest = await seedUser(t, { isAnonymous: true });
    await expect(
      asUser(t, guest).mutation(api.e2eCleanup.expireCurrentGuest, {}),
    ).rejects.toThrow("E2E cleanup is unavailable");
  });

  test("only expires anonymous callers", async () => {
    vi.stubEnv("E2E_TEST", "1");
    vi.stubEnv("CONVEX_CLOUD_URL", E2E_DEPLOYMENT_URL);
    const t = setupTest();
    const user = await seedUser(t);
    await expect(
      t.mutation(api.e2eCleanup.expireCurrentGuest, {}),
    ).rejects.toThrow("Not authenticated");
    await expect(
      asUser(t, user).mutation(api.e2eCleanup.expireCurrentGuest, {}),
    ).rejects.toThrow("E2E cleanup is unavailable");
    expect(await t.run(async (ctx) => ctx.db.get("users", user))).toMatchObject(
      { name: "Test User" },
    );
  });

  test("expires the caller past one cleanup budget and leaves other guests", async () => {
    vi.stubEnv("E2E_TEST", "1");
    vi.stubEnv("CONVEX_CLOUD_URL", E2E_DEPLOYMENT_URL);
    const t = setupTest();
    const guest = await seedUser(t, { isAnonymous: true });
    const other = await seedUser(t, { isAnonymous: true });
    await t.run(async (ctx) => {
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("userGameHistory", {
          userId: guest,
          contextoGameId: i,
          firstPlayedAt: i,
        });
      }
    });

    await asUser(t, guest).mutation(api.e2eCleanup.expireCurrentGuest, {});

    const result = await t.run(async (ctx) => ({
      guest: await ctx.db.get("users", guest),
      other: await ctx.db.get("users", other),
      history: await ctx.db.query("userGameHistory").collect(),
    }));
    expect(result.guest).toMatchObject({
      name: "Former Guest",
      isAnonymous: false,
    });
    expect(result.other).toMatchObject({ isAnonymous: true });
    expect(result.history).toEqual([]);
    await expect(
      asUser(t, guest).mutation(api.rooms.create, {}),
    ).rejects.toThrow("Not authenticated");
    await expect(
      asUser(t, other).mutation(api.rooms.create, {}),
    ).resolves.toMatchObject({ code: expect.any(String) });
  });
});

test("cleanup withdraws the new Host's pending requests when it moves the Host", async () => {
  const t = setupTest();
  const hostUser = await seedUser(t, { name: "Host" });
  const member = await seedUser(t, { name: "Member" });
  const { roomId, code } = await asUser(t, hostUser).mutation(
    api.rooms.create,
    {},
  );
  await asUser(t, member).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, hostUser).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await asUser(t, member).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  await asUser(t, member).mutation(api.presence.heartbeat, {
    roomId,
    userId: member,
    sessionId: "s1",
    interval: 10000,
  });

  await t.action(internal.cleanup.tick, {});

  const room = await t.run(async (ctx) => ctx.db.get("rooms", roomId));
  expect(room?.hostUserId).toBe(member);
  expect(
    await asUser(t, member).query(api.requests.listPending, { gameId }),
  ).toEqual([]);
});
