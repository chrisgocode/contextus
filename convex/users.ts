import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireUser } from "./access";
import {
	assertUsernameAvailable,
	ensureUserHasUsername,
	normalizeUsernameInput,
} from "./lib/usernames";

const ACTIVITY_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_BACKFILL_BATCH_SIZE = 50;
const MAX_BACKFILL_BATCH_SIZE = 100;

function startOfUtcDay(timestamp: number): number {
	const d = new Date(timestamp);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function utcDateKey(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

async function getUserByUsername(
	ctx: Pick<QueryCtx, "db">,
	username: string,
) {
	return await ctx.db
		.query("users")
		.withIndex("by_username", (q) => q.eq("username", username.toLowerCase()))
		.unique();
}

export const getUser = query({
	args: { userId: v.optional(v.id("users")) },
	handler: async (ctx, { userId }) => {
		const currentUserId = await requireUser(ctx);
		const requestedUserId = userId ?? currentUserId;
		const user = await ctx.db.get(requestedUserId);
		if (user === null) return null;
		const uploadedAvatarUrl = user.avatarStorageId
			? await ctx.storage.getUrl(user.avatarStorageId)
			: null;

		return {
			_id: user._id,
			name: user.name ?? null,
			email: requestedUserId === currentUserId ? (user.email ?? null) : null,
			username: user.username ?? null,
			displayUsername: user.displayUsername ?? null,
			image: uploadedAvatarUrl ?? user.image ?? null,
			isCurrentUser: requestedUserId === currentUserId,
		};
	},
});

export const getByUsername = query({
	args: { username: v.string() },
	handler: async (ctx, { username }) => {
		const user = await getUserByUsername(ctx, username.trim());
		if (user === null) return null;

		const currentUserId = await getAuthUserId(ctx);
		const isCurrentUser = currentUserId === user._id;
		const uploadedAvatarUrl = user.avatarStorageId
			? await ctx.storage.getUrl(user.avatarStorageId)
			: null;

		return {
			_id: user._id,
			name: user.name ?? null,
			username: user.username ?? null,
			displayUsername: user.displayUsername ?? null,
			image: uploadedAvatarUrl ?? user.image ?? null,
			isCurrentUser,
			email: isCurrentUser ? (user.email ?? null) : null,
		};
	},
});

export const generateProfileImageUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		await requireUser(ctx);
		return await ctx.storage.generateUploadUrl();
	},
});

export const updateProfile = mutation({
	args: {
		name: v.string(),
		username: v.string(),
		avatarStorageId: v.optional(v.id("_storage")),
	},
	handler: async (ctx, args) => {
		const currentUserId = await requireUser(ctx);
		const name = args.name.trim();
		if (name.length === 0) {
			throw new ConvexError("Name is required.");
		}

		const normalizedUsername = normalizeUsernameInput(args.username);
		await assertUsernameAvailable(
			ctx,
			normalizedUsername.username,
			currentUserId,
		);

		if (args.avatarStorageId !== undefined) {
			const storedFile = await ctx.db.system.get(
				"_storage",
				args.avatarStorageId,
			);
			if (storedFile === null) {
				throw new ConvexError("Uploaded profile image was not found.");
			}
		}

		await ctx.db.patch(currentUserId, {
			name,
			...normalizedUsername,
			...(args.avatarStorageId === undefined
				? {}
				: { avatarStorageId: args.avatarStorageId }),
		});
		return null;
	},
});

export const backfillMissingUsernames = mutation({
	args: { batchSize: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const batchSize = Math.min(
			Math.max(args.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE, 1),
			MAX_BACKFILL_BATCH_SIZE,
		);
		const users = await ctx.db
			.query("users")
			.withIndex("by_username", (q) => q.eq("username", undefined))
			.take(batchSize);

		let updated = 0;
		for (const user of users) {
			const result = await ensureUserHasUsername(ctx, user._id);
			if (result !== null) updated++;
		}

		return {
			updated,
			hasMore: users.length === batchSize,
		};
	},
});

export const getActivityGraph = query({
	args: {
		userId: v.optional(v.id("users")),
		username: v.optional(v.string()),
	},
	handler: async (ctx, { userId, username }) => {
		const requestedUserId =
			username === undefined
				? userId ?? (await requireUser(ctx))
				: (await getUserByUsername(ctx, username.trim()))?._id;
		if (requestedUserId === undefined) return null;
		const user = await ctx.db.get(requestedUserId);
		if (user === null) return null;

		const todayStart = startOfUtcDay(Date.now());
		const start = todayStart - (ACTIVITY_DAYS - 1) * MS_PER_DAY;
		const endExclusive = todayStart + MS_PER_DAY;

		const counts = new Map<string, number>();
		const rows = await ctx.db
			.query("userGameHistory")
			.withIndex("by_user_and_firstPlayedAt", (q) =>
				q
					.eq("userId", requestedUserId)
					.gte("firstPlayedAt", start)
					.lt("firstPlayedAt", endExclusive),
			)
			.take(1000);

		for (const row of rows) {
			const key = utcDateKey(startOfUtcDay(row.firstPlayedAt));
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}

		const days = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
			const date = utcDateKey(start + i * MS_PER_DAY);
			const count = counts.get(date) ?? 0;
			return {
				date,
				count,
				level: Math.min(count, 4),
			};
		});

		return {
			days,
			totalCount: rows.length,
		};
	},
});
