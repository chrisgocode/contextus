import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireMemberByGame, requireUser, tryMemberByGame } from "./access";
import type { AchievementId } from "./lib/achievements";

const ALREADY_GUESSED_MESSAGE = "The word was already guessed.";
type SubmitResult = {
  message?: string;
  lemma?: string;
  distance?: number;
  won: boolean;
  alreadyGuessed?: true;
  unlockedAchievementIds: AchievementId[];
};

function normalizeWord(input: string): string {
  return input.trim().toLowerCase();
}

export const _preflight = internalQuery({
  args: { gameId: v.id("games"), lemma: v.string() },
  handler: async (ctx, { gameId, lemma }) => {
    const { game } = await requireMemberByGame(ctx, { gameId });
    if (game.status !== "in_progress") {
      throw new ConvexError("Game is no longer in progress");
    }
    const cached = await ctx.db
      .query("wordDistances")
      .withIndex("by_game_lemma", (q) =>
        q.eq("contextoGameId", game.contextoGameId).eq("lemma", lemma),
      )
      .unique();
    return {
      contextoGameId: game.contextoGameId,
      roomId: game.roomId,
      cached:
        cached === null
          ? null
          : {
              lemma: cached.canonicalLemma ?? cached.lemma,
              distance: cached.distance,
            },
    };
  },
});

export const _cacheCanonical = internalMutation({
  args: {
    contextoGameId: v.number(),
    input: v.string(),
    canonicalLemma: v.string(),
    distance: v.number(),
  },
  handler: async (ctx, { contextoGameId, input, canonicalLemma, distance }) => {
    const existing = await ctx.db
      .query("wordDistances")
      .withIndex("by_game_lemma", (q) =>
        q.eq("contextoGameId", contextoGameId).eq("lemma", input),
      )
      .unique();
    if (existing !== null) return;
    await ctx.db.insert("wordDistances", {
      contextoGameId,
      lemma: input,
      distance,
      canonicalLemma,
    });
  },
});

export const submit = action({
  args: { gameId: v.id("games"), word: v.string() },
  handler: async (ctx, { gameId, word }): Promise<SubmitResult> => {
    const userId = await requireUser(ctx);
    const input = normalizeWord(word);
    if (input.length === 0) throw new ConvexError("Empty word");

    const pre: {
      contextoGameId: number;
      cached: { lemma: string; distance: number } | null;
    } = await ctx.runQuery(internal.guesses._preflight, {
      gameId,
      lemma: input,
    });

    let lemma: string;
    let distance: number;
    if (pre.cached !== null) {
      ({ lemma, distance } = pre.cached);
    } else {
      const result = await ctx.runAction(internal.contexto.fetchGuess, {
        contextoGameId: pre.contextoGameId,
        word: input,
      });
      if (!result.ok) {
        return {
          message: result.error,
          won: false,
          unlockedAchievementIds: [],
        };
      }
      ({ lemma, distance } = result);
      if (lemma !== input) {
        await ctx.runMutation(internal.guesses._cacheCanonical, {
          contextoGameId: pre.contextoGameId,
          input,
          canonicalLemma: lemma,
          distance,
        });
      }
    }

    const result: {
      status: "recorded" | "duplicate";
      won: boolean;
      unlockedAchievementIds: AchievementId[];
    } = await ctx.runMutation(internal.gameTransitions.applyGuess, {
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
        unlockedAchievementIds: [],
      };
    }
    return {
      lemma,
      distance,
      won: result.won,
      unlockedAchievementIds: result.unlockedAchievementIds,
    };
  },
});

export const listForGame = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const access = await tryMemberByGame(ctx, { gameId });
    if (access === null) return { sorted: [], latest: null };
    const sortedRaw = await ctx.db
      .query("gameGuesses")
      .withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
      .order("asc")
      .take(500);
    const latestRaw =
      sortedRaw.length === 0
        ? null
        : sortedRaw.reduce((a, b) => {
            if (a.createdAt !== b.createdAt) {
              return a.createdAt > b.createdAt ? a : b;
            }
            return a._creationTime > b._creationTime ? a : b;
          });

    const userIds = Array.from(new Set(sortedRaw.map((g) => g.userId)));
    const userDocs = await Promise.all(
      userIds.map((uid) => ctx.db.get("users", uid)),
    );
    const userMap = new Map<Id<"users">, Doc<"users">>();
    userDocs.forEach((u, i) => {
      if (u !== null) userMap.set(userIds[i], u);
    });
    const hydrate = (g: Doc<"gameGuesses">) => {
      const u = userMap.get(g.userId);
      return {
        ...g,
        userName: u?.name ?? u?.displayUsername ?? null,
        userImage: u?.image ?? null,
      };
    };
    return {
      sorted: sortedRaw.map(hydrate),
      latest: latestRaw === null ? null : hydrate(latestRaw),
    };
  },
});
