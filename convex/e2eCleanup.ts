import { ConvexError, v } from "convex/values";
import {
  env,
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { requireUser } from "./access";
import { GUEST_CLEANUP_ROW_BUDGET } from "./cleanup";
import { deleteAccount, expireGuest } from "./lib/accountLifecycle";

const E2E_EMAIL = /^contextus-e2e-[a-z0-9-]{1,32}-w\d+-u\d+@example\.com$/;

// Internal, so only an admin key (`npx convex run`) can delete accounts. The
// CLI picks its deployment separately from the app, so the caller names the
// backend under test and any other backend refuses.
export const purgeAccount = internalMutation({
  args: { email: v.string(), deploymentUrl: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, { email, deploymentUrl }) => {
    if (
      env.E2E_TEST !== "1" ||
      deploymentUrl !== env.CONVEX_CLOUD_URL ||
      !E2E_EMAIL.test(email)
    ) {
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

// Runs guest expiry cleanup to completion on the caller alone. The scheduled
// sweep would also expire other workers' guests.
export const expireCurrentGuest = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (env.E2E_TEST !== "1") {
      throw new ConvexError("E2E cleanup is unavailable");
    }
    const userId = await requireUser(ctx);
    const user = await ctx.db.get("users", userId);
    if (user?.isAnonymous !== true) {
      throw new ConvexError("E2E cleanup is unavailable");
    }
    while (!(await expireGuest(ctx, userId, GUEST_CLEANUP_ROW_BUDGET)).done);
    return null;
  },
});

async function deleteRateLimit(ctx: MutationCtx, email: string) {
  const rateLimit = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", email))
    .unique();
  if (rateLimit !== null) await ctx.db.delete("authRateLimits", rateLimit._id);
}
