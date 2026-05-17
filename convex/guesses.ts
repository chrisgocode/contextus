import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./auth_helpers";
import { assertMember, upsertHistory } from "./games";
import type { Doc, Id } from "./_generated/dataModel";

const ALREADY_GUESSED_MESSAGE = "The word was already guessed.";

function normalizeWord(input: string): string {
  return input.trim().toLowerCase();
}

export const _preflight = internalQuery({
  args: { gameId: v.id("games"), userId: v.id("users"), lemma: v.string() },
  handler: async (ctx, { gameId, userId, lemma }) => {
    const game = await ctx.db.get(gameId);
    if (game === null) throw new ConvexError("Game not found");
    if (game.status !== "in_progress") {
      throw new ConvexError("Game is no longer in progress");
    }
    await assertMember(ctx, game.roomId, userId);
    const cached = await ctx.db
      .query("wordDistances")
      .withIndex("by_game_lemma", (q) =>
        q.eq("contextoGameId", game.contextoGameId).eq("lemma", lemma),
      )
      .unique();
    return {
      contextoGameId: game.contextoGameId,
      roomId: game.roomId,
      cached: cached?.distance ?? null,
    };
  },
});

export const _recordGuess = internalMutation({
  args: {
    gameId: v.id("games"),
    userId: v.id("users"),
    lemma: v.string(),
    distance: v.number(),
    source: v.union(v.literal("guess"), v.literal("hint")),
  },
  handler: async (ctx, { gameId, userId, lemma, distance, source }) => {
    const game = await ctx.db.get(gameId);
    if (game === null) throw new ConvexError("Game not found");
    if (game.status !== "in_progress") {
      throw new ConvexError("Game is no longer in progress");
    }

    // cache upsert
    const cached = await ctx.db
      .query("wordDistances")
      .withIndex("by_game_lemma", (q) =>
        q.eq("contextoGameId", game.contextoGameId).eq("lemma", lemma),
      )
      .unique();
    if (cached === null) {
      await ctx.db.insert("wordDistances", {
        contextoGameId: game.contextoGameId,
        lemma,
        distance,
      });
    }

    // dedup
    const existingGuess = await ctx.db
      .query("gameGuesses")
      .withIndex("by_game_lemma", (q) =>
        q.eq("gameId", gameId).eq("lemma", lemma),
      )
      .unique();
    if (existingGuess !== null) {
      return { status: "duplicate" as const, won: false };
    }

    const now = Date.now();
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId,
      lemma,
      distance,
      source,
      createdAt: now,
    });

    let won = false;
    if (distance === 0 && source === "guess") {
      await ctx.db.patch(gameId, {
        status: "won",
        winnerUserId: userId,
        answerLemma: lemma,
        endedAt: now,
      });
      won = true;
    }
    await ctx.db.patch(game.roomId, { lastActivityAt: now });
    await upsertHistory(ctx, userId, game.contextoGameId);
    return { status: "recorded" as const, won };
  },
});

export const submit = action({
  args: { gameId: v.id("games"), word: v.string() },
  handler: async (ctx, { gameId, word }) => {
    const userId = await requireUser(ctx);
    const lemma = normalizeWord(word);
    if (lemma.length === 0) throw new ConvexError("Empty word");

    const pre: { contextoGameId: number; cached: number | null } =
      await ctx.runQuery(internal.guesses._preflight, {
        gameId,
        userId,
        lemma,
      });

    let distance: number;
    let canonicalLemma = lemma;
    if (pre.cached !== null) {
      distance = pre.cached;
    } else {
      const result = await ctx.runAction(internal.contexto.fetchGuess, {
        contextoGameId: pre.contextoGameId,
        word: lemma,
      });
      if (!result.ok) {
        throw new ConvexError(result.error);
      }
      distance = result.distance;
      canonicalLemma = result.lemma;
    }

    // If the API normalized to a different lemma, dedup is enforced against the
    // canonical lemma in _recordGuess; cache is keyed by what the user typed
    // (lemma) since we already looked that up above. To keep cache useful for
    // the canonical lemma too, store under both keys when they differ.
    if (canonicalLemma !== lemma) {
      const result: { status: "recorded" | "duplicate"; won: boolean } =
        await ctx.runMutation(internal.guesses._recordGuess, {
          gameId,
          userId,
          lemma: canonicalLemma,
          distance,
          source: "guess",
        });
      if (result.status === "duplicate") {
        return {
          lemma: canonicalLemma,
          distance,
          won: false,
          alreadyGuessed: true,
          message: ALREADY_GUESSED_MESSAGE,
        };
      }
      return { lemma: canonicalLemma, distance, won: result.won };
    }
    const result: { status: "recorded" | "duplicate"; won: boolean } =
      await ctx.runMutation(internal.guesses._recordGuess, {
        gameId,
        userId,
        lemma,
        distance,
        source: "guess",
      });
    if (result.status === "duplicate") {
      return {
        lemma,
        distance,
        won: false,
        alreadyGuessed: true,
        message: ALREADY_GUESSED_MESSAGE,
      };
    }
    return { lemma, distance, won: result.won };
  },
});

export const listForGame = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get(gameId);
    if (game === null) return { sorted: [], latest: null };
    await assertMember(ctx, game.roomId, userId);
    const sortedRaw = await ctx.db
      .query("gameGuesses")
      .withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
      .order("asc")
      .take(500);
    const latestRaw = await ctx.db
      .query("gameGuesses")
      .withIndex("by_game_created", (q) => q.eq("gameId", gameId))
      .order("desc")
      .first();

    const userIds = new Set<Id<"users">>();
    for (const g of sortedRaw) userIds.add(g.userId);
    const userMap = new Map<Id<"users">, Doc<"users">>();
    for (const uid of userIds) {
      const u = await ctx.db.get(uid);
      if (u !== null) userMap.set(uid, u);
    }
    const hydrate = (g: Doc<"gameGuesses">) => {
      const u = userMap.get(g.userId);
      return {
        ...g,
        userName: u?.name ?? null,
        userImage: u?.image ?? null,
      };
    };
    return {
      sorted: sortedRaw.map(hydrate),
      latest: latestRaw === null ? null : hydrate(latestRaw),
    };
  },
});
