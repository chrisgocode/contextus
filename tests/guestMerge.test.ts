import { expect, test } from "vitest";
import { mergeCurrentGuestIntoUser } from "../convex/lib/guestMerge";
import { asUser, asUserWithSession, seedUser, setupTest } from "./helpers";
import { api } from "../convex/_generated/api";

test("mergeCurrentGuestIntoUser moves guest room and progress rows to registered user", async () => {
	const t = setupTest();
	const host = await seedUser(t);
	const guest = await seedUser(t, { isAnonymous: true });
	const target = await seedUser(t, { email: "registered@test.dev" });
	const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
	await asUser(t, guest).mutation(api.rooms.join, { code });
	await asUser(t, target).mutation(api.rooms.join, { code });
	const { gameId } = await asUser(t, host).mutation(api.games.start, {
		roomId,
		contextoGameId: 1336,
	});

	await t.run(async (ctx) => {
		await ctx.db.insert("gameGuesses", {
			gameId,
			userId: guest,
			lemma: "guestword",
			distance: 42,
			source: "guess",
			createdAt: 10,
		});
		await ctx.db.insert("userGameHistory", {
			userId: guest,
			contextoGameId: 1336,
			firstPlayedAt: 10,
			firstAttemptAt: 11,
			firstAttemptDistance: 42,
			firstAttemptGameId: gameId,
		});
		await ctx.db.insert("userGameHistory", {
			userId: target,
			contextoGameId: 1336,
			firstPlayedAt: 20,
		});
		await ctx.db.insert("userAchievements", {
			userId: guest,
			achievementId: "youll_get_there",
			unlockedAt: 10,
		});
		await ctx.db.insert("userAchievements", {
			userId: target,
			achievementId: "youll_get_there",
			unlockedAt: 20,
		});
	});

	const guestSession = await asUserWithSession(t, guest);
	await guestSession.run(async (ctx) => {
		await mergeCurrentGuestIntoUser(ctx, target);
	});

	const result = await t.run(async (ctx) => {
		const members = await ctx.db
			.query("roomMembers")
			.withIndex("by_room", (q) => q.eq("roomId", roomId))
			.collect();
		const guesses = await ctx.db
			.query("gameGuesses")
			.withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
			.collect();
		const history = await ctx.db
			.query("userGameHistory")
			.withIndex("by_user_game", (q) =>
				q.eq("userId", target).eq("contextoGameId", 1336),
			)
			.unique();
		const achievements = await ctx.db
			.query("userAchievements")
			.withIndex("by_user", (q) => q.eq("userId", target))
			.collect();
		const guestRows = {
			memberships: (
				await ctx.db
					.query("roomMembers")
					.withIndex("by_user", (q) => q.eq("userId", guest))
					.collect()
			).length,
			history: (
				await ctx.db
					.query("userGameHistory")
					.withIndex("by_user", (q) => q.eq("userId", guest))
					.collect()
			).length,
			achievements: (
				await ctx.db
					.query("userAchievements")
					.withIndex("by_user", (q) => q.eq("userId", guest))
					.collect()
			).length,
		};
		return { members, guesses, history, achievements, guestRows };
	});

	expect(result.members.filter((m) => m.userId === target)).toHaveLength(1);
	expect(result.members.some((m) => m.userId === guest)).toBe(false);
	expect(result.guesses.map((g) => g.userId)).toEqual([target]);
	expect(result.history).toMatchObject({
		userId: target,
		firstPlayedAt: 10,
		firstAttemptAt: 11,
		firstAttemptDistance: 42,
	});
	expect(result.achievements).toHaveLength(1);
	expect(result.achievements[0]).toMatchObject({
		userId: target,
		achievementId: "youll_get_there",
		unlockedAt: 10,
	});
	expect(result.guestRows).toEqual({
		memberships: 0,
		history: 0,
		achievements: 0,
	});
});
