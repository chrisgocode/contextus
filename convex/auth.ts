import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { ensureUserHasUsername } from "./lib/usernames";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [Google],
	callbacks: {
		async afterUserCreatedOrUpdated(ctx, { userId }) {
			await ensureUserHasUsername(ctx, userId as Id<"users">);
		},
	},
});
