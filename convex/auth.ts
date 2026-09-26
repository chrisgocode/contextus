import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { env } from "./_generated/server";
import {
  E2E_GUEST_LIFETIME_MS,
  GUEST_LIFETIME_MS,
} from "./lib/guestEngagement";
import { startGuestMerge } from "./lib/guestMerge";
import { ensureUserHasUsername } from "./lib/usernames";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    Anonymous({
      profile: () => ({
        isAnonymous: true,
        guestExpiresAt:
          Date.now() +
          (env.E2E_TEST === "1" ? E2E_GUEST_LIFETIME_MS : GUEST_LIFETIME_MS),
      }),
    }),
    ...(env.E2E_TEST === "1" ? [Password] : []),
  ],
  callbacks: {
    async beforeSessionCreation(ctx, { userId }) {
      await startGuestMerge(ctx, userId as Id<"users">);
      const user = await ctx.db.get("users", userId as Id<"users">);
      if (user?.isAnonymous === true) return;
      await ctx.db.patch("users", userId as Id<"users">, {
        isAnonymous: false,
      });
    },
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      await ensureUserHasUsername(ctx, userId as Id<"users">);
    },
  },
});
