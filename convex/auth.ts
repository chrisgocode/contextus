import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { mergeCurrentGuestIntoUser } from "./lib/guestMerge";
import { ensureUserHasUsername } from "./lib/usernames";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [Google, Anonymous],
	callbacks: {
		async beforeSessionCreation(ctx, { userId }) {
			await mergeCurrentGuestIntoUser(ctx, userId as Id<"users">);
			const user = await ctx.db.get(userId as Id<"users">);
			if (user?.isAnonymous === true) return;
			await ctx.db.patch(userId as Id<"users">, { isAnonymous: false });
		},
		async afterUserCreatedOrUpdated(ctx, { userId }) {
			await ensureUserHasUsername(ctx, userId as Id<"users">);
		},
	},
});
