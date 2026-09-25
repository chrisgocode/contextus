import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";

const BASE = "https://api.contexto.me/machado/en";
const UNAVAILABLE_MESSAGE = "Contexto is unavailable, please try again";
const UNEXPECTED_PAYLOAD_MESSAGE = "Contexto returned an unexpected response";

type Payload = Record<string, unknown>;

// Fetches and parses a Contexto endpoint. Transport failures, 5xx responses
// and bodies that aren't JSON objects throw a user-facing ConvexError. 4xx
// responses are returned so callers can surface Contexto's `{ error }` body.
async function request(url: string): Promise<{ ok: boolean; body: Payload }> {
  let res: Response;
  let body: unknown;
  try {
    res = await fetch(url);
    body = await res.json();
  } catch {
    throw new ConvexError(UNAVAILABLE_MESSAGE);
  }
  if (res.status >= 500 || !isObject(body)) {
    throw new ConvexError(UNAVAILABLE_MESSAGE);
  }
  return { ok: res.ok, body };
}

function isObject(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseScoredLemma(body: Payload): { lemma: string; distance: number } {
  if (typeof body.lemma !== "string" || typeof body.distance !== "number") {
    throw new ConvexError(UNEXPECTED_PAYLOAD_MESSAGE);
  }
  return { lemma: body.lemma, distance: body.distance };
}

export const fetchGuess = internalAction({
  args: { contextoGameId: v.number(), word: v.string() },
  handler: async (
    _ctx,
    { contextoGameId, word },
  ): Promise<
    { ok: true; lemma: string; distance: number } | { ok: false; error: string }
  > => {
    const url = `${BASE}/game/${contextoGameId}/${encodeURIComponent(word)}`;
    const { ok, body } = await request(url);
    // Contexto answers unknown words with a 404 and an `{ error }` body.
    if (typeof body.error === "string") return { ok: false, error: body.error };
    if (!ok) throw new ConvexError(UNAVAILABLE_MESSAGE);
    return { ok: true, ...parseScoredLemma(body) };
  },
});

export const fetchTip = internalAction({
  args: { contextoGameId: v.number(), distance: v.number() },
  handler: async (
    _ctx,
    { contextoGameId, distance },
  ): Promise<{ lemma: string; distance: number }> => {
    const url = `${BASE}/tip/${contextoGameId}/${distance}`;
    const { ok, body } = await request(url);
    if (!ok) throw new ConvexError(UNAVAILABLE_MESSAGE);
    return parseScoredLemma(body);
  },
});

export const fetchAnswer = internalAction({
  args: { contextoGameId: v.number() },
  handler: async (_ctx, { contextoGameId }): Promise<{ lemma: string }> => {
    const url = `${BASE}/giveup/${contextoGameId}`;
    const { ok, body } = await request(url);
    if (!ok) throw new ConvexError(UNAVAILABLE_MESSAGE);
    if (typeof body.lemma !== "string") {
      throw new ConvexError(UNEXPECTED_PAYLOAD_MESSAGE);
    }
    return { lemma: body.lemma };
  },
});
