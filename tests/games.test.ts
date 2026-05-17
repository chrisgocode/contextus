import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, seedUser, setupTest } from "./helpers";

async function createRoomWith(t: ReturnType<typeof setupTest>) {
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { roomId, code } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
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

test("getActive throws for non-member", async () => {
  const t = setupTest();
  const { host, roomId } = await createRoomWith(t);
  await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  const outsider = await seedUser(t);
  await expect(
    asUser(t, outsider).query(api.games.getActive, { roomId }),
  ).rejects.toThrow();
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
