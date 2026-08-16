import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GUEST_LIFETIME_MS } from "./lib/guestEngagement";
import { mergeCurrentGuestIntoUser } from "./lib/guestMerge";
import { ensureUserHasUsername } from "./lib/usernames";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [
		Google,
		Anonymous({
			profile: () => ({
				isAnonymous: true,
				guestExpiresAt: Date.now() + GUEST_LIFETIME_MS,
			}),
		}),
		...(process.env.E2E_TEST === "1" ? [Password] : []),
	],
	callbacks: {
		async beforeSessionCreation(ctx, { userId }) {
			const mergedGuestUserId = await mergeCurrentGuestIntoUser(
				ctx,
				userId as Id<"users">,
			);
			if (mergedGuestUserId !== null) {
				await ctx.scheduler.runAfter(0, internal.cleanup.removeMergedGuest, {
					guestUserId: mergedGuestUserId,
				});
			}
			const user = await ctx.db.get(userId as Id<"users">);
			if (user?.isAnonymous === true) return;
			await ctx.db.patch(userId as Id<"users">, { isAnonymous: false });
		},
		async afterUserCreatedOrUpdated(ctx, { userId }) {
			await ensureUserHasUsername(ctx, userId as Id<"users">);
		},
	},
});
