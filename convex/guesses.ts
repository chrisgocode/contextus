import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action, query } from "./_generated/server";
import { tryMemberByGame } from "./access";
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
