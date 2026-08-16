import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { IDLE_TIMEOUT_MS, decideRoomCleanup } from "../convex/lib/cleanup";
import type { Id } from "../convex/_generated/dataModel";
import { asUser, seedUser, setupTest } from "./helpers";

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
      await ctx.db.patch(activity._id, {
        lastActivityAt: Date.now() - IDLE_TIMEOUT_MS - 1000,
      });
    });

    await t.action(internal.cleanup.tick, {});

    const status = await t.run(async (ctx) => {
      const room = await ctx.db.get(roomId);
      return room?.status;
    });
    expect(status).toBe("ended");
  });
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
  });

  await t.mutation(internal.cleanup.removeExpiredGuests, { now: Date.now() });

  const result = await t.run(async (ctx) => ({
    user: await ctx.db.get(guest),
    history: await ctx.db
      .query("userGameHistory")
      .withIndex("by_user", (q) => q.eq("userId", guest))
      .collect(),
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
  });

  await t.mutation(api.e2eCleanup.purgeAccount, { email });

  const remaining = await t.run(async (ctx) => ({
    user: await ctx.db.get(userId),
    otherUser: await ctx.db.get(otherUserId),
    room: await ctx.db.get(roomId),
    game: await ctx.db.get(gameId),
    authAccounts: await ctx.db.query("authAccounts").collect(),
    authSessions: await ctx.db.query("authSessions").collect(),
    guesses: await ctx.db.query("gameGuesses").collect(),
    history: await ctx.db.query("userGameHistory").collect(),
  }));
  expect(remaining).toMatchObject({
    user: null,
    room: null,
    game: null,
    authAccounts: [],
    authSessions: [],
    guesses: [],
    history: [],
  });
  expect(remaining.otherUser).not.toBeNull();
});
