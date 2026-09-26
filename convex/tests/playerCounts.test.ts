import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { asUser, seedUser, setupTest } from "../testHelpers.test";

afterEach(() => vi.unstubAllEnvs());

test("only the configured registered owner can read counts", async () => {
  vi.stubEnv("PLAYER_COUNT_OWNER_EMAIL", "owner@test.dev");
  const t = setupTest();
  const owner = await seedUser(t, {
    email: "owner@test.dev",
    isAnonymous: false,
  });
  const other = await seedUser(t, {
    email: "other@test.dev",
    isAnonymous: false,
  });
  const guest = await seedUser(t, {
    email: "owner@test.dev",
    isAnonymous: true,
  });

  expect(
    await asUser(t, owner).query(api.playerCounts.overview, { refresh: 0 }),
  ).toMatchObject({ count: 0 });
  expect(
    await asUser(t, other).query(api.playerCounts.overview, { refresh: 0 }),
  ).toBeNull();
  expect(
    await asUser(t, guest).query(api.playerCounts.overview, { refresh: 0 }),
  ).toBeNull();
  expect(await t.query(api.playerCounts.overview, { refresh: 0 })).toBeNull();
  vi.stubEnv("PLAYER_COUNT_OWNER_EMAIL", "");
  expect(
    await asUser(t, owner).query(api.playerCounts.overview, { refresh: 0 }),
  ).toBeNull();
});

test("room heartbeats count a player once across sessions and expire", async () => {
  vi.stubEnv("PLAYER_COUNT_OWNER_EMAIL", "owner@test.dev");
  const t = setupTest();
  const owner = await seedUser(t, {
    email: "owner@test.dev",
    isAnonymous: false,
  });
  const player = await seedUser(t);
  const { roomId } = await asUser(t, player).mutation(api.rooms.create, {});
  for (const sessionId of ["tab-1", "tab-2"]) {
    await asUser(t, player).mutation(api.presence.heartbeat, {
      roomId,
      userId: player,
      sessionId,
      interval: 10_000,
    });
  }
  const secondRoom = await asUser(t, player).mutation(api.rooms.create, {});
  await asUser(t, player).mutation(api.presence.heartbeat, {
    roomId: secondRoom.roomId,
    userId: player,
    sessionId: "other-room",
    interval: 10_000,
  });
  expect(
    await asUser(t, owner).query(api.playerCounts.overview, { refresh: 0 }),
  ).toMatchObject({ count: 1 });
  await t.run(async (ctx) => {
    const row = await ctx.db.query("playerPresence").first();
    if (row)
      await ctx.db.patch("playerPresence", row._id, {
        lastSeenAt: Date.now() - 46_000,
      });
  });
  expect(
    await asUser(t, owner).query(api.playerCounts.overview, { refresh: 1 }),
  ).toMatchObject({ count: 0 });
  await t.mutation(internal.playerCounts.sample, {});
  const overview = await asUser(t, owner).query(api.playerCounts.overview, {
    refresh: 2,
  });
  expect(overview?.samples.at(-1)?.count).toBe(0);
});
