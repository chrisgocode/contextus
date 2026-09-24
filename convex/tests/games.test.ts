import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
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
    await ctx.db.patch(host, { image: "winner.png" });
    await ctx.db.patch(gameId, { status: "won", winnerUserId: host });
  });

  await expect(
    asUser(t, other).query(api.games.getById, { gameId }),
  ).resolves.toMatchObject({
    winnerName: "Host",
    winnerImage: "winner.png",
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
    await ctx.db.patch(host, { name: undefined, displayUsername: "Winner" });
    await ctx.db.patch(gameId, { status: "won", winnerUserId: host });
  });

  await expect(
    asUser(t, host).query(api.games.getById, { gameId }),
  ).resolves.toMatchObject({ winnerName: "Winner", winnerImage: null });
});

test("start: upserts user history", async () => {
  const t = setupTest();
  const { host, roomId } = await createRoomWith(t);
  await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  const history = await t.run(async (ctx) =>
    ctx.db
      .query("userGameHistory")
      .withIndex("by_user_game", (q) =>
        q.eq("userId", host).eq("contextoGameId", 1336),
      )
      .collect(),
  );
  expect(history).toHaveLength(1);
});

test("listMyHistory deduplicates repeated history records", async () => {
  const t = setupTest();
  const userId = await seedUser(t);

  await t.mutation(internal.games._recordHistory, {
    userId,
    contextoGameId: 1336,
  });
  await t.mutation(internal.games._recordHistory, {
    userId,
    contextoGameId: 1336,
  });

  await expect(
    asUser(t, userId).query(api.games.listMyHistory, {}),
  ).resolves.toEqual([1336]);
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
