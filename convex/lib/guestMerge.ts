import { getAuthSessionId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type MergeCtx = Pick<MutationCtx, "auth" | "db">;

async function currentUserFromSession(
	ctx: MergeCtx,
): Promise<Id<"users"> | null> {
	const sessionId = await getAuthSessionId(ctx);
	if (sessionId === null) return null;
	const session = await ctx.db.get(sessionId);
	return session?.userId ?? null;
}

export async function mergeCurrentGuestIntoUser(
	ctx: MergeCtx,
	targetUserId: Id<"users">,
): Promise<void> {
	const guestUserId = await currentUserFromSession(ctx);
	if (guestUserId === null || guestUserId === targetUserId) return;
	const [guest, target] = await Promise.all([
		ctx.db.get(guestUserId),
		ctx.db.get(targetUserId),
	]);
	if (guest?.isAnonymous !== true || target === null) return;

	await mergeRoomMemberships(ctx, guestUserId, targetUserId);
	await patchGuestGuesses(ctx, guestUserId, targetUserId);
	await patchGuestRequests(ctx, guestUserId, targetUserId);
	await patchGuestWins(ctx, guestUserId, targetUserId);
	await mergeHistory(ctx, guestUserId, targetUserId);
	await mergeAchievements(ctx, guestUserId, targetUserId);
	await mergeAchievementProgress(ctx, guestUserId, targetUserId);
	await mergeAchievementStats(ctx, guestUserId, targetUserId);
	await mergeGamePlayerStats(ctx, guestUserId, targetUserId);
}

async function mergeRoomMemberships(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db
		.query("roomMembers")
		.withIndex("by_user", (q) => q.eq("userId", guestUserId))
		.collect();
	for (const row of rows) {
		const existing = await ctx.db
			.query("roomMembers")
			.withIndex("by_room_user", (q) =>
				q.eq("roomId", row.roomId).eq("userId", targetUserId),
			)
			.unique();
		if (existing === null) {
			await ctx.db.patch(row._id, { userId: targetUserId });
		} else {
			await ctx.db.patch(existing._id, {
				joinedAt: Math.min(existing.joinedAt, row.joinedAt),
			});
			await ctx.db.delete(row._id);
		}
	}
}

async function patchGuestGuesses(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db.query("gameGuesses").collect();
	for (const row of rows) {
		if (row.userId === guestUserId) {
			await ctx.db.patch(row._id, { userId: targetUserId });
		}
	}
}

async function patchGuestRequests(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db.query("pendingRequests").collect();
	for (const row of rows) {
		if (row.requesterUserId === guestUserId) {
			await ctx.db.patch(row._id, { requesterUserId: targetUserId });
		}
	}
}

async function patchGuestWins(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db.query("games").collect();
	for (const row of rows) {
		if (row.winnerUserId === guestUserId) {
			await ctx.db.patch(row._id, { winnerUserId: targetUserId });
		}
	}
}

async function mergeHistory(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db
		.query("userGameHistory")
		.withIndex("by_user", (q) => q.eq("userId", guestUserId))
		.collect();
	for (const row of rows) {
		const existing = await ctx.db
			.query("userGameHistory")
			.withIndex("by_user_game", (q) =>
				q.eq("userId", targetUserId).eq("contextoGameId", row.contextoGameId),
			)
			.unique();
		if (existing === null) {
			await ctx.db.patch(row._id, { userId: targetUserId });
			continue;
		}
		await ctx.db.patch(existing._id, {
			firstPlayedAt: Math.min(existing.firstPlayedAt, row.firstPlayedAt),
			firstAttemptAt: earliest(existing.firstAttemptAt, row.firstAttemptAt),
			firstAttemptDistance:
				existing.firstAttemptAt === undefined ||
				(row.firstAttemptAt !== undefined &&
					row.firstAttemptAt < existing.firstAttemptAt)
					? row.firstAttemptDistance
					: existing.firstAttemptDistance,
			firstAttemptGameId:
				existing.firstAttemptAt === undefined ||
				(row.firstAttemptAt !== undefined &&
					row.firstAttemptAt < existing.firstAttemptAt)
					? row.firstAttemptGameId
					: existing.firstAttemptGameId,
			firstSolvedAt: earliest(existing.firstSolvedAt, row.firstSolvedAt),
			firstSolvedGameId:
				existing.firstSolvedAt === undefined ||
				(row.firstSolvedAt !== undefined &&
					row.firstSolvedAt < existing.firstSolvedAt)
					? row.firstSolvedGameId
					: existing.firstSolvedGameId,
		});
		await ctx.db.delete(row._id);
	}
}

async function mergeAchievements(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db
		.query("userAchievements")
		.withIndex("by_user", (q) => q.eq("userId", guestUserId))
		.collect();
	for (const row of rows) {
		const existing = await ctx.db
			.query("userAchievements")
			.withIndex("by_user_achievement", (q) =>
				q.eq("userId", targetUserId).eq("achievementId", row.achievementId),
			)
			.unique();
		if (existing === null) {
			await ctx.db.patch(row._id, { userId: targetUserId });
		} else {
			await ctx.db.patch(existing._id, {
				unlockedAt: Math.min(existing.unlockedAt, row.unlockedAt),
			});
			await ctx.db.delete(row._id);
		}
	}
}

async function mergeAchievementProgress(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db
		.query("userAchievementProgress")
		.withIndex("by_user", (q) => q.eq("userId", guestUserId))
		.collect();
	for (const row of rows) {
		const existing = await ctx.db
			.query("userAchievementProgress")
			.withIndex("by_user_achievement", (q) =>
				q.eq("userId", targetUserId).eq("achievementId", row.achievementId),
			)
			.unique();
		if (existing === null) {
			await ctx.db.patch(row._id, { userId: targetUserId });
		} else {
			await ctx.db.patch(existing._id, {
				current: Math.max(existing.current, row.current),
				target: Math.max(existing.target, row.target),
				hidden: existing.hidden && row.hidden,
				updatedAt: Math.max(existing.updatedAt, row.updatedAt),
			});
			await ctx.db.delete(row._id);
		}
	}
}

async function mergeAchievementStats(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const guest = await ctx.db
		.query("userAchievementStats")
		.withIndex("by_user", (q) => q.eq("userId", guestUserId))
		.unique();
	if (guest === null) return;
	const target = await ctx.db
		.query("userAchievementStats")
		.withIndex("by_user", (q) => q.eq("userId", targetUserId))
		.unique();
	if (target === null) {
		await ctx.db.patch(guest._id, { userId: targetUserId });
		return;
	}
	await ctx.db.patch(target._id, {
		redGuesses: target.redGuesses + guest.redGuesses,
		yellowGuesses: target.yellowGuesses + guest.yellowGuesses,
		greenGuesses: target.greenGuesses + guest.greenGuesses,
		uniqueSolves: target.uniqueSolves + guest.uniqueSolves,
	});
	await ctx.db.delete(guest._id);
}

async function mergeGamePlayerStats(
	ctx: MergeCtx,
	guestUserId: Id<"users">,
	targetUserId: Id<"users">,
) {
	const rows = await ctx.db
		.query("gamePlayerStats")
		.collect();
	for (const row of rows) {
		if (row.userId !== guestUserId) continue;
		const existing = await ctx.db
			.query("gamePlayerStats")
			.withIndex("by_game_user", (q) =>
				q.eq("gameId", row.gameId).eq("userId", targetUserId),
			)
			.unique();
		if (existing === null) {
			await ctx.db.patch(row._id, { userId: targetUserId });
		} else {
			await ctx.db.patch(existing._id, {
				realGuessCount: existing.realGuessCount + row.realGuessCount,
				bestDistance: Math.min(existing.bestDistance, row.bestDistance),
				lastDistance: row.updatedAt > existing.updatedAt ? row.lastDistance : existing.lastDistance,
				noBacktrackingSoFar:
					existing.noBacktrackingSoFar && row.noBacktrackingSoFar,
				updatedAt: Math.max(existing.updatedAt, row.updatedAt),
			});
			await ctx.db.delete(row._id);
		}
	}
}

function earliest(a: number | undefined, b: number | undefined) {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return Math.min(a, b);
}
