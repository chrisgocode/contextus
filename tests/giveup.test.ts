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

test("non-host request creates pending row", async () => {
  const t = setupTest();
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.giveup.request, { gameId });
  const pending = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  expect(pending?.type).toBe("giveup");
});

test("non-host approve rejected", async () => {
  const t = setupTest();
  mockContextoFetch({ answers: { 1336: "persimmon" } });
  const { other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.giveup.request, { gameId });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await expect(
    asUser(t, other).action(api.giveup.approve, { requestId: req!._id }),
  ).rejects.toThrow();
});

test("host approve ends game with answer", async () => {
  const t = setupTest();
  mockContextoFetch({ answers: { 1336: "persimmon" } });
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.giveup.request, { gameId });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  const result = await asUser(t, host).action(api.giveup.approve, {
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

test("host deny patches request", async () => {
  const t = setupTest();
  const { host, other, gameId } = await startedGame(t);
  await asUser(t, other).mutation(api.giveup.request, { gameId });
  const req = await t.run(async (ctx) =>
    ctx.db.query("pendingRequests").first(),
  );
  await asUser(t, host).mutation(api.giveup.deny, { requestId: req!._id });
  const row = await t.run(async (ctx) => ctx.db.get(req!._id));
  expect(row?.status).toBe("denied");
});
