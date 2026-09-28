/**
 * Prepares a throwaway Convex deployment (the anonymous local backend in CI)
 * for Playwright: enables E2E_TEST, gives Convex Auth a fresh signing key, and
 * points Google sign-in at the mock issuer when E2E_GOOGLE_ISSUER is set.
 *
 * Refuses to run unless the deployment is local: E2E_TEST enables password
 * sign-in and fake puzzle answers, and the new signing key signs everyone out.
 */

import { generateKeyPairSync } from "crypto";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { config } from "dotenv";
import { localConvexEnv } from "./local-convex-env.mjs";

// Same source as playwright.config.ts, so local runs pick up E2E_BASE_URL and
// E2E_GOOGLE_ISSUER. Variables already set, as in CI, win.
config({ path: ".env.local", quiet: true });

const childEnv = localConvexEnv(process.env);
const siteUrl = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const googleIssuer = process.env.E2E_GOOGLE_ISSUER;

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const jwks = JSON.stringify({
  keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }],
});

const envFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "e2e-env-")),
  ".env",
);
fs.writeFileSync(
  envFile,
  [
    "E2E_TEST=1",
    "POSTHOG_PROJECT_TOKEN=disabled",
    `SITE_URL=${siteUrl}`,
    `JWT_PRIVATE_KEY="${pem.trimEnd().replace(/\n/g, " ")}"`,
    `JWKS='${jwks}'`,
    // Points Google sign-in at `e2e/oidc-mock.mjs`, which accepts any client.
    ...(googleIssuer === undefined
      ? []
      : [
          `E2E_GOOGLE_ISSUER=${googleIssuer}`,
          "AUTH_GOOGLE_ID=e2e",
          "AUTH_GOOGLE_SECRET=e2e",
        ]),
  ].join("\n"),
);

const result = spawnSync(
  "npx",
  ["convex", "env", "set", "--force", "--from-file", envFile],
  { stdio: "inherit", env: childEnv },
);
fs.rmSync(path.dirname(envFile), { recursive: true });
process.exit(result.status ?? 1);
