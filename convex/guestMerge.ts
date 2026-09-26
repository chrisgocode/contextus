import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { runGuestMergeBatch } from "./lib/guestMerge";

export const runBatch = internalMutation({
  args: { mergeId: v.id("guestMerges") },
  handler: async (ctx, { mergeId }) => {
    await runGuestMergeBatch(ctx, mergeId);
    return null;
  },
});
