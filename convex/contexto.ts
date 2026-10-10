import { appError } from "./lib/errors";
import type { WordOracle } from "./wordOracle";

const BASE = "https://api.contexto.me/machado/en";
// A hung Contexto would otherwise hold the Game turn until the action times out.
const TIMEOUT_MS = 8_000;

// Contexto's JSON is untrusted, so every field is checked before use.
type ContextoBody = {
  lemma?: unknown;
  distance?: unknown;
  error?: unknown;
} | null;

// Fetches and parses a Contexto endpoint. Transport failures, timeouts, 5xx
// responses and non-JSON bodies throw a user-facing ConvexError. 4xx
// responses are returned so callers can surface Contexto's `{ error }` body.
async function request(
  url: string,
): Promise<{ ok: boolean; status: number; body: ContextoBody }> {
  let res: Response;
  let body: ContextoBody;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    res = await fetch(url, { signal: controller.signal });
    body = (await res.json()) as ContextoBody;
  } catch {
    throw appError("contextoUnavailable");
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) throw appError("contextoUnavailable");
  return { ok: res.ok, status: res.status, body };
}

function parseScoredLemma(body: ContextoBody): {
  lemma: string;
  distance: number;
} {
  if (typeof body?.lemma !== "string" || typeof body.distance !== "number") {
    throw appError("contextoUnexpectedPayload");
  }
  return { lemma: body.lemma, distance: body.distance };
}

// Contexto adapter for the word oracle. Plain functions, not actions: they
// run inside whichever action performs the Game turn.
export const contextoOracle: WordOracle = {
  async distance(contextoGameId, word) {
    const url = `${BASE}/game/${contextoGameId}/${encodeURIComponent(word)}`;
    const { ok, status, body } = await request(url);
    // Contexto answers unknown words with a 404 and an `{ error }` body. Other
    // errors, like a 429, may clear up, so they must not be cached as unknown.
    if (status === 404 && typeof body?.error === "string")
      return { ok: false, error: body.error };
    if (!ok) throw appError("contextoUnavailable");
    return { ok: true, ...parseScoredLemma(body) };
  },

  async tip(contextoGameId, distance) {
    const url = `${BASE}/tip/${contextoGameId}/${distance}`;
    const { ok, body } = await request(url);
    if (!ok) throw appError("contextoUnavailable");
    return parseScoredLemma(body);
  },

  async answer(contextoGameId) {
    const url = `${BASE}/giveup/${contextoGameId}`;
    const { ok, body } = await request(url);
    if (!ok) throw appError("contextoUnavailable");
    if (typeof body?.lemma !== "string") {
      throw appError("contextoUnexpectedPayload");
    }
    return { lemma: body.lemma };
  },
};
