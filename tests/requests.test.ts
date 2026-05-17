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

test("listPending returns empty for ex-member after leaving room", async () => {
	const t = setupTest();
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
	await asUser(t, other).mutation(api.rooms.leave, { roomId });
	const res = await asUser(t, other).query(api.requests.listPending, {
		gameId,
	});
	expect(res).toEqual([]);
});

test("create inserts pending row of correct type", async () => {
	const t = setupTest();
	const { other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "hint",
	});
	const pending = await t.run(async (ctx) =>
		ctx.db
			.query("pendingRequests")
			.withIndex("by_game_status", (q) =>
				q.eq("gameId", gameId).eq("status", "pending"),
			)
			.collect(),
	);
	expect(pending).toHaveLength(1);
	expect(pending[0].type).toBe("hint");
	expect(pending[0].requesterUserId).toBe(other);
});

test("create rejects host", async () => {
	const t = setupTest();
	const { host, gameId } = await startedGame(t);
	await expect(
		asUser(t, host).mutation(api.requests.create, { gameId, type: "hint" }),
	).rejects.toThrow();
});

test("create rejects non-member", async () => {
	const t = setupTest();
	const { gameId } = await startedGame(t);
	const stranger = await seedUser(t);
	await expect(
		asUser(t, stranger).mutation(api.requests.create, {
			gameId,
			type: "giveup",
		}),
	).rejects.toThrow();
});

test("create rejects duplicate pending of same type", async () => {
	const t = setupTest();
	const { other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "hint",
	});
	await expect(
		asUser(t, other).mutation(api.requests.create, { gameId, type: "hint" }),
	).rejects.toThrow();
});

test("create allows different types from same requester", async () => {
	const t = setupTest();
	const { other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "hint",
	});
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "giveup",
	});
	const pending = await t.run(async (ctx) =>
		ctx.db
			.query("pendingRequests")
			.withIndex("by_game_status", (q) =>
				q.eq("gameId", gameId).eq("status", "pending"),
			)
			.collect(),
	);
	expect(pending).toHaveLength(2);
});

test("create rejects when game not in_progress", async () => {
	const t = setupTest();
	mockContextoFetch({ answers: { 1336: "answer" } });
	const { host, other, gameId } = await startedGame(t);
	await asUser(t, host).action(api.giveup.hostGiveup, { gameId });
	await expect(
		asUser(t, other).mutation(api.requests.create, { gameId, type: "hint" }),
	).rejects.toThrow();
});

test("deny requires host", async () => {
	const t = setupTest();
	const { other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "hint",
	});
	const req = await t.run(async (ctx) =>
		ctx.db.query("pendingRequests").first(),
	);
	await expect(
		asUser(t, other).mutation(api.requests.deny, { requestId: req!._id }),
	).rejects.toThrow();
});

test("deny patches status to denied", async () => {
	const t = setupTest();
	const { host, other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "giveup",
	});
	const req = await t.run(async (ctx) =>
		ctx.db.query("pendingRequests").first(),
	);
	await asUser(t, host).mutation(api.requests.deny, { requestId: req!._id });
	const row = await t.run(async (ctx) => ctx.db.get(req!._id));
	expect(row?.status).toBe("denied");
});

test("approve requires host", async () => {
	const t = setupTest();
	mockContextoFetch({ tips: { 1336: { 299: "pomelo" } } });
	const { other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "hint",
	});
	const req = await t.run(async (ctx) =>
		ctx.db.query("pendingRequests").first(),
	);
	await expect(
		asUser(t, other).action(api.requests.approve, { requestId: req!._id }),
	).rejects.toThrow();
});

test("approve rejects non-pending request", async () => {
	const t = setupTest();
	const { host, other, gameId } = await startedGame(t);
	await asUser(t, other).mutation(api.requests.create, {
		gameId,
		type: "giveup",
	});
	const req = await t.run(async (ctx) =>
		ctx.db.query("pendingRequests").first(),
	);
	await asUser(t, host).mutation(api.requests.deny, { requestId: req!._id });
	await expect(
		asUser(t, host).action(api.requests.approve, { requestId: req!._id }),
	).rejects.toThrow();
});
