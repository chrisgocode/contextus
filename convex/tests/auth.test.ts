import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import { seedUser, setupTest } from "../testHelpers.test";

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
