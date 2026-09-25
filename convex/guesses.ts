import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { action, query } from "./_generated/server";
import { tryMemberByGame } from "./access";
import { loadPlayers } from "./lib/player";
import { performTurn, type GuessResult } from "./turns";

export const submit = action({
  args: { gameId: v.id("games"), word: v.string() },
  handler: async (ctx, { gameId, word }): Promise<GuessResult> => {
    return await performTurn(ctx, { gameId, turn: { kind: "guess", word } });
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

    const players = await loadPlayers(
      ctx,
      sortedRaw.map((g) => g.userId),
    );
    const hydrate = (g: Doc<"gameGuesses">) => ({
      ...g,
      player: players.get(g.userId)!,
    });
    return {
      sorted: sortedRaw.map(hydrate),
      latest: latestRaw === null ? null : hydrate(latestRaw),
    };
  },
});
