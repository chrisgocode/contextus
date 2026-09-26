import { ConvexError, v } from "convex/values";
import { env, mutation, type MutationCtx } from "./_generated/server";
import { deleteAccount } from "./lib/accountLifecycle";

const E2E_EMAIL = /^contextus-e2e-[a-z0-9-]{1,32}-w\d+-u[01]@example\.com$/;

export const purgeAccount = mutation({
  args: { email: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, { email }) => {
    if (env.E2E_TEST !== "1" || !E2E_EMAIL.test(email)) {
      throw new ConvexError("E2E cleanup is unavailable");
    }
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (user === null) return { deleted: false };

    await deleteAccount(ctx, user._id);
    // Rate limits are keyed by email, not user, so the registry can't see them.
    await deleteRateLimit(ctx, email);
    return { deleted: true };
  },
});

async function deleteRateLimit(ctx: MutationCtx, email: string) {
  const rateLimit = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", email))
    .unique();
  if (rateLimit !== null) await ctx.db.delete("authRateLimits", rateLimit._id);
}
