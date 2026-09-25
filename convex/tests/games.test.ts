import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { asUser, seedUser, setupTest } from "../testHelpers.test";

async function createRoomWith(t: ReturnType<typeof setupTest>) {
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  return { host, other, roomId };
}

test("start: only host can start", async () => {
  const t = setupTest();
  const { other, roomId } = await createRoomWith(t);
  await expect(
    asUser(t, other).mutation(api.games.start, {
      roomId,
      contextoGameId: 1336,
    }),
  ).rejects.toThrow();
});

test("start: refuses second active game in same room", async () => {
  const t = setupTest();
  const { host, roomId } = await createRoomWith(t);
  await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await expect(
    asUser(t, host).mutation(api.games.start, {
      roomId,
      contextoGameId: 1337,
    }),
  ).rejects.toThrow();
});

test("start: rejects invalid Contexto game ids", async () => {
  const t = setupTest();
  const { host, roomId } = await createRoomWith(t);

  await expect(
    asUser(t, host).mutation(api.games.start, { roomId, contextoGameId: 0 }),
  ).rejects.toThrow("Invalid game id");
});

test("getActive returns the active game for a member", async () => {
  const t = setupTest();
  const { host, other, roomId } = await createRoomWith(t);
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  const active = await asUser(t, other).query(api.games.getActive, { roomId });
  expect(active?._id).toBe(gameId);
});

test("getActive returns null for non-member (silent skip)", async () => {
  const t = setupTest();
  const { host, roomId } = await createRoomWith(t);
  await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  const outsider = await seedUser(t);
  const result = await asUser(t, outsider).query(api.games.getActive, {
    roomId,
  });
  expect(result).toBeNull();
});

test("getById exposes winner details only to room members", async () => {
  const t = setupTest();
  const { host, other, roomId } = await createRoomWith(t);
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("users", host, { image: "winner.png" });
    await ctx.db.patch("games", gameId, { status: "won", winnerUserId: host });
  });

  await expect(
    asUser(t, other).query(api.games.getById, { gameId }),
  ).resolves.toMatchObject({
    winner: expect.objectContaining({ name: "Host", image: "winner.png" }),
  });
  const outsider = await seedUser(t);
  await expect(
    asUser(t, outsider).query(api.games.getById, { gameId }),
  ).resolves.toBeNull();
});

test("getById falls back to display username when the winner has no name", async () => {
  const t = setupTest();
  const { host, roomId } = await createRoomWith(t);
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch("users", host, {
      name: undefined,
      displayUsername: "Winner",
    });
    await ctx.db.patch("games", gameId, { status: "won", winnerUserId: host });
  });

  await expect(
    asUser(t, host).query(api.games.getById, { gameId }),
  ).resolves.toMatchObject({ winner: { name: "Winner", image: null } });
});

test("uploaded avatar appears on guesses, requests, and winner", async () => {
  const t = setupTest();
  const { host, other, roomId } = await createRoomWith(t);
  const avatarStorageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["avatar"], { type: "image/png" })),
  );
  await t.run(async (ctx) =>
    ctx.db.patch("users", other, { avatarStorageId, image: "oauth.png" }),
  );
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await asUser(t, other).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("gameGuesses", {
      gameId,
      userId: other,
      lemma: "apple",
      distance: 42,
      source: "guess",
      createdAt: 1,
    });
    await ctx.db.patch("games", gameId, { status: "won", winnerUserId: other });
  });

  const guesses = await asUser(t, host).query(api.guesses.listForGame, {
    gameId,
  });
  const requests = await asUser(t, host).query(api.requests.listPending, {
    gameId,
  });
  const game = await asUser(t, host).query(api.games.getById, { gameId });
  for (const player of [
    guesses.sorted[0].player,
    requests[0].requester,
    game?.winner,
  ]) {
    expect(player).toMatchObject({
      id: other,
      name: "Other",
      image: expect.stringContaining("/api/storage/"),
      isGuest: false,
    });
  }
});

test("listFinished returns finished games newest first only to members", async () => {
  const t = setupTest();
  const { host, other, roomId } = await createRoomWith(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("games", {
      roomId,
      contextoGameId: 1,
      status: "won",
      startedAt: 1,
      endedAt: 2,
    });
    await ctx.db.insert("games", {
      roomId,
      contextoGameId: 2,
      status: "given_up",
      startedAt: 3,
      endedAt: 4,
    });
  });

  const games = await asUser(t, other).query(api.games.listFinished, {
    roomId,
  });
  expect(games.map((game) => game.contextoGameId)).toEqual([2, 1]);

  const outsider = await seedUser(t);
  await expect(
    asUser(t, outsider).query(api.games.listFinished, { roomId }),
  ).resolves.toEqual([]);
  await expect(
    asUser(t, host).query(api.games.listFinished, { roomId }),
  ).resolves.toHaveLength(2);
});
