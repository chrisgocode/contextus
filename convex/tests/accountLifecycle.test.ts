import type { GenericValidator } from "convex/values";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { USER_KEYED_TABLES } from "../lib/accountLifecycle";
import { startGuestMerge } from "../lib/guestMerge";
import schema from "../schema";
import { asUserWithSession, seedUser, setupTest } from "../testHelpers.test";

type SeedCtx = Pick<MutationCtx, "db">;
type Fixture = {
  owner: Id<"users">;
  roomId: Id<"rooms">;
  gameId: Id<"games">;
};

// One row per user reference, owned by `userId`. Keyed like the registry so a
// new policy without a seed fails the coverage test below.
const seeds: Record<
  string,
  (ctx: SeedCtx, userId: Id<"users">, fixture: Fixture) => Promise<unknown>
> = {
  "authAccounts.userId": async (ctx, userId) => {
    const accountId = await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: `${userId}@example.com`,
    });
    await ctx.db.insert("authVerificationCodes", {
      accountId,
      provider: "password",
      code: `code-${userId}`,
      expirationTime: Date.now() + 60_000,
    });
  },
  "authSessions.userId": async (ctx, userId) => {
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 60_000,
    });
    await ctx.db.insert("authRefreshTokens", {
      sessionId,
      expirationTime: Date.now() + 60_000,
    });
  },
  "guestMerges.guestUserId": (ctx, userId, { owner }) =>
    ctx.db.insert("guestMerges", {
      guestUserId: userId,
      targetUserId: owner,
      phase: "finalize",
      overlappingSolves: 0,
      streakRun: 0,
      streakBest: 0,
    }),
  "guestMerges.targetUserId": (ctx, userId, { owner }) =>
    ctx.db.insert("guestMerges", {
      guestUserId: owner,
      targetUserId: userId,
      phase: "finalize",
      overlappingSolves: 0,
      streakRun: 0,
      streakBest: 0,
    }),
  "rooms.hostUserId": (ctx, userId) =>
    ctx.db.insert("rooms", {
      code: `H${userId.slice(-5)}`,
      hostUserId: userId,
      status: "active",
    }),
  "roomMembers.userId": (ctx, userId, { roomId }) =>
    ctx.db.insert("roomMembers", { roomId, userId, joinedAt: 1 }),
  "games.winnerUserId": (ctx, userId, { roomId }) =>
    ctx.db.insert("games", {
      roomId,
      contextoGameId: 1,
      status: "won",
      winnerUserId: userId,
      startedAt: 1,
      endedAt: 2,
    }),
  "gameGuesses.userId": (ctx, userId, { gameId }) =>
    ctx.db.insert("gameGuesses", {
      gameId,
      userId,
      lemma: "word",
      distance: 10,
      source: "guess",
      createdAt: 1,
    }),
  "pendingRequests.requesterUserId": (ctx, userId, { roomId, gameId }) =>
    ctx.db.insert("pendingRequests", {
      roomId,
      gameId,
      requesterUserId: userId,
      type: "hint",
      status: "pending",
      createdAt: 1,
    }),
  "userGameHistory.userId": (ctx, userId, { gameId }) =>
    ctx.db.insert("userGameHistory", {
      userId,
      contextoGameId: 2,
      firstPlayedAt: 1,
      firstSolvedAt: 2,
      firstSolvedGameId: gameId,
    }),
  "userAchievements.userId": (ctx, userId) =>
    ctx.db.insert("userAchievements", {
      userId,
      achievementId: "first_solve",
      unlockedAt: 1,
    }),
  "userAchievementProgress.userId": (ctx, userId) =>
    ctx.db.insert("userAchievementProgress", {
      userId,
      achievementId: "streak_3",
      current: 1,
      target: 3,
      hidden: false,
      updatedAt: 1,
    }),
  "userAchievementStats.userId": (ctx, userId) =>
    ctx.db.insert("userAchievementStats", {
      userId,
      redGuesses: 1,
      yellowGuesses: 0,
      greenGuesses: 0,
      uniqueSolves: 1,
    }),
  "userSolveDays.userId": (ctx, userId) =>
    ctx.db.insert("userSolveDays", { userId, dayKey: "2026-03-01" }),
  "gamePlayerStats.userId": (ctx, userId, { gameId }) =>
    ctx.db.insert("gamePlayerStats", {
      gameId,
      userId,
      realGuessCount: 1,
      bestDistance: 10,
      lastDistance: 10,
      noBacktrackingSoFar: true,
      updatedAt: 1,
    }),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const policyKeys = USER_KEYED_TABLES.map((p) => `${p.table}.${p.field}`);

function userReferences(validator: GenericValidator, path: string): string[] {
  switch (validator.kind) {
    case "id":
      return validator.tableName === "users" ? [path] : [];
    case "object":
      return Object.entries(validator.fields).flatMap(([name, field]) =>
        userReferences(field, path === "" ? name : `${path}.${name}`),
      );
    case "union":
      return validator.members.flatMap((m) => userReferences(m, path));
    case "array":
      return userReferences(validator.element, path);
    case "record":
      return userReferences(validator.value, path);
    default:
      return [];
  }
}

test("every schema field referencing users has a lifecycle policy", () => {
  const schemaKeys = Object.entries(schema.tables).flatMap(([table, def]) =>
    userReferences(def.validator, "").map((field) => `${table}.${field}`),
  );
  expect([...policyKeys].sort()).toEqual(schemaKeys.sort());
  expect(Object.keys(seeds).sort()).toEqual([...policyKeys].sort());
});

async function seedFixture(t: ReturnType<typeof setupTest>) {
  const owner = await seedUser(t);
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      code: "FIXTUR",
      hostUserId: owner,
      status: "active",
    });
    const gameId = await ctx.db.insert("games", {
      roomId,
      contextoGameId: 1,
      status: "in_progress",
      startedAt: 1,
    });
    return { owner, roomId, gameId };
  });
}

async function seedEveryTable(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  fixture: Fixture,
  keys = policyKeys,
) {
  await t.run(async (ctx) => {
    for (const key of keys) await seeds[key](ctx, userId, fixture);
  });
}

// Scans whole tables rather than using the registry's lookups, so a policy
// that queries the wrong index still shows up as a leftover reference.
async function referenceCounts(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const { table, field } of USER_KEYED_TABLES) {
      const rows = await ctx.db.query(table).collect();
      counts[`${table}.${field}`] = rows.filter(
        (row) => new Map(Object.entries(row)).get(field) === userId,
      ).length;
    }
    return counts;
  });
}

function countsWhere(predicate: (key: string) => boolean, count: number) {
  return Object.fromEntries(
    policyKeys.filter(predicate).map((key) => [key, count]),
  );
}

test("guest merge moves every app row to the account and deletes the guest", async () => {
  const t = setupTest();
  const fixture = await seedFixture(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const target = await seedUser(t);
  // Rows that stay on the guest come from the sign-in itself; a seeded
  // guestMerges job would stop a new merge from starting.
  const movedKeys = USER_KEYED_TABLES.filter(
    (p) => p.merge !== "removeWithGuest",
  ).map((p) => `${p.table}.${p.field}`);
  await seedEveryTable(t, guest, fixture, movedKeys);
  const guestSession = await asUserWithSession(t, guest);

  await guestSession.run((ctx) => startGuestMerge(ctx, target));
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }

  expect(await referenceCounts(t, guest)).toEqual(countsWhere(() => true, 0));
  const targetCounts = await referenceCounts(t, target);
  for (const key of movedKeys) {
    expect(targetCounts[key], key).toBeGreaterThan(0);
  }
  expect(await t.run((ctx) => ctx.db.get("users", guest))).toBeNull();
});

test("guest expiry deletes private rows and keeps shared room history", async () => {
  const t = setupTest();
  const fixture = await seedFixture(t);
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  await seedEveryTable(t, guest, fixture);

  await t.mutation(internal.cleanup.removeExpiredGuests, { now: Date.now() });

  const kept = new Set(
    USER_KEYED_TABLES.filter((p) => p.expire === "keep").map(
      (p) => `${p.table}.${p.field}`,
    ),
  );
  expect(await referenceCounts(t, guest)).toEqual({
    ...countsWhere((key) => !kept.has(key), 0),
    ...countsWhere((key) => kept.has(key), 1),
  });
  expect(await t.run((ctx) => ctx.db.get("users", guest))).toMatchObject({
    name: "Former Guest",
    isAnonymous: false,
  });
});

test("E2E purge leaves no row referencing the account", async () => {
  vi.stubEnv("E2E_TEST", "1");
  const t = setupTest();
  const fixture = await seedFixture(t);
  const email = "contextus-e2e-local-w0-u0@example.com";
  const userId = await seedUser(t, { email });
  await seedEveryTable(t, userId, fixture);

  await t.mutation(api.e2eCleanup.purgeAccount, { email });

  expect(await referenceCounts(t, userId)).toEqual(countsWhere(() => true, 0));
  expect(await t.run((ctx) => ctx.db.get("users", userId))).toBeNull();
});
