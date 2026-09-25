/**
 * Prepares a throwaway Convex deployment (the anonymous local backend in CI)
 * for Playwright: enables E2E_TEST and gives Convex Auth a fresh signing key.
 *
 * Never run this against production: E2E_TEST enables password sign-in.
 */

import { generateKeyPairSync } from "crypto";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const siteUrl = process.env.E2E_BASE_URL ?? "http://localhost:3100";

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
    `SITE_URL=${siteUrl}`,
    `JWT_PRIVATE_KEY="${pem.trimEnd().replace(/\n/g, " ")}"`,
    `JWKS='${jwks}'`,
  ].join("\n"),
);

const result = spawnSync(
  "npx",
  ["convex", "env", "set", "--force", "--from-file", envFile],
  { stdio: "inherit" },
);
fs.rmSync(path.dirname(envFile), { recursive: true });
process.exit(result.status ?? 1);
