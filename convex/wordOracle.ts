import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import type { EventProperties } from "./analytics";
import { contextoOracle, UNEXPECTED_PAYLOAD_MESSAGE } from "./contexto";
import { e2eWordOracle } from "./e2eWordOracle";

export type ScoredLemma = { lemma: string; distance: number };

export type DistanceResult =
  | ({ ok: true } & ScoredLemma)
  | {
      ok: false;
      error: string;
    };

// Answers questions about a Contexto puzzle's answer. Transport and
// payload failures throw a user-facing ConvexError; an unknown word is an
// expected result, not an error.
export type WordOracle = {
  distance(contextoGameId: number, word: string): Promise<DistanceResult>;
  tip(contextoGameId: number, distance: number): Promise<ScoredLemma>;
  answer(contextoGameId: number): Promise<{ lemma: string }>;
};

// The word oracle for one Contexto puzzle, with distances served from the
// wordDistances cache when possible. Callers never see cache vs. fetch.
export type ContextoRequest = EventProperties<"contexto_request">;

export function puzzleWordOracle(
  ctx: ActionCtx,
  contextoGameId: number,
  onRequest: (request: ContextoRequest) => void,
) {
  // Times and classifies only the Contexto call itself, so cache reads and
  // writes neither inflate its latency nor count as Contexto being down.
  async function timed<T>(
    endpoint: ContextoRequest["endpoint"],
    call: () => Promise<T>,
    classify: (result: T) => ContextoRequest["outcome"] = () => "ok",
  ): Promise<T> {
    const startedAt = Date.now();
    let outcome: ContextoRequest["outcome"] = "unavailable";
    try {
      const result = await call();
      outcome = classify(result);
      return result;
    } catch (error) {
      if (
        error instanceof ConvexError &&
        error.data === UNEXPECTED_PAYLOAD_MESSAGE
      ) {
        outcome = "unexpected_payload";
      }
      throw error;
    } finally {
      onRequest({
        endpoint,
        duration_ms: Math.max(0, Date.now() - startedAt),
        outcome,
        // Cache hits never reach Contexto, so a timed distance is a miss.
        ...(endpoint === "distance" ? { cache: "miss" as const } : {}),
      });
    }
  }
  // E2E deployments use a deterministic fake and bypass the cache, so fake
  // and real Contexto scores never mix on a shared deployment.
  if (env.E2E_TEST === "1") {
    return {
      distance: (word: string) => e2eWordOracle.distance(contextoGameId, word),
      tip: (distance: number) => e2eWordOracle.tip(contextoGameId, distance),
      answer: () => e2eWordOracle.answer(contextoGameId),
    };
  }
  return {
    async distance(word: string): Promise<DistanceResult> {
      const startedAt = Date.now();
      const cached: ScoredLemma | null = await ctx.runQuery(
        internal.wordOracle._cachedDistance,
        { contextoGameId, word },
      );
      if (cached !== null) {
        onRequest({
          endpoint: "distance",
          duration_ms: Math.max(0, Date.now() - startedAt),
          outcome: "ok",
          cache: "hit",
        });
        return { ok: true, ...cached };
      }
      const result = await timed(
        "distance",
        () => contextoOracle.distance(contextoGameId, word),
        (result) => (result.ok ? "ok" : "unknown_word"),
      );
      if (result.ok) {
        await ctx.runMutation(internal.wordOracle._cacheDistance, {
          contextoGameId,
          input: word,
          lemma: result.lemma,
          distance: result.distance,
        });
      }
      return result;
    },

    async tip(distance: number): Promise<ScoredLemma> {
      const tip = await timed("tip", () =>
        contextoOracle.tip(contextoGameId, distance),
      );
      await ctx.runMutation(internal.wordOracle._cacheDistance, {
        contextoGameId,
        input: tip.lemma,
        lemma: tip.lemma,
        distance: tip.distance,
      });
      return tip;
    },

    async answer(): Promise<{ lemma: string }> {
      return await timed("answer", () => contextoOracle.answer(contextoGameId));
    },
  };
}

export const _cachedDistance = internalQuery({
  args: { contextoGameId: v.number(), word: v.string() },
  handler: async (ctx, { contextoGameId, word }) => {
    const row = await ctx.db
      .query("wordDistances")
      .withIndex("by_game_lemma", (q) =>
        q.eq("contextoGameId", contextoGameId).eq("lemma", word),
      )
      .unique();
    if (row === null) return null;
    return { lemma: row.canonicalLemma ?? row.lemma, distance: row.distance };
  },
});

// Stores the canonical lemma's distance and, when Contexto canonicalized the
// input (e.g. "dogs" -> "dog"), an alias row keyed by the raw input.
export const _cacheDistance = internalMutation({
  args: {
    contextoGameId: v.number(),
    input: v.string(),
    lemma: v.string(),
    distance: v.number(),
  },
  handler: async (ctx, { contextoGameId, input, lemma, distance }) => {
    const rows = [
      { lemma, distance },
      ...(input === lemma
        ? []
        : [{ lemma: input, distance, canonicalLemma: lemma }]),
    ];
    for (const row of rows) {
      const existing = await ctx.db
        .query("wordDistances")
        .withIndex("by_game_lemma", (q) =>
          q.eq("contextoGameId", contextoGameId).eq("lemma", row.lemma),
        )
        .unique();
      if (existing === null) {
        await ctx.db.insert("wordDistances", { contextoGameId, ...row });
      }
    }
    return null;
  },
});
