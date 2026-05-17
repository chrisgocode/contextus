import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export async function requireUser(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Not authenticated");
  }
  return userId;
}
