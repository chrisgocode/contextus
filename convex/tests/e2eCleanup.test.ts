import { expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import { E2E_DEPLOYMENT_URL, seedUser, setupTest } from "../testHelpers.test";

test("E2E account cleanup accepts any per-test account index", async () => {
  vi.stubEnv("E2E_TEST", "1");
  vi.stubEnv("CONVEX_CLOUD_URL", E2E_DEPLOYMENT_URL);
  const t = setupTest();
  const email = "contextus-e2e-local-w3-u12@example.com";
  const userId = await seedUser(t, { email });

  await expect(
    t.mutation(internal.e2eCleanup.purgeAccount, {
      email,
      deploymentUrl: E2E_DEPLOYMENT_URL,
    }),
  ).resolves.toEqual({ deleted: true });

  expect(await t.run((ctx) => ctx.db.get("users", userId))).toBeNull();
});

test("E2E account cleanup rejects emails outside the E2E namespace", async () => {
  vi.stubEnv("E2E_TEST", "1");
  vi.stubEnv("CONVEX_CLOUD_URL", E2E_DEPLOYMENT_URL);
  const t = setupTest();

  for (const email of [
    "contextus-e2e-local-w0-u@example.com",
    "contextus-e2e-local-w0-ux@example.com",
    "contextus-e2e-local-w0-u0@example.org",
  ]) {
    await expect(
      t.mutation(internal.e2eCleanup.purgeAccount, {
        email,
        deploymentUrl: E2E_DEPLOYMENT_URL,
      }),
    ).rejects.toThrow("E2E cleanup is unavailable");
  }
});

test("E2E account cleanup refuses a backend other than the one under test", async () => {
  vi.stubEnv("E2E_TEST", "1");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://other-deployment-123.convex.cloud");
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
