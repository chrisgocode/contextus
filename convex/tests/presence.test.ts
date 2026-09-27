import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { asUser, seedUser, setupTest } from "../testHelpers.test";

test("heartbeat silently no-ops for ex-member after leaving room", async () => {
  const t = setupTest();
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  await asUser(t, other).mutation(api.rooms.leave, { roomId });
  await expect(
    asUser(t, other).mutation(api.presence.heartbeat, {
      roomId,
      userId: other,
      sessionId: "s1",
      interval: 10000,
    }),
  ).resolves.toBeNull();
});

test("heartbeat records the caller, not the userId argument", async () => {
  const t = setupTest();
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });

  const beat = await asUser(t, other).mutation(api.presence.heartbeat, {
    roomId,
    userId: host,
    sessionId: "s1",
    interval: 10000,
  });

  const present = await t.query(api.presence.list, {
    roomToken: beat!.roomToken,
  });
  expect(present.map((p) => p.userId)).toEqual([other]);
});

// presence.list has no membership check: it takes the component's random
// roomToken, which only heartbeat hands out, and only to members.
test("presence.list does not accept a room id in place of the roomToken", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const { roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, host).mutation(api.presence.heartbeat, {
    roomId,
    userId: host,
    sessionId: "s1",
    interval: 10000,
  });

  await expect(
    t.query(api.presence.list, { roomToken: roomId }),
  ).resolves.toEqual([]);
});
