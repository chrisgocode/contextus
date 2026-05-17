import { afterEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
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

test("approve via requests dispatcher ends game with answer + marks approved", async () => {
	const t = setupTest();
	mockContextoFetch({ answers: { 1336: "persimmon" } });
	const { host, other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "giveup",
	});
	const req = await t.run(async (ctx) =>
		ctx.db.query("pendingRequests").first(),
	);
	const result = await asUser(t, host).action(api.requests.approve, {
		requestId: req!._id,
	});
	expect(result.lemma).toBe("persimmon");
	const game = await t.run(async (ctx) => ctx.db.get(gameId));
	expect(game?.status).toBe("given_up");
	expect(game?.answerLemma).toBe("persimmon");
	const reqRow = await t.run(async (ctx) => ctx.db.get(req!._id));
	expect(reqRow?.status).toBe("approved");
});

test("hostGiveup shortcut works with no pending row", async () => {
	const t = setupTest();
	mockContextoFetch({ answers: { 1336: "persimmon" } });
	const { host, gameId } = await startedGame(t);
	await asUser(t, host).action(api.giveup.hostGiveup, { gameId });
	const game = await t.run(async (ctx) => ctx.db.get(gameId));
	expect(game?.status).toBe("given_up");
});
