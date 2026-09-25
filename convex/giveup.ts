import { v } from "convex/values";
import { action } from "./_generated/server";
import { performTurn } from "./turns";

export const hostGiveup = action({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }): Promise<{ lemma: string }> => {
    return await performTurn(ctx, { gameId, turn: { kind: "giveup" } });
  },
});
