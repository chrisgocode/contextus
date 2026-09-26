import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { IDLE_TIMEOUT_MS, decideRoomCleanup } from "../lib/cleanup";
import type { Id } from "../_generated/dataModel";
import {
  asUser,
  fakeWordOracle,
  seedUser,
  setupTest,
} from "../testHelpers.test";

const host = "u_host" as unknown as Id<"users">;
const other = "u_other" as unknown as Id<"users">;
const newer = "u_newer" as unknown as Id<"users">;

describe("decideRoomCleanup", () => {
  test("no-op when host online", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: Date.now() },
      members: [
        { userId: host, joinedAt: 1 },
        { userId: other, joinedAt: 2 },
      ],
      onlineUserIds: new Set([host, other]),
      now: Date.now(),
    });
    expect(r.kind).toBe("noop");
  });

  test("migrates host to oldest-joined online member", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: Date.now() },
      members: [
        { userId: host, joinedAt: 1 },
        { userId: other, joinedAt: 2 },
        { userId: newer, joinedAt: 3 },
      ],
      onlineUserIds: new Set([other, newer]),
      now: Date.now(),
    });
    expect(r).toEqual({ kind: "migrateHost", newHostUserId: other });
  });

  test("ends room when no online + idle past timeout", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: 0 },
      members: [{ userId: host, joinedAt: 1 }],
      onlineUserIds: new Set(),
      now: IDLE_TIMEOUT_MS + 1,
    });
    expect(r.kind).toBe("endRoom");
  });

  test("no-op when no online but not yet idle", () => {
    const now = Date.now();
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: now - 1000 },
      members: [{ userId: host, joinedAt: 1 }],
      onlineUserIds: new Set(),
      now,
    });
    expect(r.kind).toBe("noop");
  });

  test("no-op when host happens to be only online member", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: Date.now() },
      members: [
        { userId: host, joinedAt: 1 },
        { userId: other, joinedAt: 2 },
      ],
      onlineUserIds: new Set([host]),
      now: Date.now(),
    });
    expect(r.kind).toBe("noop");
  });
});

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

    // Force the room past the idle timeout.
    await t.run(async (ctx) => {
      const activity = await ctx.db
        .query("roomActivity")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .unique();
      if (activity === null) throw new Error("missing roomActivity");
      await ctx.db.patch("roomActivity", activity._id, {
        lastActivityAt: Date.now() - IDLE_TIMEOUT_MS - 1000,
      });
    });

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
});

async function backdateRoomActivity(
  t: ReturnType<typeof setupTest>,
  roomId: Id<"rooms">,
) {
  await t.run(async (ctx) => {
    const activity = await ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique();
    if (activity === null) throw new Error("missing roomActivity");
    await ctx.db.patch("roomActivity", activity._id, {
      lastActivityAt: Date.now() - IDLE_TIMEOUT_MS - 1000,
    });
  });
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
    await goOnline(t, roomId, member);
    await goOnline(t, roomId, laterMember);

    await t.run(async (ctx) =>
      ctx.db.patch("rooms", roomId, { hostUserId: laterMember }),
    );
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

test("merged guest cleanup ignores missing and registered users", async () => {
  const t = setupTest();
  const registered = await seedUser(t, { isAnonymous: false });
  const missing = await seedUser(t, { isAnonymous: true });
  await t.run(async (ctx) => ctx.db.delete("users", missing));

  await expect(
    t.mutation(internal.cleanup.removeMergedGuest, {
      guestUserId: registered,
    }),
  ).resolves.toBeNull();
  await expect(
    t.mutation(internal.cleanup.removeMergedGuest, { guestUserId: missing }),
  ).resolves.toBeNull();
  await expect(
    t.run(async (ctx) => ctx.db.get("users", registered)),
  ).resolves.not.toBeNull();
});

test("expired guest cleanup removes private progress and keeps anonymized guesses", async () => {
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    username: "temporaryguest",
    displayUsername: "TemporaryGuest",
    guestExpiresAt: Date.now() - 1,
  });
  const host = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId: guest,
      lemma: "kept",
      distance: 100,
      source: "guess",
      createdAt: 1,
    });
    await ctx.db.insert("userGameHistory", {
      userId: guest,
      contextoGameId: 1336,
      firstPlayedAt: 1,
    });
    await ctx.db.insert("userAchievements", {
      userId: guest,
      achievementId: "first_solve",
      unlockedAt: 1,
    });
    await ctx.db.insert("userAchievementProgress", {
      userId: guest,
      achievementId: "streak_3",
      current: 1,
      target: 3,
      hidden: false,
      updatedAt: 1,
    });
    await ctx.db.insert("userSolveDays", {
      userId: guest,
      dayKey: "2026-03-01",
    });
    await ctx.db.insert("userAchievementStats", {
      userId: guest,
      redGuesses: 1,
      yellowGuesses: 0,
      greenGuesses: 0,
      uniqueSolves: 0,
    });
  });

  await t.mutation(internal.cleanup.removeExpiredGuests, { now: Date.now() });

  const result = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", guest),
    history: await ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) => q.eq("userId", guest))
      .collect(),
    achievements: await ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) => q.eq("userId", guest))
      .collect(),
    progress: await ctx.db
      .query("userAchievementProgress")
      .withIndex("by_user_achievement", (q) => q.eq("userId", guest))
      .collect(),
    solveDays: await ctx.db
      .query("userSolveDays")
      .withIndex("by_user_and_dayKey", (q) => q.eq("userId", guest))
      .collect(),
    achievementStats: await ctx.db
      .query("userAchievementStats")
      .withIndex("by_user", (q) => q.eq("userId", guest))
      .unique(),
    guesses: await ctx.db
      .query("gameGuesses")
      .withIndex("by_user", (q) => q.eq("userId", guest))
      .collect(),
  }));
  expect(result.user).toMatchObject({
    name: "Former Guest",
    isAnonymous: false,
  });
  expect(result.user?.username).toBeUndefined();
  expect(result.history).toEqual([]);
  expect(result.achievements).toEqual([]);
  expect(result.progress).toEqual([]);
  expect(result.solveDays).toEqual([]);
  expect(result.achievementStats).toBeNull();
  expect(result.guesses).toHaveLength(1);
});

test("E2E account cleanup removes its complete data graph", async () => {
  vi.stubEnv("E2E_TEST", "1");
  const t = setupTest();
  const email = "contextus-e2e-local-w0-u0@example.com";
  const userId = await seedUser(t, { email });
  const otherUserId = await seedUser(t, { email: "person@example.com" });
  await expect(
    t.mutation(api.e2eCleanup.purgeAccount, { email: "person@example.com" }),
  ).rejects.toThrow("E2E cleanup is unavailable");
  const { roomId } = await asUser(t, userId).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, userId).mutation(api.games.start, {
    roomId,
    contextoGameId: 1337,
  });
  await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: email,
    });
    await ctx.db.insert("authVerificationCodes", {
      accountId,
      provider: "password",
      code: "test",
      expirationTime: Date.now() + 60_000,
    });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 60_000,
    });
    await ctx.db.insert("authRefreshTokens", {
      sessionId,
      expirationTime: Date.now() + 60_000,
    });
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
    await ctx.db.insert("userGameHistory", {
      userId,
      contextoGameId: 1337,
      firstPlayedAt: Date.now(),
    });
    await ctx.db.insert("userAchievementStats", {
      userId,
      redGuesses: 1,
      yellowGuesses: 0,
      greenGuesses: 0,
      uniqueSolves: 0,
    });
  });

  await t.mutation(api.e2eCleanup.purgeAccount, { email });

  const remaining = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", userId),
    otherUser: await ctx.db.get("users", otherUserId),
    room: await ctx.db.get("rooms", roomId),
    game: await ctx.db.get("games", gameId),
    authAccounts: await ctx.db.query("authAccounts").collect(),
    authSessions: await ctx.db.query("authSessions").collect(),
    authVerificationCodes: await ctx.db
      .query("authVerificationCodes")
      .collect(),
    authRefreshTokens: await ctx.db.query("authRefreshTokens").collect(),
    authRateLimits: await ctx.db.query("authRateLimits").collect(),
    guesses: await ctx.db.query("gameGuesses").collect(),
    history: await ctx.db.query("userGameHistory").collect(),
    achievementStats: await ctx.db.query("userAchievementStats").collect(),
  }));
  expect(remaining).toMatchObject({
    user: null,
    room: null,
    game: null,
    authAccounts: [],
    authSessions: [],
    authVerificationCodes: [],
    authRefreshTokens: [],
    authRateLimits: [],
    guesses: [],
    history: [],
    achievementStats: [],
  });
  expect(remaining.otherUser).not.toBeNull();
});
