import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { asUser, mockContextoFetch, seedUser, setupTest } from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function startedGame(t: ReturnType<typeof setupTest>) {
	const host = await seedUser(t, { name: "Host" });
	const other = await seedUser(t, { name: "Other" });
	const { roomId, code } = await asUser(t, host).mutation(
		api.rooms.create,
		{},
	);
	await asUser(t, other).mutation(api.rooms.join, { code });
	const { gameId } = await asUser(t, host).mutation(api.games.start, {
		roomId,
		contextoGameId: 1336,
	});
	return { host, other, roomId, gameId };
}

test("hostHint shortcut works with no pending row", async () => {
	const t = setupTest();
	mockContextoFetch({ tips: { 1336: { 299: "pomelo" } } });
	const { host, gameId } = await startedGame(t);
	const result = await asUser(t, host).action(api.hints.hostHint, { gameId });
	expect(result.lemma).toBe("pomelo");
});

test("hint target reflects best score", async () => {
	const t = setupTest();
	mockContextoFetch({
		guesses: { 1336: { onion: 100 } },
		tips: { 1336: { 50: "garlic" } },
	});
	const { host, gameId } = await startedGame(t);
	await asUser(t, host).action(api.guesses.submit, {
		gameId,
		word: "onion",
	});
	const result = await asUser(t, host).action(api.hints.hostHint, { gameId });
	expect(result.distance).toBe(50);
	expect(result.lemma).toBe("garlic");
});

test("hint walks past already-guessed when best=1", async () => {
	const t = setupTest();
	mockContextoFetch({
		guesses: { 1336: { close: 1, second: 2 } },
		tips: { 1336: { 2: "second", 3: "third" } },
	});
	const { host, gameId } = await startedGame(t);
	await asUser(t, host).action(api.guesses.submit, { gameId, word: "close" });
	await asUser(t, host).action(api.guesses.submit, { gameId, word: "second" });
	const result = await asUser(t, host).action(api.hints.hostHint, { gameId });
	expect(result.lemma).toBe("third");
	expect(result.distance).toBe(3);
});

test("_execute attributes guess to requester and marks request approved atomically", async () => {
	const t = setupTest();
	mockContextoFetch({ tips: { 1336: { 299: "pomelo" } } });
	const { host, other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "hint",
	});
	const req = await t.run(async (ctx) =>
		ctx.db.query("pendingRequests").first(),
	);
	const result = await asUser(t, host).action(api.requests.approve, {
		requestId: req!._id,
	});
	expect(result).toEqual({ lemma: "pomelo", distance: 299 });
	const rows = await t.run(async (ctx) =>
		ctx.db
			.query("gameGuesses")
			.withIndex("by_game_lemma", (q) =>
				q.eq("gameId", gameId).eq("lemma", "pomelo"),
			)
			.collect(),
	);
	expect(rows).toHaveLength(1);
	expect(rows[0].source).toBe("hint");
	expect(rows[0].userId).toBe(other);
	const reqRow = await t.run(async (ctx) => ctx.db.get(req!._id));
	expect(reqRow?.status).toBe("approved");
});

test("_execute internal action direct invocation works for host path", async () => {
	const t = setupTest();
	mockContextoFetch({ tips: { 1336: { 299: "pomelo" } } });
	const { host, gameId } = await startedGame(t);
	const result = await asUser(t, host).action(internal.hints._execute, {
		gameId,
		requesterUserId: host,
	});
	expect(result.lemma).toBe("pomelo");
});
