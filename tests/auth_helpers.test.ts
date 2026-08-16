import { expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { requireRegisteredUser, requireUser } from "../convex/access";
import { asUser, seedUser, setupTest } from "./helpers";

test("requireUser throws when unauthenticated", async () => {
  const t = setupTest();
  await expect(
    t.run(async (ctx) => await requireUser(ctx)),
  ).rejects.toThrow();
});

test("requireUser returns userId when authenticated", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const result = await asUser(t, userId).run(
    async (ctx) => await requireUser(ctx),
  );
  expect(result).toBe(userId);
});

test("ConvexError is thrown for unauthenticated", async () => {
  const t = setupTest();
  await expect(
    t.run(async (ctx) => await requireUser(ctx)),
  ).rejects.toBeInstanceOf(ConvexError);
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
