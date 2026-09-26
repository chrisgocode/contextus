import { expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import { requireRegisteredUser, requireUser } from "../access";
import {
  asUser,
  asUserWithSession,
  seedUser,
  setupTest,
} from "../testHelpers.test";

test("requireUser throws ConvexError when unauthenticated", async () => {
  const t = setupTest();
  await expect(
    t.run(async (ctx) => await requireUser(ctx)),
  ).rejects.toBeInstanceOf(ConvexError);
});

test("requireUser returns userId when authenticated", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const result = await asUser(t, userId).run(
    async (ctx) => await requireUser(ctx),
  );
  expect(result).toBe(userId);
});

test("requireRegisteredUser rejects anonymous users", async () => {
  const t = setupTest();
  const userId = await seedUser(t, { isAnonymous: true });

  await expect(
    asUser(t, userId).run(async (ctx) => await requireRegisteredUser(ctx)),
  ).rejects.toThrow("Registered account required");
});

test("requireRegisteredUser returns registered userId", async () => {
  const t = setupTest();
  const userId = await seedUser(t, { isAnonymous: false });

  const result = await asUser(t, userId).run(
    async (ctx) => await requireRegisteredUser(ctx),
  );

  expect(result).toBe(userId);
});

async function seedExpiredGuestWithAuthRows(
  t: ReturnType<typeof setupTest>,
  verificationCodes: number,
) {
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestExpiresAt: Date.now() - 1,
  });
  const guestSession = await asUserWithSession(t, guest);
  await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("authAccounts", {
      userId: guest,
      provider: "anonymous",
      providerAccountId: guest,
    });
    for (let i = 0; i < verificationCodes; i++) {
      await ctx.db.insert("authVerificationCodes", {
        accountId,
        provider: "anonymous",
        code: `test-${i}`,
        expirationTime: Date.now() + 60_000,
      });
    }
  });
  return { guest, guestSession };
}

async function finishScheduled(t: ReturnType<typeof setupTest>) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

test("requireUser rejects a token whose session was deleted", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const session = await asUserWithSession(t, userId);
  await t.run(async (ctx) => {
    for (const s of await ctx.db.query("authSessions").collect()) {
      await ctx.db.delete("authSessions", s._id);
    }
  });

  await expect(
    session.run(async (ctx) => await requireUser(ctx)),
  ).rejects.toThrow("Not authenticated");
});

test("requireUser rejects a token whose session belongs to another user", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const other = await seedUser(t);
  const otherSessionId = await t.run(async (ctx) =>
    ctx.db.insert("authSessions", {
      userId: other,
      expirationTime: Date.now() + 60_000,
    }),
  );

  await expect(
    t
      .withIdentity({ subject: `${userId}|${otherSessionId}`, issuer: "test" })
      .run(async (ctx) => await requireUser(ctx)),
  ).rejects.toThrow("Not authenticated");
});

test("guest token cannot write once expiry cleanup has started", async () => {
  const t = setupTest();
  const { guest, guestSession } = await seedExpiredGuestWithAuthRows(t, 120);

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  const midCleanup = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", guest),
    sessions: await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", guest))
      .collect(),
  }));
  expect(midCleanup.user).toMatchObject({
    isAnonymous: true,
    guestCleanupStarted: true,
  });
  expect(midCleanup.sessions).not.toEqual([]);

  await expect(guestSession.mutation(api.rooms.create, {})).rejects.toThrow(
    "Not authenticated",
  );
  await expect(
    guestSession.mutation(api.users.setTimeZone, { timeZone: "UTC" }),
  ).rejects.toThrow("Not authenticated");

  await finishScheduled(t);
  const after = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", guest),
    rooms: await ctx.db.query("rooms").collect(),
  }));
  expect(after.user).toMatchObject({
    name: "Former Guest",
    isAnonymous: false,
  });
  expect(after.rooms).toEqual([]);
});

test("old guest token cannot act as the Former Guest after cleanup", async () => {
  const t = setupTest();
  const { guest, guestSession } = await seedExpiredGuestWithAuthRows(t, 0);

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  await finishScheduled(t);
  expect(await t.run(async (ctx) => ctx.db.get("users", guest))).toMatchObject({
    name: "Former Guest",
    isAnonymous: false,
  });

  await expect(
    guestSession.mutation(api.users.updateProfile, {
      name: "Revived",
      username: "revived",
    }),
  ).rejects.toThrow("Not authenticated");
  await expect(guestSession.mutation(api.rooms.create, {})).rejects.toThrow(
    "Not authenticated",
  );
  await expect(
    guestSession.query(api.users.getByUsername, { username: "nobody" }),
  ).resolves.toBeNull();
  const user = await t.run(async (ctx) => ctx.db.get("users", guest));
  expect(user?.name).toBe("Former Guest");
  expect(user?.username).toBeUndefined();
});
