import { afterEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { posthog } from "../posthog";
import {
  asUser,
  fakeWordOracle,
  seedUser,
  setupTest,
} from "../testHelpers.test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function game() {
  const t = setupTest();
  const host = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  return { t, host, gameId, capture };
}

test("turn and oracle metrics distinguish cache hits, duplicates, and unknown words", async () => {
  fakeWordOracle({ guesses: { 1336: { orange: 42 } } });
  const { t, host, gameId, capture } = await game();

  await asUser(t, host).action(api.guesses.submit, { gameId, word: "orange" });
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "orange" });
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "zzz" });

  const events = capture.mock.calls.map(([, event]) => event);
  expect(
    events.filter((event) => event.event === "contexto_request"),
  ).toMatchObject([
    { properties: { endpoint: "distance", outcome: "ok", cache: "miss" } },
    { properties: { endpoint: "distance", outcome: "ok", cache: "hit" } },
    {
      properties: {
        endpoint: "distance",
        outcome: "unknown_word",
        cache: "miss",
      },
    },
  ]);
  expect(
    events.filter((event) => event.event === "turn_completed"),
  ).toMatchObject([
    { properties: { kind: "guess", outcome: "recorded" } },
    { properties: { kind: "guess", outcome: "duplicate" } },
    { properties: { kind: "guess", outcome: "unknown_word" } },
  ]);
  for (const event of events.filter((event) =>
    ["contexto_request", "turn_completed"].includes(event.event),
  )) {
    expect(event.properties?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event.distinctId).toBe(host);
  }
});

test.each([
  {
    respond: () => Promise.reject(new TypeError("private network detail")),
    outcome: "unavailable",
    category: "contexto_unavailable",
  },
  {
    respond: () =>
      Promise.resolve(
        new Response("<html>bad gateway</html>", { status: 502 }),
      ),
    outcome: "unavailable",
    category: "contexto_unavailable",
  },
  {
    respond: () =>
      Promise.resolve(
        new Response(JSON.stringify({ lemma: 42 }), { status: 200 }),
      ),
    outcome: "unexpected_payload",
    category: "contexto_unexpected_payload",
  },
])(
  "a failed oracle request reports $outcome without the raw error",
  async ({ respond, outcome, category }) => {
    const oracle = fakeWordOracle({});
    const { t, host, gameId, capture } = await game();
    oracle.distance.mockRestore();
    vi.stubGlobal("fetch", vi.fn(respond));
    await expect(
      asUser(t, host).action(api.guesses.submit, { gameId, word: "orange" }),
    ).rejects.toThrow();
    const events = capture.mock.calls.map(([, event]) => event);
    expect(
      events.filter((event) => event.event === "contexto_request"),
    ).toMatchObject([{ properties: { outcome } }]);
    expect(
      events.filter((event) => event.event === "turn_failed"),
    ).toMatchObject([
      {
        properties: {
          kind: "guess",
          outcome: "failed",
          error_category: category,
        },
      },
    ]);
  },
);

test("a walked hint reports tips tried", async () => {
  fakeWordOracle({
    guesses: { 1336: { close: 1, second: 2 } },
    tips: { 1336: { 2: "second", 3: "third" } },
  });
  const { t, host, gameId, capture } = await game();
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "close" });
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "second" });
  await asUser(t, host).action(api.hints.hostHint, { gameId });
  expect(
    capture.mock.calls
      .map(([, event]) => event)
      .findLast((event) => event.event === "turn_completed"),
  ).toMatchObject({
    properties: { kind: "hint", outcome: "recorded", tips_tried: 2 },
  });
});
