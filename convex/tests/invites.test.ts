import { afterEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { depart } from "../lib/roomMembership";
import { posthog } from "../posthog";
import { asUser, seedUser, setupTest } from "../testHelpers.test";

type Test = ReturnType<typeof setupTest>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function befriend(t: Test, a: Id<"users">, b: Id<"users">) {
  await asUser(t, a).mutation(api.friends.sendRequest, { userId: b });
  await asUser(t, b).mutation(api.friends.answerRequest, {
    userId: a,
    answer: "accept",
  });
}

// A host in a fresh Room, and a Friend of theirs who isn't in it.
async function roomWithFriend(t: Test) {
  const host = await seedUser(t, { name: "Host" });
  const friend = await seedUser(t, { name: "Friend" });
  await befriend(t, host, friend);
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  return { host, friend, roomId, code };
}

async function sendInvite(
  t: Test,
  sender: Id<"users">,
  roomId: Id<"rooms">,
  userId: Id<"users">,
) {
  await asUser(t, sender).mutation(api.friends.invite, { roomId, userId });
}

async function openInviteId(t: Test, recipient: Id<"users">) {
  const [invite] = (await overview(t, recipient)).invites;
  if (invite === undefined) throw new Error("expected an open Invite");
  return invite._id;
}

// Seeded sessions last a minute; these tests wait for longer.
async function keepSignedIn(t: Test) {
  await t.run(async (ctx) => {
    for (const session of await ctx.db.query("authSessions").collect()) {
      await ctx.db.patch("authSessions", session._id, {
        expirationTime: Date.now() + 60 * 60_000,
      });
    }
  });
}

async function advance(t: Test, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

async function overview(t: Test, userId: Id<"users">, roomId?: Id<"rooms">) {
  const result = await asUser(t, userId).query(api.friends.overview, {
    roomId,
  });
  if (result === null) throw new Error("expected a registered viewer");
  return result;
}

test("an invited Friend sees the Invite and the sender sees them as Invited, even while they are offline", async () => {
  const t = setupTest();
  const { host, friend, roomId, code } = await roomWithFriend(t);

  await asUser(t, host).mutation(api.friends.invite, {
    roomId,
    userId: friend,
  });

  const recipientView = await overview(t, friend);
  expect(recipientView.invites).toEqual([
    expect.objectContaining({
      roomCode: code,
      sender: expect.objectContaining({ id: host, name: "Host" }),
    }),
  ]);
  const senderView = await overview(t, host, roomId);
  expect(senderView.room).toEqual({ invited: [friend], members: [] });
});

test("joining through an Invite admits the recipient, ends the Invite, and keeps their other Rooms", async () => {
  const t = setupTest();
  const { host, friend, roomId, code } = await roomWithFriend(t);
  const { roomId: otherRoomId } = await asUser(t, friend).mutation(
    api.rooms.create,
    {},
  );
  await asUser(t, host).mutation(api.friends.invite, {
    roomId,
    userId: friend,
  });
  const [{ _id: inviteId }] = (await overview(t, friend)).invites;

  const result = await asUser(t, friend).mutation(api.friends.answerInvite, {
    inviteId,
    answer: "join",
  });

  expect(result).toEqual({ code });
  const mine = await asUser(t, friend).query(api.rooms.listMine, {});
  expect(mine.map((room) => room._id).sort()).toEqual(
    [roomId, otherRoomId].sort(),
  );
  expect((await overview(t, friend)).invites).toEqual([]);
  expect((await overview(t, host, roomId)).room).toEqual({
    invited: [],
    members: [friend],
  });
});

test("declining ends the Invite for both people without admitting the recipient", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await sendInvite(t, host, roomId, friend);

  const result = await asUser(t, friend).mutation(api.friends.answerInvite, {
    inviteId: await openInviteId(t, friend),
    answer: "decline",
  });

  expect(result).toBeNull();
  expect((await overview(t, friend)).invites).toEqual([]);
  expect((await overview(t, host, roomId)).room).toEqual({
    invited: [],
    members: [],
  });
  expect(await asUser(t, friend).query(api.rooms.listMine, {})).toEqual([]);
});

test("only the recipient can answer an Invite", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await sendInvite(t, host, roomId, friend);
  const inviteId = await openInviteId(t, friend);

  for (const answer of ["join", "decline"] as const) {
    await expect(
      asUser(t, host).mutation(api.friends.answerInvite, { inviteId, answer }),
    ).rejects.toMatchObject({ data: { code: "inviteNotFound" } });
  }
  expect((await overview(t, friend)).invites).toHaveLength(1);
});

test("any live member can invite their own Friends, Host or not", async () => {
  const t = setupTest();
  const { host, code, roomId } = await roomWithFriend(t);
  const member = await seedUser(t, { name: "Member" });
  const membersFriend = await seedUser(t);
  await befriend(t, member, membersFriend);
  await asUser(t, member).mutation(api.rooms.join, { code });

  await sendInvite(t, member, roomId, membersFriend);

  expect((await overview(t, membersFriend)).invites).toEqual([
    expect.objectContaining({
      sender: expect.objectContaining({ id: member }),
    }),
  ]);
  await expect(
    sendInvite(t, host, roomId, membersFriend),
  ).rejects.toMatchObject({ data: { code: "notFriends" } });
});

test("someone outside the Room can't invite to it", async () => {
  const t = setupTest();
  const { roomId } = await roomWithFriend(t);
  const outsider = await seedUser(t);
  const outsidersFriend = await seedUser(t);
  await befriend(t, outsider, outsidersFriend);

  await expect(
    sendInvite(t, outsider, roomId, outsidersFriend),
  ).rejects.toMatchObject({ data: { code: "notMember" } });
});

test("nobody can invite to an ended Room", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });

  await expect(sendInvite(t, host, roomId, friend)).rejects.toMatchObject({
    data: { code: "roomNotFound" },
  });
});

test("a Friend already in the Room can't be invited", async () => {
  const t = setupTest();
  const { host, friend, roomId, code } = await roomWithFriend(t);
  await asUser(t, friend).mutation(api.rooms.join, { code });

  await expect(sendInvite(t, host, roomId, friend)).rejects.toMatchObject({
    data: { code: "alreadyInRoom" },
  });
  expect((await overview(t, friend)).invites).toEqual([]);
});

test("Guests can't invite and can't be invited", async () => {
  const t = setupTest();
  const { host, roomId, code } = await roomWithFriend(t);
  const guest = await seedUser(t, { isAnonymous: true });
  await asUser(t, guest).mutation(api.rooms.join, { code });

  await expect(sendInvite(t, host, roomId, guest)).rejects.toMatchObject({
    data: { code: "notFriends" },
  });
  await expect(sendInvite(t, guest, roomId, host)).rejects.toThrow(
    "Registered account required",
  );
});

test("joining the Room by its code ends the Invite", async () => {
  const t = setupTest();
  const { host, friend, roomId, code } = await roomWithFriend(t);
  await sendInvite(t, host, roomId, friend);

  await asUser(t, friend).mutation(api.rooms.join, { code });

  expect((await overview(t, friend)).invites).toEqual([]);
  expect((await overview(t, host, roomId)).room).toEqual({
    invited: [],
    members: [friend],
  });
});

test("ending the Room ends its Invites", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await sendInvite(t, host, roomId, friend);
  const inviteId = await openInviteId(t, friend);

  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });

  expect((await overview(t, friend)).invites).toEqual([]);
  await expect(
    asUser(t, friend).mutation(api.friends.answerInvite, {
      inviteId,
      answer: "join",
    }),
  ).rejects.toMatchObject({ data: { code: "inviteNotFound" } });
});

test("a Room that ends when its last member leaves ends its Invites", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await sendInvite(t, host, roomId, friend);

  await asUser(t, host).mutation(api.rooms.leave, { roomId });

  expect((await overview(t, friend)).invites).toEqual([]);
});

test("an Invite ends after 5 minutes", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await keepSignedIn(t);
  await sendInvite(t, host, roomId, friend);

  await advance(t, 5 * 60_000 - 1);
  expect((await overview(t, friend)).invites).toHaveLength(1);

  await advance(t, 1);
  expect((await overview(t, friend)).invites).toEqual([]);
  expect((await overview(t, host, roomId)).room?.invited).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("invites").collect())).toEqual([]);
});

test("an Invite past its 5 minutes is ended even before its expiry runs", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await keepSignedIn(t);
  await sendInvite(t, host, roomId, friend);
  const inviteId = await openInviteId(t, friend);

  vi.advanceTimersByTime(5 * 60_000);

  expect((await overview(t, friend)).invites).toEqual([]);
  expect((await overview(t, host, roomId)).room?.invited).toEqual([]);
  await expect(
    asUser(t, friend).mutation(api.friends.answerInvite, {
      inviteId,
      answer: "join",
    }),
  ).rejects.toMatchObject({ data: { code: "inviteNotFound" } });
});

test("inviting again restarts the 5 minutes and shows the latest sender", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const { host, friend, roomId, code } = await roomWithFriend(t);
  const member = await seedUser(t, { name: "Member" });
  await befriend(t, member, friend);
  await asUser(t, member).mutation(api.rooms.join, { code });
  await keepSignedIn(t);
  await sendInvite(t, host, roomId, friend);

  await advance(t, 4 * 60_000);
  await sendInvite(t, member, roomId, friend);
  await advance(t, 4 * 60_000);

  expect((await overview(t, friend)).invites).toEqual([
    expect.objectContaining({
      sender: expect.objectContaining({ id: member }),
    }),
  ]);
  await advance(t, 60_000);
  expect((await overview(t, friend)).invites).toEqual([]);
});

test("inviting is rate-limited", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);

  await expect(async () => {
    for (let i = 0; i < 100; i++) await sendInvite(t, host, roomId, friend);
  }).rejects.toMatchObject({ data: { code: "rateLimited" } });
});

test("sending and joining through an Invite record analytics events", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  capture.mockClear();

  await sendInvite(t, host, roomId, friend);
  await sendInvite(t, host, roomId, friend);
  await asUser(t, friend).mutation(api.friends.answerInvite, {
    inviteId: await openInviteId(t, friend),
    answer: "join",
  });

  const events = capture.mock.calls.map(([, event]) => event);
  expect(events).toEqual([
    {
      distinctId: host,
      event: "invite_sent",
      properties: {
        room_id: roomId,
        recipient_user_id: friend,
        resent: false,
        deployment_environment: "production",
      },
    },
    {
      distinctId: host,
      event: "invite_sent",
      properties: {
        room_id: roomId,
        recipient_user_id: friend,
        resent: true,
        deployment_environment: "production",
      },
    },
    {
      distinctId: friend,
      event: "room_joined",
      properties: {
        room_id: roomId,
        member_count: 2,
        deployment_environment: "production",
      },
    },
    {
      distinctId: friend,
      event: "invite_joined",
      properties: {
        room_id: roomId,
        sender_user_id: host,
        deployment_environment: "production",
      },
    },
  ]);
});

test("the Room view is only given to its members", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await sendInvite(t, host, roomId, friend);

  expect((await overview(t, friend, roomId)).room).toBeNull();
});

test("the toast's Invite list matches the panel's, and is empty when signed out", async () => {
  const t = setupTest();
  const { host, friend, roomId } = await roomWithFriend(t);
  await sendInvite(t, host, roomId, friend);

  expect(await asUser(t, friend).query(api.friends.openInvites, {})).toEqual(
    (await overview(t, friend)).invites,
  );
  expect(await t.query(api.friends.openInvites, {})).toEqual([]);
});

test("a Guest who signs in to an invited account ends that account's Invite to a Room the Guest was in", async () => {
  const t = setupTest();
  const { host, friend, roomId, code } = await roomWithFriend(t);
  const guest = await seedUser(t, { isAnonymous: true });
  await asUser(t, guest).mutation(api.rooms.join, { code });
  await sendInvite(t, host, roomId, friend);

  await t.run(async (ctx) => {
    await depart(
      ctx,
      roomId,
      { reason: "merged", userId: guest, into: friend },
      Date.now(),
    );
  });

  expect((await overview(t, friend)).invites).toEqual([]);
  expect((await overview(t, host, roomId)).room).toEqual({
    invited: [],
    members: [friend],
  });
});
