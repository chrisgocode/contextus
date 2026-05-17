import { afterEach, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, mockContextoFetch, seedUser, setupTest } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("history upsert is per-user per-gameId (no dupes)", async () => {
  const t = setupTest();
  mockContextoFetch({ guesses: { 1336: { hello: 100 } } });
  const host = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await asUser(t, host).action(api.guesses.submit, { gameId, word: "hello" });
  const ids = await asUser(t, host).query(api.games.listMyHistory, {});
  expect(ids).toEqual([1336]);
});

test("history listMyHistory returns viewer-only games", async () => {
  const t = setupTest();
  const a = await seedUser(t);
  const b = await seedUser(t);
  const { roomId: ra } = await asUser(t, a).mutation(api.rooms.create, {});
  await asUser(t, a).mutation(api.games.start, {
    roomId: ra,
    contextoGameId: 100,
  });
  const { roomId: rb } = await asUser(t, b).mutation(api.rooms.create, {});
  await asUser(t, b).mutation(api.games.start, {
    roomId: rb,
    contextoGameId: 200,
  });
  const aIds = await asUser(t, a).query(api.games.listMyHistory, {});
  const bIds = await asUser(t, b).query(api.games.listMyHistory, {});
  expect(aIds).toEqual([100]);
  expect(bIds).toEqual([200]);
});

test("replay same date allowed; history stays single", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  mockContextoFetch({ answers: { 1336: "persimmon" } });
  await asUser(t, host).action(api.giveup.hostGiveup, { gameId });
  await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  const ids = await asUser(t, host).query(api.games.listMyHistory, {});
  expect(ids).toEqual([1336]);
});
