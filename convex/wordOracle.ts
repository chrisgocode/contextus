import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { contextoOracle } from "./contexto";

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
export function puzzleWordOracle(ctx: ActionCtx, contextoGameId: number) {
  return {
    async distance(word: string): Promise<DistanceResult> {
      const cached: ScoredLemma | null = await ctx.runQuery(
        internal.wordOracle._cachedDistance,
        { contextoGameId, word },
      );
      if (cached !== null) return { ok: true, ...cached };
      const result = await contextoOracle.distance(contextoGameId, word);
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
      const tip = await contextoOracle.tip(contextoGameId, distance);
      await ctx.runMutation(internal.wordOracle._cacheDistance, {
        contextoGameId,
        input: tip.lemma,
        lemma: tip.lemma,
        distance: tip.distance,
      });
      return tip;
    },

    async answer(): Promise<{ lemma: string }> {
      return await contextoOracle.answer(contextoGameId);
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
