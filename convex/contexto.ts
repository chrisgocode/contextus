import { ConvexError } from "convex/values";
import type { WordOracle } from "./wordOracle";

const BASE = "https://api.contexto.me/machado/en";
export const UNAVAILABLE_MESSAGE = "Contexto is unavailable, please try again";
export const UNEXPECTED_PAYLOAD_MESSAGE =
  "Contexto returned an unexpected response";

// Contexto's JSON is untrusted, so every field is checked before use.
type ContextoBody = {
  lemma?: unknown;
  distance?: unknown;
  error?: unknown;
} | null;

// Fetches and parses a Contexto endpoint. Transport failures, 5xx responses
// and non-JSON bodies throw a user-facing ConvexError. 4xx responses are
// returned so callers can surface Contexto's `{ error }` body.
async function request(
  url: string,
): Promise<{ ok: boolean; body: ContextoBody }> {
  let res: Response;
  let body: ContextoBody;
  try {
    res = await fetch(url);
    body = (await res.json()) as ContextoBody;
  } catch {
    throw new ConvexError(UNAVAILABLE_MESSAGE);
  }
  if (res.status >= 500) throw new ConvexError(UNAVAILABLE_MESSAGE);
  return { ok: res.ok, body };
}

function parseScoredLemma(body: ContextoBody): {
  lemma: string;
  distance: number;
} {
  if (typeof body?.lemma !== "string" || typeof body.distance !== "number") {
    throw new ConvexError(UNEXPECTED_PAYLOAD_MESSAGE);
  }
  return { lemma: body.lemma, distance: body.distance };
}

// Contexto adapter for the word oracle. Plain functions, not actions: they
// run inside whichever action performs the Game turn.
export const contextoOracle: WordOracle = {
  async distance(contextoGameId, word) {
    const url = `${BASE}/game/${contextoGameId}/${encodeURIComponent(word)}`;
    const { ok, body } = await request(url);
    // Contexto answers unknown words with a 404 and an `{ error }` body.
    if (typeof body?.error === "string")
      return { ok: false, error: body.error };
    if (!ok) throw new ConvexError(UNAVAILABLE_MESSAGE);
    return { ok: true, ...parseScoredLemma(body) };
  },

  async tip(contextoGameId, distance) {
    const url = `${BASE}/tip/${contextoGameId}/${distance}`;
    const { ok, body } = await request(url);
    if (!ok) throw new ConvexError(UNAVAILABLE_MESSAGE);
    return parseScoredLemma(body);
  },

  async answer(contextoGameId) {
    const url = `${BASE}/giveup/${contextoGameId}`;
    const { ok, body } = await request(url);
    if (!ok) throw new ConvexError(UNAVAILABLE_MESSAGE);
    if (typeof body?.lemma !== "string") {
      throw new ConvexError(UNEXPECTED_PAYLOAD_MESSAGE);
    }
    return { lemma: body.lemma };
  },
};
