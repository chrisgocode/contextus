import { ConvexError } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { asUser, seedUser, setupTest } from "../testHelpers.test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startedGame(t: ReturnType<typeof setupTest>) {
  const host = await seedUser(t, { name: "Host" });
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  return { host, gameId };
}

function stubFetch(respond: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => await respond()),
  );
}

const htmlError = () =>
  new Response("<html><body>502 Bad Gateway</body></html>", {
    status: 502,
    headers: { "content-type": "text/html" },
  });

const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const failures = {
  "a 5xx with an HTML body": htmlError,
  "a 5xx with a JSON error body": () =>
    new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  "a 404 with an HTML body": () =>
    new Response("<html>Not Found</html>", { status: 404 }),
  "a 200 with a non-JSON body": () => new Response("not json", { status: 200 }),
  "a network failure": () => {
    throw new TypeError("fetch failed");
  },
};

type Endpoint = {
  name: string;
  malformed: Record<string, unknown>;
  call: (
    t: ReturnType<typeof setupTest>,
    game: Awaited<ReturnType<typeof startedGame>>,
  ) => Promise<unknown>;
};

const endpoints: Endpoint[] = [
  {
    name: "guesses.submit",
    malformed: {
      "missing lemma": { distance: 10, word: "apple" },
      "string distance": { distance: "10", lemma: "apple", word: "apple" },
      "null body": null,
    },
    call: (t, { host, gameId }) =>
      asUser(t, host).action(api.guesses.submit, { gameId, word: "apple" }),
  },
  {
    name: "hints.hostHint",
    malformed: {
      "missing lemma": { distance: 299, word: "pomelo" },
      "missing distance": { lemma: "pomelo", word: "pomelo" },
      "array body": [],
    },
    call: (t, { host, gameId }) =>
      asUser(t, host).action(api.hints.hostHint, { gameId }),
  },
  {
    name: "giveup.hostGiveup",
    malformed: {
      "missing lemma": { distance: 0, word: "persimmon" },
      "numeric lemma": { distance: 0, lemma: 42, word: "persimmon" },
      "error body": { error: "nope" },
    },
    call: (t, { host, gameId }) =>
      asUser(t, host).action(api.giveup.hostGiveup, { gameId }),
  },
];

describe.each(endpoints)("$name", ({ malformed, call }) => {
  test.each(Object.entries(failures))(
    "throws ConvexError on %s",
    async (_label, respond) => {
      const t = setupTest();
      const game = await startedGame(t);
      stubFetch(respond);
      const error = await call(t, game).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<string>).data).toBe(
        "Contexto is unavailable, please try again",
      );
    },
  );

  test.each(Object.entries(malformed))(
    "throws ConvexError on a 200 with %s",
    async (_label, body) => {
      const t = setupTest();
      const game = await startedGame(t);
      stubFetch(json(body));
      await expect(call(t, game)).rejects.toThrow(
        "Contexto returned an unexpected response",
      );
    },
  );
});

// Contexto accepts the connection but never answers; only the abort signal
// ends the request.
function stubHungFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    ),
  );
}

test.each(endpoints)(
  "$name throws ConvexError when Contexto never answers",
  async ({ call }) => {
    const t = setupTest();
    const game = await startedGame(t);
    stubHungFetch();
    vi.useFakeTimers();
    try {
      const result = call(t, game).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      const error = await result;
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<string>).data).toBe(
        "Contexto is unavailable, please try again",
      );
    } finally {
      vi.useRealTimers();
    }
  },
);

test("give-up with a malformed answer payload leaves the Game in_progress", async () => {
  const t = setupTest();
  const game = await startedGame(t);
  stubFetch(json({ distance: 0, word: "persimmon" }));
  await expect(
    asUser(t, game.host).action(api.giveup.hostGiveup, {
      gameId: game.gameId,
    }),
  ).rejects.toThrow("Contexto returned an unexpected response");
  const row = await t.run(async (ctx) => ctx.db.get("games", game.gameId));
  expect(row?.status).toBe("in_progress");
  expect(row?.answerLemma).toBeUndefined();
});

test("unknown-word 404 from the guess endpoint is returned, not thrown", async () => {
  const t = setupTest();
  stubFetch(
    () =>
      new Response(
        JSON.stringify({ error: "I'm sorry, I don't know this word" }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
  );
  const { host, gameId } = await startedGame(t);
  await expect(
    asUser(t, host).action(api.guesses.submit, { gameId, word: "zzz" }),
  ).resolves.toEqual({
    message: "I'm sorry, I don't know this word",
    won: false,
    unlockedAchievementIds: [],
  });
});

// Payloads recorded from api.contexto.me for puzzle 1336.
test.each<{
  name: string;
  url: string;
  payload: unknown;
  call: Endpoint["call"];
  expected: object;
}>([
  {
    name: "guesses.submit",
    url: "https://api.contexto.me/machado/en/game/1336/dogs",
    payload: { distance: 36300, lemma: "dog", word: "dogs" },
    call: (t, { host, gameId }) =>
      asUser(t, host).action(api.guesses.submit, { gameId, word: " Dogs " }),
    expected: { lemma: "dog", distance: 36300, won: false },
  },
  {
    name: "hints.hostHint",
    url: "https://api.contexto.me/machado/en/tip/1336/299",
    payload: { distance: 299, lemma: "pomelo", word: "pomelo" },
    call: (t, { host, gameId }) =>
      asUser(t, host).action(api.hints.hostHint, { gameId }),
    expected: { lemma: "pomelo", distance: 299 },
  },
  {
    name: "giveup.hostGiveup",
    url: "https://api.contexto.me/machado/en/giveup/1336",
    payload: { distance: 0, lemma: "persimmon", word: "persimmon" },
    call: (t, { host, gameId }) =>
      asUser(t, host).action(api.giveup.hostGiveup, { gameId }),
    expected: { lemma: "persimmon" },
  },
])(
  "$name requests $url and parses the reply",
  async ({ url, payload, call, expected }) => {
    const t = setupTest();
    const game = await startedGame(t);
    const fetch = vi.fn(async () => json(payload)());
    vi.stubGlobal("fetch", fetch);

    await expect(call(t, game)).resolves.toMatchObject(expected);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, expect.anything());
  },
);

test("a guess is sent as one encoded path segment", async () => {
  const t = setupTest();
  const { host, gameId } = await startedGame(t);
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ error: "I'm sorry, I don't know this word" }),
        { status: 404 },
      ),
  );
  vi.stubGlobal("fetch", fetch);

  await asUser(t, host).action(api.guesses.submit, {
    gameId,
    word: "../giveup/1336",
  });

  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://api.contexto.me/machado/en/game/1336/..%2Fgiveup%2F1336",
    expect.anything(),
  );
});
