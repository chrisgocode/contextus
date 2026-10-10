import { expect, test, vi } from "vitest";
import { previewOriginFromState, signPreviewState } from "../lib/previewOAuth";
import { setupTest } from "../testHelpers.test";

const SECRET = "test-secret";
const ORIGIN = "https://happy-animal-123.convex.site";
const FORWARDER = "/api/preview-oauth/callback/google";

function base64Url(text: string) {
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

test("a signed state gives back its origin", async () => {
  const state = await signPreviewState(SECRET, ORIGIN);

  expect(await previewOriginFromState(SECRET, state)).toBe(ORIGIN);
});

test("a regional convex.site origin is accepted", async () => {
  const origin = "https://happy-animal-123.eu-west-1.convex.site";
  const state = await signPreviewState(SECRET, origin);

  expect(await previewOriginFromState(SECRET, state)).toBe(origin);
});

test("a state signed with another secret is rejected", async () => {
  const state = await signPreviewState("other-secret", ORIGIN);

  expect(await previewOriginFromState(SECRET, state)).toBeNull();
});

test("no state verifies without a secret", async () => {
  const state = await signPreviewState(SECRET, ORIGIN);

  expect(await previewOriginFromState(undefined, state)).toBeNull();
  expect(await previewOriginFromState("", state)).toBeNull();
});

test("a state with a swapped origin is rejected", async () => {
  const state = await signPreviewState(SECRET, ORIGIN);
  const signature = state.split(".")[1];
  const tampered = `${base64Url("https://other-animal-456.convex.site")}.${signature}`;

  expect(await previewOriginFromState(SECRET, tampered)).toBeNull();
});

test("a signed origin that is not a bare https convex.site origin is rejected", async () => {
  for (const origin of [
    "https://evil.example",
    "https://convex.site.evil.example",
    "https://evilconvex.site",
    "http://happy-animal-123.convex.site",
    "https://happy-animal-123.convex.site:8443",
    "https://happy-animal-123.convex.site/",
    "https://happy-animal-123.convex.site/api/auth",
    "https://happy-animal-123.convex.site?next=1",
    "https://user@happy-animal-123.convex.site",
    "not a url",
  ]) {
    const state = await signPreviewState(SECRET, origin);
    expect(await previewOriginFromState(SECRET, state), origin).toBeNull();
  }
});

test("a malformed state is rejected", async () => {
  const state = await signPreviewState(SECRET, ORIGIN);
  for (const malformed of [
    null,
    "",
    ".",
    "no-separator",
    state.split(".")[0],
    `${state}.extra`,
    "!!!.???",
    `${base64Url(ORIGIN)}.`,
  ]) {
    expect(
      await previewOriginFromState(SECRET, malformed),
      String(malformed),
    ).toBeNull();
  }
});

test("the forwarder sends Google's redirect on to the preview's callback", async () => {
  vi.stubEnv("PREVIEW_OAUTH_STATE_SECRET", SECRET);
  const t = setupTest();
  const state = await signPreviewState(SECRET, ORIGIN);
  const query = `?state=${state}&code=4%2F0Abc-def&scope=email%20profile+openid&authuser=0`;

  const response = await t.fetch(`${FORWARDER}${query}`);

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    `${ORIGIN}/api/auth/callback/google${query}`,
  );
});

test("the forwarder passes on Google's error responses", async () => {
  vi.stubEnv("PREVIEW_OAUTH_STATE_SECRET", SECRET);
  const t = setupTest();
  const state = await signPreviewState(SECRET, ORIGIN);
  const query = `?error=access_denied&state=${state}`;

  const response = await t.fetch(`${FORWARDER}${query}`);

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    `${ORIGIN}/api/auth/callback/google${query}`,
  );
});

test("the forwarder answers 400 to a state it can't verify", async () => {
  vi.stubEnv("PREVIEW_OAUTH_STATE_SECRET", SECRET);
  const t = setupTest();
  const forged = await signPreviewState("other-secret", ORIGIN);

  for (const query of ["", "?code=abc", `?code=abc&state=${forged}`]) {
    const response = await t.fetch(`${FORWARDER}${query}`);
    expect(response.status, query).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
  }
});

test("the forwarder answers 400 where the secret is not set", async () => {
  vi.stubEnv("PREVIEW_OAUTH_STATE_SECRET", undefined);
  const t = setupTest();
  const state = await signPreviewState(SECRET, ORIGIN);

  const response = await t.fetch(`${FORWARDER}?code=abc&state=${state}`);

  expect(response.status).toBe(400);
});
