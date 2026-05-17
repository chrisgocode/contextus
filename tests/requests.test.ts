import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, seedUser, setupTest } from "./helpers";

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
