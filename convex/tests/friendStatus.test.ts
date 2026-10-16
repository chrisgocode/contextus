import { afterEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { asUser, seedUser, setupTest } from "../testHelpers.test";

type Test = ReturnType<typeof setupTest>;

afterEach(() => {
  vi.useRealTimers();
});

async function befriend(t: Test, a: Id<"users">, b: Id<"users">) {
  await asUser(t, a).mutation(api.friends.sendRequest, { userId: b });
  await asUser(t, b).mutation(api.friends.answerRequest, {
    userId: a,
    answer: "accept",
  });
}

async function statusOf(t: Test, viewer: Id<"users">, friend: Id<"users">) {
  const overview = await asUser(t, viewer).query(api.friends.overview, {});
  return overview?.friends.find((f) => f.id === friend)?.status;
}

function appHeartbeat(t: Test, userId: Id<"users">, sessionId = "app-tab") {
  return asUser(t, userId).mutation(api.presence.appHeartbeat, {
    sessionId,
    interval: 10_000,
  });
}

function roomHeartbeat(
  t: Test,
  userId: Id<"users">,
  roomId: Id<"rooms">,
  sessionId = `room-${roomId}`,
) {
  return asUser(t, userId).mutation(api.presence.heartbeat, {
    roomId,
    userId,
    sessionId,
    interval: 10_000,
  });
}

test("a Friend with Contextus open shows as Online", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await befriend(t, alice, bob);

  await appHeartbeat(t, bob);

  expect(await statusOf(t, alice, bob)).toEqual({ kind: "online" });
});

test("a Friend with no presence shows as Offline", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await befriend(t, alice, bob);

  expect(await statusOf(t, alice, bob)).toEqual({ kind: "offline" });
});

test("a Friend who closes their last tab goes Offline", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await befriend(t, alice, bob);
  const beat = await appHeartbeat(t, bob);

  await t.mutation(api.presence.disconnect, {
    sessionToken: beat!.sessionToken,
  });

  expect(await statusOf(t, alice, bob)).toEqual({ kind: "offline" });
});

test("a Friend present in an active Room shows as In a Room with its code", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await befriend(t, alice, bob);
  const { roomId, code } = await asUser(t, bob).mutation(api.rooms.create, {});
  await appHeartbeat(t, bob);

  await roomHeartbeat(t, bob, roomId);

  expect(await statusOf(t, alice, bob)).toEqual({ kind: "inRoom", code });
});

test("a Friend present in several Rooms is In the one with the most recent activity", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  const carol = await seedUser(t);
  await befriend(t, alice, bob);
  const first = await asUser(t, bob).mutation(api.rooms.create, {});
  vi.setSystemTime(start + 1_000);
  const second = await asUser(t, bob).mutation(api.rooms.create, {});
  await roomHeartbeat(t, bob, first.roomId);
  await roomHeartbeat(t, bob, second.roomId);
  expect(await statusOf(t, alice, bob)).toEqual({
    kind: "inRoom",
    code: second.code,
  });

  vi.setSystemTime(start + 2_000);
  await asUser(t, carol).mutation(api.rooms.join, { code: first.code });

  expect(await statusOf(t, alice, bob)).toEqual({
    kind: "inRoom",
    code: first.code,
  });
});

test("a Friend whose Room has ended is not In it", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await befriend(t, alice, bob);
  const { roomId } = await asUser(t, bob).mutation(api.rooms.create, {});
  await appHeartbeat(t, bob);
  await roomHeartbeat(t, bob, roomId);

  await asUser(t, bob).mutation(api.rooms.leave, { roomId });

  expect(await statusOf(t, alice, bob)).toEqual({ kind: "online" });
});

test("a Friend who leaves a Room's page is no longer In it", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await befriend(t, alice, bob);
  const { roomId } = await asUser(t, bob).mutation(api.rooms.create, {});
  await appHeartbeat(t, bob);
  const beat = await roomHeartbeat(t, bob, roomId);

  await t.mutation(api.presence.disconnect, {
    sessionToken: beat!.sessionToken,
  });

  expect(await statusOf(t, alice, bob)).toEqual({ kind: "online" });
});

test("a Friend who turns on Appear offline shows as Offline, even In a Room", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await befriend(t, alice, bob);
  const { roomId } = await asUser(t, bob).mutation(api.rooms.create, {});
  await appHeartbeat(t, bob);
  await roomHeartbeat(t, bob, roomId);

  await asUser(t, bob).mutation(api.users.setAppearOffline, {
    appearOffline: true,
  });

  expect(await statusOf(t, alice, bob)).toEqual({ kind: "offline" });
  expect(
    (await asUser(t, bob).query(api.friends.overview, {}))?.appearOffline,
  ).toBe(true);

  await asUser(t, bob).mutation(api.users.setAppearOffline, {
    appearOffline: false,
  });

  expect((await statusOf(t, alice, bob))?.kind).toBe("inRoom");
});

test("Guests cannot turn on Appear offline", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });

  await expect(
    asUser(t, guest).mutation(api.users.setAppearOffline, {
      appearOffline: true,
    }),
  ).rejects.toThrow();
});

test("Guests send no app heartbeat", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });

  expect(await appHeartbeat(t, guest)).toBeNull();
});

test("Friends who are Online or In a Room sort above Offline Friends", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const anna = await seedUser(t, { name: "Anna" });
  const zoe = await seedUser(t, { name: "Zoe" });
  const yves = await seedUser(t, { name: "Yves" });
  await befriend(t, alice, anna);
  await befriend(t, alice, zoe);
  await befriend(t, alice, yves);
  await appHeartbeat(t, zoe);
  const { roomId } = await asUser(t, yves).mutation(api.rooms.create, {});
  await roomHeartbeat(t, yves, roomId);

  const overview = await asUser(t, alice).query(api.friends.overview, {});

  expect(overview?.friends.map((f) => f.name)).toEqual(["Yves", "Zoe", "Anna"]);
});
