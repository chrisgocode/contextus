import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthSessionId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { env, internalMutation, type MutationCtx } from "./_generated/server";
import {
  E2E_GUEST_LIFETIME_MS,
  GUEST_LIFETIME_MS,
} from "./lib/guestEngagement";
import { startGuestMerge } from "./lib/guestMerge";
import { ensureUserHasUsername } from "./lib/usernames";

const {
  auth,
  signIn,
  signOut,
  store: convexAuthStore,
  isAuthenticated,
} = convexAuth({
  providers: [
    // E2E runs sign in with Google against `e2e/oidc-mock.mjs`.
    env.E2E_TEST === "1" && env.E2E_GOOGLE_ISSUER !== undefined
      ? Google({ issuer: env.E2E_GOOGLE_ISSUER })
      : Google,
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

export { auth, signIn, signOut, isAuthenticated };

// The `auth:store` args this file reads. Convex Auth validates the rest.
type StoreArgs =
  | { type: "signIn"; userId: Id<"users"> }
  | {
      type: "userOAuth";
      provider: string;
      providerAccountId: string;
      signature: string;
    }
  | { type: "other" }; // Any other call, passed through untouched.

// Convex Auth's own handler. `_handler` is private Convex API, so keep
// `@convex-dev/auth` and `convex` on versions where it still exists.
const convexAuthHandler = (
  convexAuthStore as unknown as {
    _handler: (ctx: MutationCtx, args: { args: unknown }) => Promise<unknown>;
  }
)._handler;
// Fail the deploy, not the first sign-in, if an upgrade drops it.
if (typeof convexAuthHandler !== "function") {
  throw new Error("Convex Auth's store no longer exposes `_handler`");
}

// Convex Auth calls `auth:store` by name, so this replaces its store to start
// a guest merge when a Guest signs in. Convex Auth never passes the Guest's
// session to its callbacks, so it's read here before Convex Auth drops it.
export const store = internalMutation({
  args: { args: v.any() },
  handler: async (ctx, fnArgs) => {
    const args = fnArgs.args as StoreArgs;
    if (args.type === "signIn") {
      // Signing in deletes the caller's session, so start merging first.
      const sessionId = await getAuthSessionId(ctx);
      if (sessionId !== null) {
        await startGuestMerge(ctx, sessionId, args.userId);
      }
      return await convexAuthHandler(ctx, fnArgs);
    }
    if (args.type !== "userOAuth") return await convexAuthHandler(ctx, fnArgs);

    // The Google callback carries no identity. The verifier row, which
    // Convex Auth deletes here, holds the session that started the flow.
    const verifier = await ctx.db
      .query("authVerifiers")
      .withIndex("signature", (q) => q.eq("signature", args.signature))
      .unique();
    const result = await convexAuthHandler(ctx, fnArgs);
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q
          .eq("provider", args.provider)
          .eq("providerAccountId", args.providerAccountId),
      )
      .unique();
    if (verifier?.sessionId !== undefined && account !== null) {
      await startGuestMerge(ctx, verifier.sessionId, account.userId);
    }
    return result;
  },
});
