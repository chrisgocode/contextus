import { afterEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { asUser, mockContextoFetch, seedUser, setupTest } from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function startedGame(
	t: ReturnType<typeof setupTest>,
	contextoGameId = 1336,
	users?: { host?: Id<"users">; other?: Id<"users"> },
) {
	const host = users?.host ?? (await seedUser(t, { name: "Host" }));
	const other = users?.other ?? (await seedUser(t, { name: "Other" }));
	const { roomId, code } = await asUser(t, host).mutation(
		api.rooms.create,
		{},
	);
	await asUser(t, other).mutation(api.rooms.join, { code });
	const { gameId } = await asUser(t, host).mutation(api.games.start, {
		roomId,
		contextoGameId,
	});
	return { host, other, roomId, gameId };
}

async function achievementIds(
	t: ReturnType<typeof setupTest>,
	userId: Id<"users">,
) {
	const rows = await t.run(async (ctx) =>
		ctx.db
			.query("userAchievements")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect(),
	);
	return rows.map((row) => row.achievementId).sort();
}

async function statsFor(t: ReturnType<typeof setupTest>, userId: Id<"users">) {
	return await t.run(async (ctx) =>
		ctx.db
			.query("userAchievementStats")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.unique(),
	);
}

test("submitted real guesses unlock the matching first color achievements", async () => {
	const t = setupTest();
	mockContextoFetch({
		guesses: {
			1336: { ember: 2000, amber: 1000, moss: 300 },
		},
	});
	const { host, gameId } = await startedGame(t);

	await asUser(t, host).action(api.guesses.submit, { gameId, word: "ember" });
	await asUser(t, host).action(api.guesses.submit, { gameId, word: "amber" });
	await asUser(t, host).action(api.guesses.submit, { gameId, word: "moss" });

	await expect(achievementIds(t, host)).resolves.toEqual(
		expect.arrayContaining([
			"youll_get_there",
			"getting_warmer",
			"hot_on_the_trail",
		]),
	);
});

test("duplicate guesses and hints do not unlock or increment achievements", async () => {
	const t = setupTest();
	mockContextoFetch({
		guesses: { 1336: { ember: 2000 } },
		tips: { 1336: { 299: "amber" } },
	});
	const { host, other, gameId } = await startedGame(t);

	await asUser(t, host).action(api.guesses.submit, { gameId, word: "ember" });
	await asUser(t, other).action(api.guesses.submit, { gameId, word: "ember" });
	await asUser(t, host).action(api.hints.hostHint, { gameId });

	await expect(achievementIds(t, host)).resolves.toContain("youll_get_there");
	await expect(achievementIds(t, host)).resolves.not.toContain(
		"getting_warmer",
	);
	await expect(achievementIds(t, other)).resolves.toEqual([]);
	await expect(statsFor(t, host)).resolves.toMatchObject({
		redGuesses: 1,
		yellowGuesses: 0,
		greenGuesses: 0,
	});
});

test("lifetime color counters unlock at threshold boundaries", async () => {
	const t = setupTest();
	mockContextoFetch({
		guesses: { 1336: { red: 2000, yellow: 301, green: 300 } },
	});
	const { host, gameId } = await startedGame(t);
	await t.run(async (ctx) => {
		await ctx.db.insert("userAchievementStats", {
			userId: host,
			redGuesses: 249,
			yellowGuesses: 99,
			greenGuesses: 49,
			uniqueSolves: 0,
		});
	});

	await asUser(t, host).action(api.guesses.submit, { gameId, word: "red" });
	await asUser(t, host).action(api.guesses.submit, { gameId, word: "yellow" });
	await asUser(t, host).action(api.guesses.submit, { gameId, word: "green" });

	await expect(achievementIds(t, host)).resolves.toEqual(
		expect.arrayContaining([
			"it_happens",
			"the_mellow_yellow",
			"green_thumb",
		]),
	);
});

test("a winning guess credits the winner quality achievements and active guessers", async () => {
	const t = setupTest();
	mockContextoFetch({
		guesses: { 1336: { opener: 500, answer: 0 } },
	});
	const { host, other, gameId } = await startedGame(t);

	await asUser(t, other).action(api.guesses.submit, { gameId, word: "opener" });
	await asUser(t, host).action(api.guesses.submit, { gameId, word: "answer" });

	await expect(achievementIds(t, host)).resolves.toEqual(
		expect.arrayContaining(["bullseye", "sharp_mind", "mind_reader", "psychic"]),
	);
	await expect(achievementIds(t, host)).resolves.not.toContain(
		"no_backtracking",
	);
	await expect(achievementIds(t, other)).resolves.toContain("bullseye");
});

test("the same contexto puzzle only counts once for lifetime solve totals", async () => {
	const t = setupTest();
	const host = await seedUser(t, { name: "Host" });
	const other = await seedUser(t, { name: "Other" });
	mockContextoFetch({
		guesses: { 1336: { answer: 0, repeat: 0 } },
	});
	const first = await startedGame(t, 1336, { host, other });
	const second = await startedGame(t, 1336, { host, other });

	await asUser(t, host).action(api.guesses.submit, {
		gameId: first.gameId,
		word: "answer",
	});
	await asUser(t, host).action(api.guesses.submit, {
		gameId: second.gameId,
		word: "repeat",
	});

	await expect(statsFor(t, host)).resolves.toMatchObject({ uniqueSolves: 1 });
	const unlocked = await achievementIds(t, host);
	expect(unlocked.filter((id) => id === "bullseye")).toHaveLength(1);
});

test("first-attempt achievements require the user's first-ever attempt for that contexto puzzle", async () => {
	const t = setupTest();
	const host = await seedUser(t, { name: "Host" });
	const other = await seedUser(t, { name: "Other" });
	mockContextoFetch({
		guesses: { 1336: { cold: 2000, second: 1, answer: 0 } },
	});
	const first = await startedGame(t, 1336, { host, other });
	const retry = await startedGame(t, 1336, { host, other });

	await asUser(t, host).action(api.guesses.submit, {
		gameId: first.gameId,
		word: "cold",
	});
	await asUser(t, host).action(api.guesses.submit, {
		gameId: retry.gameId,
		word: "second",
	});
	await asUser(t, host).action(api.guesses.submit, {
		gameId: retry.gameId,
		word: "answer",
	});

	const unlocked = await achievementIds(t, host);
	expect(unlocked).not.toContain("lucky_shot");
	expect(unlocked).not.toContain("scorching_hot");
	expect(unlocked).not.toContain("so_close");
	expect(unlocked).not.toContain("one_and_done");
});

test("personal puzzle achievements use the user's own real guess sequence", async () => {
	const t = setupTest();
	const guesses: Record<string, number> = {};
	for (let i = 1; i <= 49; i += 1) {
		guesses[`word${i}`] = 2000 + i;
	}
	guesses.word50 = 200;
	guesses.step3 = 30;
	guesses.step2 = 20;
	guesses.step1 = 0;
	mockContextoFetch({ guesses: { 1336: guesses, 1337: guesses } });
	const { host, gameId } = await startedGame(t, 1336);
	const second = await startedGame(t, 1337, { host });

	for (let i = 1; i <= 50; i += 1) {
		await asUser(t, host).action(api.guesses.submit, {
			gameId,
			word: `word${i}`,
		});
	}
	await asUser(t, host).action(api.guesses.submit, {
		gameId: second.gameId,
		word: "step3",
	});
	await asUser(t, host).action(api.guesses.submit, {
		gameId: second.gameId,
		word: "step2",
	});
	await asUser(t, host).action(api.guesses.submit, {
		gameId: second.gameId,
		word: "step1",
	});

	await expect(achievementIds(t, host)).resolves.toEqual(
		expect.arrayContaining(["rabbit_hole", "no_backtracking"]),
	);
});

test("comeback kid unlocks when the winner solves after more than 100 own guesses", async () => {
	const t = setupTest();
	const guesses: Record<string, number> = {};
	for (let i = 1; i <= 100; i += 1) {
		guesses[`miss${i}`] = 2000 + i;
	}
	guesses.answer = 0;
	mockContextoFetch({ guesses: { 1336: guesses } });
	const { host, gameId } = await startedGame(t, 1336);

	for (let i = 1; i <= 100; i += 1) {
		await asUser(t, host).action(api.guesses.submit, {
			gameId,
			word: `miss${i}`,
		});
	}
	await asUser(t, host).action(api.guesses.submit, {
		gameId,
		word: "answer",
	});

	await expect(achievementIds(t, host)).resolves.toContain("comeback_kid");
});

test("timezone and streak achievements stay disabled in v1", async () => {
	const t = setupTest();
	mockContextoFetch({ guesses: { 1336: { answer: 0 } } });
	const { host, gameId } = await startedGame(t);

	await asUser(t, host).action(api.guesses.submit, { gameId, word: "answer" });

	const unlocked = await achievementIds(t, host);
	expect(unlocked).not.toContain("night_owl");
	expect(unlocked).not.toContain("early_bird");
	expect(unlocked).not.toContain("on_a_roll");
	expect(unlocked).not.toContain("habit_formed");
	expect(unlocked).not.toContain("unstoppable");
	expect(unlocked).not.toContain("century_club");
});
