import { afterEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { posthog } from "../posthog";
import {
  asUser,
  resetRateLimit,
  seedUser,
  setupTest,
} from "../testHelpers.test";

type Test = ReturnType<typeof setupTest>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function sendMany(t: Test, sender: Id<"users">, count: number) {
  const targets: Id<"users">[] = [];
  for (let i = 0; i < count; i++) {
    const target = await seedUser(t);
    await resetRateLimit(t, "friendRequest", sender);
    await asUser(t, sender).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: target,
    });
    targets.push(target);
  }
  return targets;
}

async function befriendMany(t: Test, user: Id<"users">, count: number) {
  for (let i = 0; i < count; i++) {
    const friend = await seedUser(t);
    await asUser(t, friend).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: user,
    });
    await asUser(t, user).mutation(api.friends.answerRequest, {
      userId: friend,
      answer: "accept",
    });
  }
}

test("a sent Friend request shows as Requested to the sender and incoming to the recipient", async () => {
  const t = setupTest();
  const alice = await seedUser(t, { name: "Alice" });
  const bob = await seedUser(t, { name: "Bob" });

  const result = await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });

  expect(result).toEqual({ status: "requested" });
  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: bob }),
  ).toBe("requested");
  expect(
    await asUser(t, bob).query(api.friends.relationship, { userId: alice }),
  ).toBe("incoming");
});

test("accepting a Friend request makes both users Friends", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });

  await asUser(t, bob).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "accept",
  });

  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: bob }),
  ).toBe("friends");
  expect(
    await asUser(t, bob).query(api.friends.relationship, { userId: alice }),
  ).toBe("friends");
});

test("a declined Friend request still shows Requested to the sender and disappears for the recipient", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });

  await asUser(t, bob).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "decline",
  });

  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: bob }),
  ).toBe("requested");
  expect(
    await asUser(t, bob).query(api.friends.relationship, { userId: alice }),
  ).toBe("none");
  await expect(
    asUser(t, bob).mutation(api.friends.answerRequest, {
      userId: alice,
      answer: "accept",
    }),
  ).rejects.toMatchObject({ data: { code: "friendRequestNotFound" } });
});

test("only the recipient can answer a Friend request", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });

  await expect(
    asUser(t, alice).mutation(api.friends.answerRequest, {
      userId: bob,
      answer: "accept",
    }),
  ).rejects.toMatchObject({ data: { code: "friendRequestNotFound" } });
});

test("the sender can cancel a pending Friend request", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });

  await asUser(t, alice).mutation(api.friends.cancelRequest, { userId: bob });

  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: bob }),
  ).toBe("none");
  expect(
    await asUser(t, bob).query(api.friends.relationship, { userId: alice }),
  ).toBe("none");
});

test("the recipient can't cancel a Friend request, and cancelling doesn't unfriend", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  const carol = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: carol,
  });
  await asUser(t, carol).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "accept",
  });

  await expect(
    asUser(t, bob).mutation(api.friends.cancelRequest, { userId: alice }),
  ).rejects.toMatchObject({ data: { code: "friendRequestNotFound" } });
  await expect(
    asUser(t, alice).mutation(api.friends.cancelRequest, { userId: carol }),
  ).rejects.toMatchObject({ data: { code: "friendRequestNotFound" } });
  expect(
    await asUser(t, bob).query(api.friends.relationship, { userId: alice }),
  ).toBe("incoming");
  expect(
    await asUser(t, carol).query(api.friends.relationship, { userId: alice }),
  ).toBe("friends");
});

test("sending to someone whose request to you is pending makes you Friends", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });

  const result = await asUser(t, bob).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });

  expect(result).toEqual({ status: "friends" });
  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: bob }),
  ).toBe("friends");
});

test("sending after declining their request makes you Friends", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });
  await asUser(t, bob).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "decline",
  });

  const result = await asUser(t, bob).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });

  expect(result).toEqual({ status: "friends" });
});

test("sending again to a pending target or a Friend changes nothing", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  const carol = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: carol,
  });
  await asUser(t, carol).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "accept",
  });

  expect(
    await asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: bob,
    }),
  ).toEqual({ status: "requested" });
  expect(
    await asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: carol,
    }),
  ).toEqual({ status: "friends" });
  expect(
    await asUser(t, bob).query(api.friends.relationship, { userId: alice }),
  ).toBe("incoming");
  expect(await asUser(t, alice).query(api.friends.overview, {})).toMatchObject({
    friends: [{ id: carol }],
    incoming: [],
    outgoing: [{ id: bob }],
  });
});

test("Friend requests are rejected when a Guest is on either side", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });

  await expect(
    asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: guest,
    }),
  ).rejects.toMatchObject({ data: { code: "friendsNeedAccount" } });
  await expect(
    asUser(t, guest).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: alice,
    }),
  ).rejects.toMatchObject({ data: { code: "friendsNeedAccount" } });
});

test("no relationship is shown for a Guest, to a Guest, or for yourself", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });

  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: guest }),
  ).toBeNull();
  expect(
    await asUser(t, guest).query(api.friends.relationship, { userId: alice }),
  ).toBeNull();
  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: alice }),
  ).toBeNull();
  expect(await t.query(api.friends.relationship, { userId: alice })).toBeNull();
});

test("the friends overview is empty for a new user and null for a Guest", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });

  expect(await asUser(t, alice).query(api.friends.overview, {})).toEqual({
    friends: [],
    incoming: [],
    moreIncoming: false,
    outgoing: [],
    appearOffline: false,
    invites: [],
    room: null,
  });
  expect(await asUser(t, guest).query(api.friends.overview, {})).toBeNull();
});

test("sending stops at 50 pending outgoing Friend requests", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const [first] = await sendMany(t, alice, 50);
  const extra = await seedUser(t);
  await resetRateLimit(t, "friendRequest", alice);

  await expect(
    asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: extra,
    }),
  ).rejects.toMatchObject({ data: { code: "friendRequestLimit" } });

  await asUser(t, alice).mutation(api.friends.cancelRequest, { userId: first });
  expect(
    await asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: extra,
    }),
  ).toEqual({ status: "requested" });
});

test("declined requests still count toward the 50 pending outgoing", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const targets = await sendMany(t, alice, 50);
  await asUser(t, targets[0]).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "decline",
  });
  await resetRateLimit(t, "friendRequest", alice);

  await expect(
    asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: await seedUser(t),
    }),
  ).rejects.toMatchObject({ data: { code: "friendRequestLimit" } });
});

test("Friend requests stop at 200 Friends on either side", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const early = await seedUser(t);
  const late = await seedUser(t);
  await asUser(t, early).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });
  await befriendMany(t, alice, 200);
  await resetRateLimit(t, "friendRequest", alice);

  await expect(
    asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: late,
    }),
  ).rejects.toMatchObject({ data: { code: "friendLimit" } });
  await expect(
    asUser(t, late).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: alice,
    }),
  ).rejects.toMatchObject({ data: { code: "friendLimitOther" } });
  await expect(
    asUser(t, alice).mutation(api.friends.answerRequest, {
      userId: early,
      answer: "accept",
    }),
  ).rejects.toMatchObject({ data: { code: "friendLimit" } });
  await expect(
    asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: early,
    }),
  ).rejects.toMatchObject({ data: { code: "friendLimit" } });
  expect(
    await asUser(t, early).query(api.friends.relationship, { userId: alice }),
  ).toBe("requested");
}, 30_000);

test("sending Friend requests is rate-limited", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const sendToNewUser = async () =>
    asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: await seedUser(t),
    });
  for (let i = 0; i < 20; i++) await sendToNewUser();

  await expect(sendToNewUser()).rejects.toMatchObject({
    data: { code: "rateLimited" },
  });
});

test("sending, accepting and crossing Friend requests record analytics", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  const carol = await seedUser(t);

  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });
  await asUser(t, bob).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "accept",
  });
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: carol,
  });
  await asUser(t, carol).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });

  const events = capture.mock.calls.map(([, event]) => ({
    distinctId: event.distinctId,
    event: event.event,
    properties: event.properties,
  }));
  expect(events).toEqual([
    {
      distinctId: alice,
      event: "friend_request_sent",
      properties: expect.objectContaining({
        recipient_user_id: bob,
        via: "profile",
      }),
    },
    {
      distinctId: bob,
      event: "friend_added",
      properties: expect.objectContaining({
        friend_user_id: alice,
        via: "accept",
      }),
    },
    {
      distinctId: alice,
      event: "friend_request_sent",
      properties: expect.objectContaining({ recipient_user_id: carol }),
    },
    {
      distinctId: carol,
      event: "friend_added",
      properties: expect.objectContaining({
        friend_user_id: alice,
        via: "crossed_request",
      }),
    },
  ]);
});

test("the friends overview lists Friends and pending requests both ways, hiding declined ones from the recipient", async () => {
  const t = setupTest();
  const alice = await seedUser(t, { name: "Alice" });
  const bob = await seedUser(t, { name: "Bob", username: "bob" });
  const carol = await seedUser(t, { name: "Carol" });
  const dave = await seedUser(t, { name: "Dave" });
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });
  await asUser(t, bob).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "accept",
  });
  await asUser(t, carol).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });
  await asUser(t, dave).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });
  await asUser(t, alice).mutation(api.friends.answerRequest, {
    userId: dave,
    answer: "decline",
  });

  expect(await asUser(t, alice).query(api.friends.overview, {})).toEqual({
    friends: [
      expect.objectContaining({ id: bob, name: "Bob", username: "bob" }),
    ],
    incoming: [expect.objectContaining({ id: carol, name: "Carol" })],
    moreIncoming: false,
    outgoing: [],
    appearOffline: false,
    invites: [],
    room: null,
  });
  expect(await asUser(t, dave).query(api.friends.overview, {})).toMatchObject({
    outgoing: [{ id: alice }],
  });
});

test("sends that change nothing don't spend the rate limit", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });

  for (let i = 0; i < 25; i++) {
    expect(
      await asUser(t, alice).mutation(api.friends.sendRequest, {
        via: "profile",
        userId: bob,
      }),
    ).toEqual({ status: "requested" });
  }
  await expect(
    asUser(t, alice).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: guest,
    }),
  ).rejects.toMatchObject({ data: { code: "friendsNeedAccount" } });
});

test("the friends overview lists 100 incoming requests and says when more are waiting", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const sendToAlice = async () =>
    asUser(t, await seedUser(t)).mutation(api.friends.sendRequest, {
      via: "profile",
      userId: alice,
    });
  for (let i = 0; i < 100; i++) await sendToAlice();

  const atLimit = await asUser(t, alice).query(api.friends.overview, {});
  expect(atLimit?.incoming).toHaveLength(100);
  expect(atLimit?.moreIncoming).toBe(false);

  await sendToAlice();
  const overLimit = await asUser(t, alice).query(api.friends.overview, {});
  expect(overLimit?.incoming).toHaveLength(100);
  expect(overLimit?.moreIncoming).toBe(true);
}, 30_000);

test("declining and cancelling Friend requests record analytics", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  const carol = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: carol,
  });
  capture.mockClear();

  await asUser(t, bob).mutation(api.friends.answerRequest, {
    userId: alice,
    answer: "decline",
  });
  await asUser(t, alice).mutation(api.friends.cancelRequest, { userId: carol });

  expect(
    capture.mock.calls.map(([, event]) => ({
      distinctId: event.distinctId,
      event: event.event,
      properties: event.properties,
    })),
  ).toEqual([
    {
      distinctId: bob,
      event: "friend_request_declined",
      properties: expect.objectContaining({ sender_user_id: alice }),
    },
    {
      distinctId: alice,
      event: "friend_request_cancelled",
      properties: expect.objectContaining({ recipient_user_id: carol }),
    },
  ]);
});

test("a Friend request can be sent by exact username, ignoring case", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t, {
    username: "bobby",
    displayUsername: "Bobby",
  });

  const result = await asUser(t, alice).mutation(
    api.friends.sendRequestByUsername,
    { username: " Bobby " },
  );

  expect(result).toEqual({ status: "requested" });
  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: bob }),
  ).toBe("requested");
});

test.each(["bob", "bobbyy", "obby"])(
  "a username that only partly matches (%s) is not found",
  async (username) => {
    const t = setupTest();
    const alice = await seedUser(t);
    await seedUser(t, { username: "bobby" });

    await expect(
      asUser(t, alice).mutation(api.friends.sendRequestByUsername, {
        username,
      }),
    ).rejects.toMatchObject({ data: { code: "userNotFound" } });
  },
);

async function makeFriends(t: Test, a: Id<"users">, b: Id<"users">) {
  await asUser(t, a).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: b,
  });
  await asUser(t, b).mutation(api.friends.answerRequest, {
    userId: a,
    answer: "accept",
  });
}

test.each(["requester", "recipient"] as const)(
  "the %s can unfriend, which removes the friendship for both",
  async (side) => {
    const t = setupTest();
    const alice = await seedUser(t);
    const bob = await seedUser(t);
    await makeFriends(t, alice, bob);
    const [actor, other] = side === "requester" ? [alice, bob] : [bob, alice];

    await asUser(t, actor).mutation(api.friends.unfriend, { userId: other });

    for (const [viewer, target] of [
      [actor, other],
      [other, actor],
    ]) {
      expect(
        await asUser(t, viewer).query(api.friends.relationship, {
          userId: target,
        }),
      ).toBe("none");
      const overview = await asUser(t, viewer).query(api.friends.overview, {});
      expect(overview).toMatchObject({
        friends: [],
        incoming: [],
        outgoing: [],
      });
    }
  },
);

test("either side can send a new Friend request after unfriending", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await makeFriends(t, alice, bob);
  await asUser(t, alice).mutation(api.friends.unfriend, { userId: bob });

  const result = await asUser(t, bob).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });

  expect(result).toEqual({ status: "requested" });
  expect(
    await asUser(t, alice).query(api.friends.relationship, { userId: bob }),
  ).toBe("incoming");
});

test("unfriending someone who isn't a Friend fails and leaves a pending request alone", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: bob,
  });

  await expect(
    asUser(t, bob).mutation(api.friends.unfriend, { userId: alice }),
  ).rejects.toMatchObject({ data: { code: "notFriends" } });
  expect(
    await asUser(t, bob).query(api.friends.relationship, { userId: alice }),
  ).toBe("incoming");
});

function roomClock() {
  vi.useFakeTimers();
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  vi.setSystemTime(now);
  return () => vi.setSystemTime((now += 1_000));
}

async function shareRoom(
  t: Test,
  host: Id<"users">,
  others: Id<"users">[],
  { end }: { end: boolean },
) {
  const room = await asUser(t, host).mutation(api.rooms.create, {});
  for (const other of others) {
    await asUser(t, other).mutation(api.rooms.join, { code: room.code });
  }
  if (end) {
    await asUser(t, host).mutation(api.rooms.endRoom, { roomId: room.roomId });
  }
  return room;
}

async function suggestedIds(t: Test, viewer: Id<"users">) {
  const suggestions = await asUser(t, viewer).query(
    api.friends.suggestions,
    {},
  );
  return suggestions.map((player) => player.id);
}

test("Friend suggestions are the 3 registered users most recently in a Room with you, ended or active", async () => {
  const tick = roomClock();
  const t = setupTest();
  const alice = await seedUser(t);
  const [bob, carol, dave, erin] = await Promise.all(
    ["Bob", "Carol", "Dave", "Erin"].map((name) => seedUser(t, { name })),
  );
  tick();
  await shareRoom(t, alice, [bob], { end: true });
  tick();
  await shareRoom(t, alice, [carol], { end: false });
  tick();
  await shareRoom(t, dave, [alice], { end: true });
  tick();
  await shareRoom(t, alice, [erin], { end: true });

  expect(await suggestedIds(t, alice)).toEqual([erin, dave, carol]);
});

test("Friend suggestions rank by a Room's latest activity, then by who joined it last", async () => {
  const tick = roomClock();
  const t = setupTest();
  const alice = await seedUser(t);
  const [bob, carol, dave] = await Promise.all(
    ["Bob", "Carol", "Dave"].map((name) => seedUser(t, { name })),
  );
  tick();
  const older = await shareRoom(t, alice, [bob], { end: false });
  tick();
  await shareRoom(t, alice, [carol], { end: true });
  tick();
  await asUser(t, dave).mutation(api.rooms.join, { code: older.code });

  expect(await suggestedIds(t, alice)).toEqual([dave, bob, carol]);
});

test("someone in several of your Rooms is suggested once", async () => {
  const tick = roomClock();
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  const carol = await seedUser(t);
  tick();
  await shareRoom(t, alice, [carol], { end: true });
  tick();
  await shareRoom(t, alice, [bob], { end: true });
  tick();
  await shareRoom(t, alice, [bob], { end: true });

  expect(await suggestedIds(t, alice)).toEqual([bob, carol]);
});

test("Friend suggestions leave out Friends, pending requests either way, and Guests", async () => {
  const tick = roomClock();
  const t = setupTest();
  const alice = await seedUser(t);
  const stranger = await seedUser(t);
  const friend = await seedUser(t);
  const requested = await seedUser(t);
  const incoming = await seedUser(t);
  const declined = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  await makeFriends(t, alice, friend);
  await asUser(t, alice).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: requested,
  });
  await asUser(t, incoming).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });
  await asUser(t, declined).mutation(api.friends.sendRequest, {
    via: "profile",
    userId: alice,
  });
  await asUser(t, alice).mutation(api.friends.answerRequest, {
    userId: declined,
    answer: "decline",
  });
  tick();
  await shareRoom(t, alice, [stranger], { end: true });
  tick();
  await shareRoom(t, alice, [friend, requested, incoming, declined, guest], {
    end: true,
  });

  expect(await suggestedIds(t, alice)).toEqual([stranger]);
});

test("unfriending makes someone you shared a Room with a suggestion again", async () => {
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t);
  await shareRoom(t, alice, [bob], { end: true });
  await makeFriends(t, alice, bob);
  expect(await suggestedIds(t, alice)).toEqual([]);

  await asUser(t, bob).mutation(api.friends.unfriend, { userId: alice });

  expect(await suggestedIds(t, alice)).toEqual([bob]);
});

test("Guests get no Friend suggestions", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const bob = await seedUser(t);
  await shareRoom(t, bob, [guest], { end: true });

  expect(await suggestedIds(t, guest)).toEqual([]);
});

test.each(["profile", "room", "suggestion"] as const)(
  "a Friend request sent from a %s records where it came from",
  async (via) => {
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
    vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
    const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
    const t = setupTest();
    const alice = await seedUser(t);
    const bob = await seedUser(t);

    await asUser(t, alice).mutation(api.friends.sendRequest, {
      userId: bob,
      via,
    });

    expect(capture).toHaveBeenCalledWith(expect.anything(), {
      distinctId: alice,
      event: "friend_request_sent",
      properties: {
        recipient_user_id: bob,
        via,
        deployment_environment: "production",
      },
    });
  },
);

test("a Friend request sent by username records that it came from the username lookup", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "test-token");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  const capture = vi.spyOn(posthog, "capture").mockResolvedValue(undefined);
  const t = setupTest();
  const alice = await seedUser(t);
  const bob = await seedUser(t, { username: "bob" });

  await asUser(t, alice).mutation(api.friends.sendRequestByUsername, {
    username: "bob",
  });

  expect(capture).toHaveBeenCalledWith(expect.anything(), {
    distinctId: alice,
    event: "friend_request_sent",
    properties: {
      recipient_user_id: bob,
      via: "username",
      deployment_environment: "production",
    },
  });
});
