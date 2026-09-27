import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const googleIssuer = process.env.E2E_GOOGLE_ISSUER;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global.ts",
  fullyParallel: true,
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  // Retries capture a trace of the failure; a test that passes only on retry
  // still fails CI instead of hiding the flake.
  retries: process.env.CI ? 2 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: devices["Desktop Chrome"] },
    // The core game flow again on a phone, where the room's sidebar, guess
    // input and request bar stack. Only these specs, so the suite doesn't
    // run twice.
    {
      name: "mobile",
      use: devices["Pixel 7"],
      testMatch: /\/(game|win|hostTransfer|appearance)\.\w+\.spec\.ts$/,
    },
  ],
  webServer: [
    {
      // CI builds first and serves production output; `next dev` compiles
      // routes on demand, which is slow and flaky on CI runners.
      command: process.env.CI ? "bun run start:e2e" : "bun run dev:e2e",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // Stands in for Google; the Google sign-in spec skips without it.
    ...(googleIssuer === undefined
      ? []
      : [
          {
            command: "node e2e/oidc-mock.mjs",
            url: `${googleIssuer}/.well-known/openid-configuration`,
            reuseExistingServer: !process.env.CI,
          },
        ]),
  ],
});
