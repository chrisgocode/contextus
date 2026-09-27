import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { asUser, seedUser, sessionOf, setupTest } from "../testHelpers.test";

// Convex Auth runs these callbacks inside its `auth:store` mutation, which
// is what the sign-in actions call.

test("a new Guest account is given a username", async () => {
  const t = setupTest();
  await t.mutation(internal.auth.store, {
    args: {
      type: "createAccountFromCredentials",
      provider: "anonymous",
      account: { id: "guest-account" },
      profile: { isAnonymous: true },
    },
  });

  const [user] = await t.run((ctx) => ctx.db.query("users").collect());
  expect(user.displayUsername).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
  expect(user.username).toBe(user.displayUsername?.toLowerCase());
});

test("signing in marks a registered user as not anonymous", async () => {
  const t = setupTest();
  const registered = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });

  for (const userId of [registered, guest]) {
    await t.mutation(internal.auth.store, {
      args: { type: "signIn", userId, generateTokens: false },
    });
  }

  const users = await t.run(async (ctx) => ({
    registered: await ctx.db.get("users", registered),
    guest: await ctx.db.get("users", guest),
  }));
  expect(users.registered?.isAnonymous).toBe(false);
  expect(users.guest?.isAnonymous).toBe(true);
});

// The Google callback's `auth:store` call. The verifier row holds the session
// that started the OAuth flow, which is the only trace of the Guest by then.
async function googleCallback(
  t: ReturnType<typeof setupTest>,
  sessionId: Id<"authSessions"> | undefined,
  providerAccountId = "google-account",
) {
  const signature = `signature-${providerAccountId}`;
  await t.run((ctx) =>
    ctx.db.insert("authVerifiers", { sessionId, signature }),
  );
  await t.mutation(internal.auth.store, {
    args: {
      type: "userOAuth",
      provider: "google",
      providerAccountId,
      profile: { name: "Google User", email: `${providerAccountId}@test.dev` },
      signature,
    },
  });
  const account = await t.run((ctx) =>
    ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "google").eq("providerAccountId", providerAccountId),
      )
      .unique(),
  );
  return account?.userId;
}

const merges = (t: ReturnType<typeof setupTest>) =>
  t.run((ctx) => ctx.db.query("guestMerges").collect());

test("a Guest signing in with Google merges into the Google account", async () => {
  const t = setupTest();
  const newGuest = await seedUser(t, { isAnonymous: true });
  const returningGuest = await seedUser(t, { isAnonymous: true });
  const existing = await seedUser(t);
  await t.run((ctx) =>
    ctx.db.insert("authAccounts", {
      userId: existing,
      provider: "google",
      providerAccountId: "existing",
    }),
  );

  const created = await googleCallback(t, sessionOf(t, newGuest), "new");
  await googleCallback(t, sessionOf(t, returningGuest), "existing");

  expect(await merges(t)).toEqual([
    expect.objectContaining({ guestUserId: newGuest, targetUserId: created }),
    expect.objectContaining({
      guestUserId: returningGuest,
      targetUserId: existing,
    }),
  ]);
});

test("Google sign-in merges only a live Guest session", async () => {
  const t = setupTest();
  const guestSession = async (
    change: (
      ctx: MutationCtx,
      userId: Id<"users">,
      sessionId: Id<"authSessions">,
    ) => Promise<void>,
  ) => {
    const guest = await seedUser(t, { isAnonymous: true });
    const sessionId = sessionOf(t, guest);
    await t.run((ctx) => change(ctx, guest, sessionId));
    return sessionId;
  };
  const registered = await seedUser(t);
  const sessions = {
    none: undefined,
    registered: sessionOf(t, registered),
    expired: await guestSession((ctx, _, sessionId) =>
      ctx.db.patch("authSessions", sessionId, { expirationTime: Date.now() }),
    ),
    deleted: await guestSession((ctx, _, sessionId) =>
      ctx.db.delete("authSessions", sessionId),
    ),
    cleanupStarted: await guestSession((ctx, userId) =>
      ctx.db.patch("users", userId, { guestCleanupStarted: true }),
    ),
  };

  for (const [name, sessionId] of Object.entries(sessions)) {
    await googleCallback(t, sessionId, name);
  }

  expect(await merges(t)).toEqual([]);
});

test("a Guest signing in to an existing account merges into it", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const cleanupStarted = await seedUser(t, { isAnonymous: true });
  await t.run((ctx) =>
    ctx.db.patch("users", cleanupStarted, { guestCleanupStarted: true }),
  );
  const target = await seedUser(t);

  for (const userId of [guest, cleanupStarted]) {
    await asUser(t, userId).mutation(internal.auth.store, {
      args: { type: "signIn", userId: target, generateTokens: false },
    });
  }

  expect(await merges(t)).toEqual([
    expect.objectContaining({ guestUserId: guest, targetUserId: target }),
  ]);
});
