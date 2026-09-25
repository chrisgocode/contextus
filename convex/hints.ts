import { v } from "convex/values";
import { action } from "./_generated/server";
import { performTurn } from "./turns";

export const hostHint = action({
  args: { gameId: v.id("games") },
  handler: async (
    ctx,
    { gameId },
  ): Promise<{ lemma: string; distance: number }> => {
    return await performTurn(ctx, { gameId, turn: { kind: "hint" } });
  },
});
