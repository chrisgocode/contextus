import { afterEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, seedUser, setupTest } from "./helpers";

afterEach(() => {
	vi.useRealTimers();
});

test("getUser returns profile fields for the current user", async () => {
	const t = setupTest();
	const user = await seedUser(t, {
		name: "Ada",
		email: "ada@test.dev",
		username: "briskabacus12",
		displayUsername: "BriskAbacus12",
	});

	const profile = await asUser(t, user).query(api.users.getUser, {});

	expect(profile).toMatchObject({
		_id: user,
		name: "Ada",
		email: "ada@test.dev",
		username: "briskabacus12",
		displayUsername: "BriskAbacus12",
		isCurrentUser: true,
	});
});

test("getByUsername resolves normalized usernames and keeps email private", async () => {
	const t = setupTest();
	const user = await seedUser(t, {
		name: "Ada",
		email: "ada@test.dev",
		username: "briskabacus12",
		displayUsername: "BriskAbacus12",
	});

	const profile = await t.query(api.users.getByUsername, {
		username: "BriskAbacus12",
	});

	expect(profile).toMatchObject({
		_id: user,
		name: "Ada",
		email: null,
		username: "briskabacus12",
		displayUsername: "BriskAbacus12",
		isCurrentUser: false,
	});
});

test("getByUsername marks the authenticated owner", async () => {
	const t = setupTest();
	const user = await seedUser(t, {
		email: "owner@test.dev",
		username: "ownername",
		displayUsername: "OwnerName",
	});

	const profile = await asUser(t, user).query(api.users.getByUsername, {
		username: "ownername",
	});

	expect(profile).toMatchObject({
		_id: user,
		email: "owner@test.dev",
		isCurrentUser: true,
	});
});

test("getUser omits email when reading another user", async () => {
	const t = setupTest();
	const viewer = await seedUser(t);
	const viewed = await seedUser(t, {
		email: "viewed@test.dev",
	});

	const profile = await asUser(t, viewer).query(api.users.getUser, {
		userId: viewed,
	});

	expect(profile?.email).toBeNull();
});

test("updateProfile updates the authenticated user's profile", async () => {
	const t = setupTest();
	const user = await seedUser(t, {
		username: "briskabacus12",
		displayUsername: "BriskAbacus12",
	});
	const other = await seedUser(t, {
		username: "calmacorn34",
		displayUsername: "CalmAcorn34",
	});

	await asUser(t, user).mutation(api.users.updateProfile, {
		name: "Updated User",
		username: "BrightUser20",
	});

	const updated = await t.run(async (ctx) => await ctx.db.get(user));
	const untouched = await t.run(async (ctx) => await ctx.db.get(other));

	expect(updated).toMatchObject({
		name: "Updated User",
		username: "brightuser20",
		displayUsername: "BrightUser20",
	});
	expect(untouched).toMatchObject({
		username: "calmacorn34",
		displayUsername: "CalmAcorn34",
	});
});

test("updateProfile rejects invalid and duplicate usernames", async () => {
	const t = setupTest();
	const user = await seedUser(t, {
		username: "briskabacus12",
		displayUsername: "BriskAbacus12",
	});
	await seedUser(t, {
		username: "takenuser1",
		displayUsername: "TakenUser1",
	});

	await expect(
		asUser(t, user).mutation(api.users.updateProfile, {
			name: "Test User",
			username: "bad-name",
		}),
	).rejects.toThrow("Username can only contain letters and numbers.");

	await expect(
		asUser(t, user).mutation(api.users.updateProfile, {
			name: "Test User",
			username: "TakenUser1",
		}),
	).rejects.toThrow("Username is already taken.");
});

test("backfillMissingUsernames assigns generated usernames to existing users", async () => {
	const t = setupTest();
	const user = await seedUser(t, { username: undefined });

	const result = await asUser(t, user).mutation(
		api.users.backfillMissingUsernames,
		{ batchSize: 10 },
	);
	const updated = await t.run(async (ctx) => await ctx.db.get(user));

	expect(result.updated).toBe(1);
	expect(updated?.username).toMatch(/^[a-z0-9]{3,20}$/);
	expect(updated?.displayUsername).toMatch(/^[A-Za-z0-9]{3,20}$/);
	expect(updated?.displayUsername).toHaveLength(updated?.username?.length ?? 0);
});

test("getActivityGraph aggregates user history by UTC day", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));

	const t = setupTest();
	const user = await seedUser(t);
	const other = await seedUser(t);

	await t.run(async (ctx) => {
		await ctx.db.insert("userGameHistory", {
			userId: user,
			contextoGameId: 1,
			firstPlayedAt: Date.UTC(2026, 5, 24, 23, 30),
		});
		await ctx.db.insert("userGameHistory", {
			userId: user,
			contextoGameId: 2,
			firstPlayedAt: Date.UTC(2026, 5, 25, 0, 30),
		});
		await ctx.db.insert("userGameHistory", {
			userId: user,
			contextoGameId: 3,
			firstPlayedAt: Date.UTC(2026, 5, 25, 18, 0),
		});
		await ctx.db.insert("userGameHistory", {
			userId: other,
			contextoGameId: 4,
			firstPlayedAt: Date.UTC(2026, 5, 25, 18, 0),
		});
	});

	const graph = await asUser(t, user).query(api.users.getActivityGraph, {});

	expect(graph?.totalCount).toBe(3);
	expect(graph?.days).toHaveLength(365);
	expect(graph?.days.at(-2)).toMatchObject({
		date: "2026-06-24",
		count: 1,
		level: 1,
	});
	expect(graph?.days.at(-1)).toMatchObject({
		date: "2026-06-25",
		count: 2,
		level: 2,
	});
});

test("getActivityGraph can show another user's activity by username", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));

	const t = setupTest();
	const viewer = await seedUser(t);
	const viewed = await seedUser(t, {
		username: "publicuser",
		displayUsername: "PublicUser",
	});

	await t.run(async (ctx) => {
		await ctx.db.insert("userGameHistory", {
			userId: viewed,
			contextoGameId: 1,
			firstPlayedAt: Date.UTC(2026, 5, 25, 12, 0),
		});
	});

	const graph = await asUser(t, viewer).query(api.users.getActivityGraph, {
		username: "PublicUser",
	});

	expect(graph?.totalCount).toBe(1);
	expect(graph?.days.at(-1)).toMatchObject({
		date: "2026-06-25",
		count: 1,
		level: 1,
	});
});

test("getActivityGraph can be read without authentication", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));

	const t = setupTest();
	const viewed = await seedUser(t, {
		username: "publicuser",
		displayUsername: "PublicUser",
	});

	await t.run(async (ctx) => {
		await ctx.db.insert("userGameHistory", {
			userId: viewed,
			contextoGameId: 1,
			firstPlayedAt: Date.UTC(2026, 5, 25, 12, 0),
		});
	});

	const graph = await t.query(api.users.getActivityGraph, {
		username: "PUBLICUSER",
	});

	expect(graph?.totalCount).toBe(1);
	expect(graph?.days.at(-1)).toMatchObject({
		date: "2026-06-25",
		count: 1,
		level: 1,
	});
});
