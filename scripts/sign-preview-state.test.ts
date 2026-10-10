import { expect, test } from "vitest";
import { previewOriginFromState } from "../convex/lib/previewOAuth";
import { previewState } from "./sign-preview-state.mjs";

const SECRET = "test-secret";
const ORIGIN = "https://happy-animal-123.convex.site";

test("signs a state the forwarder accepts for that origin", async () => {
  const state = await previewState(SECRET, ORIGIN);

  expect(await previewOriginFromState(SECRET, state)).toBe(ORIGIN);
});

test("refuses to sign without the secret", async () => {
  await expect(previewState(undefined, ORIGIN)).rejects.toThrow(
    "PREVIEW_OAUTH_STATE_SECRET is not set",
  );
  await expect(previewState("", ORIGIN)).rejects.toThrow(
    "PREVIEW_OAUTH_STATE_SECRET is not set",
  );
});

test("refuses to sign without an origin", async () => {
  await expect(previewState(SECRET, undefined)).rejects.toThrow("Usage:");
});

test("refuses an origin the forwarder would reject", async () => {
  for (const origin of [
    "https://happy-animal-123.convex.cloud",
    "https://happy-animal-123.convex.site/",
    "http://happy-animal-123.convex.site",
  ]) {
    await expect(previewState(SECRET, origin)).rejects.toThrow(
      "Not a bare https://*.convex.site origin",
    );
  }
});
