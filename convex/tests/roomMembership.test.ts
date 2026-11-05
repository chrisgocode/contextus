import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { startGuestMerge } from "../lib/guestMerge";
import {
  IDLE_TIMEOUT_MS,
  admit,
  closeRoom,
  openRoom,
} from "../lib/roomMembership";
import {
  asUser,
  finishScheduledFunctions,
  seedUser,
  sessionOf,
  setupTest,
} from "../testHelpers.test";

afterEach(() => {
  vi.useRealTimers();
});

type T = ReturnType<typeof setupTest>;

type Seeded = {
  t: T;
  roomId: Id<"rooms">;
  code: string;
  host: Id<"users">;
  // Joined in this order, after the Host. Empty when the Host is alone.
  first?: Id<"users">;
  second?: Id<"users">;
  // The registered account a Guest Host signs in to.
  account: Id<"users">;
};

type Scenario = {
  reason: "left" | "expired" | "merged" | "idle";
  name: string;
  hostIsGuest?: boolean;
  alone?: boolean;
  online?: ("first" | "second")[];
  depart: (s: Seeded) => Promise<void>;
  // Who hosts afterwards, or null when the Room ends.
  host: "first" | "second" | "account" | null;
};

async function expectHostInvariant(t: T, roomId: Id<"rooms">) {
  const { room, membership } = await t.run(async (ctx) => {
    const room = await ctx.db.get("rooms", roomId);
    if (room === null) throw new Error("missing room");
    const membership = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_user", (q) =>
        q.eq("roomId", roomId).eq("userId", room.hostUserId),
      )
      .unique();
    return { room, membership };
  });
  const hostIsLive = membership !== null && membership.active !== false;
  expect(room.status === "ended" || hostIsLive).toBe(true);
  return room;
}

async function leave({ t, roomId, host }: Seeded) {
  await asUser(t, host).mutation(api.rooms.leave, { roomId });
}

async function expire({ t }: Seeded) {
  await t.mutation(internal.cleanup.removeExpiredGuests, {});
}

// Checks the invariant after the first batch too: the Host and their
// membership have to reach the account in the same transaction.
async function signIn({ t, roomId, host, account }: Seeded) {
  const session = sessionOf(t, host);
  const mergeId = await t.run((ctx) => startGuestMerge(ctx, session, account));
  if (mergeId === null) throw new Error("merge did not start");
  await t.mutation(internal.guestMerge.runBatch, { mergeId });
  await expectHostInvariant(t, roomId);
  await finishScheduledFunctions(t);
}

async function cleanUp({ t, roomId }: Seeded) {
  await t.mutation(internal.cleanup._cleanupRoom, { roomId });
}

const scenarios: Scenario[] = [
  {
    reason: "left",
    name: "the Host leaves",
    depart: leave,
    host: "first",
  },
  {
    reason: "left",
    name: "the Host leaves while only a later member is online",
    online: ["second"],
    depart: leave,
    host: "second",
  },
  {
    reason: "left",
    name: "the last member leaves",
    alone: true,
    depart: leave,
    host: null,
  },
  {
    reason: "expired",
    name: "a Guest Host expires",
    hostIsGuest: true,
    depart: expire,
    host: "first",
  },
  {
    reason: "expired",
    name: "a Guest Host expires while only a later member is online",
    hostIsGuest: true,
    online: ["second"],
    depart: expire,
    host: "second",
  },
  {
    reason: "expired",
    name: "a Guest hosting alone expires",
    hostIsGuest: true,
    alone: true,
    depart: expire,
    host: null,
  },
  {
    reason: "merged",
    name: "a Guest Host signs in",
    hostIsGuest: true,
    depart: signIn,
    host: "account",
  },
  {
    reason: "merged",
    name: "a Guest Host signs in to an account already in the Room",
    hostIsGuest: true,
    depart: async (s) => {
      await asUser(s.t, s.account).mutation(api.rooms.join, { code: s.code });
      await signIn(s);
    },
    host: "account",
  },
  {
    reason: "idle",
    name: "the Host is offline while later members are online",
    online: ["second"],
    depart: cleanUp,
    host: "second",
  },
  {
    reason: "idle",
    name: "the Host is offline while every other member is online",
    online: ["second", "first"],
    depart: cleanUp,
    host: "first",
  },
  {
    reason: "idle",
    name: "everyone is offline past the idle timeout",
    depart: async (s) => {
      vi.setSystemTime(Date.now() + IDLE_TIMEOUT_MS + 1000);
      await cleanUp(s);
    },
    host: null,
  },
];

test.each(scenarios)(
  "$reason: the Host is a live member or the Room is ended when $name",
  async (scenario) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const t = setupTest();
    const host = await seedUser(
      t,
      scenario.hostIsGuest ? { isAnonymous: true, guestExpiresAt: 1 } : {},
    );
    const account = await seedUser(t);
    const { roomId, code } = await asUser(t, host).mutation(
      api.rooms.create,
      {},
    );
    const seeded: Seeded = { t, roomId, code, host, account };
    if (!scenario.alone) {
      for (const key of ["first", "second"] as const) {
        vi.advanceTimersByTime(1000);
        const member = await seedUser(t);
        await asUser(t, member).mutation(api.rooms.join, { code });
        seeded[key] = member;
      }
    }
    for (const key of scenario.online ?? []) {
      const userId = seeded[key]!;
      await asUser(t, userId).mutation(api.presence.heartbeat, {
        roomId,
        userId,
        sessionId: `s-${userId}`,
        interval: 10000,
      });
    }

    await scenario.depart(seeded);

    const room = await expectHostInvariant(t, roomId);
    if (scenario.host === null) {
      expect(room.status).toBe("ended");
    } else {
      expect(room).toMatchObject({
        status: "active",
        hostUserId: seeded[scenario.host],
      });
    }
  },
);

test.each(["left", "expired", "merged", "idle"] as const)(
  "%s: becoming Host withdraws both types of Pending request",
  async (reason) => {
    vi.useFakeTimers();
    const t = setupTest();
    const host = await seedUser(t, { isAnonymous: true, guestExpiresAt: 1 });
    const member = await seedUser(t);
    const { roomId, code } = await asUser(t, host).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });
    const { gameId } = await asUser(t, host).mutation(api.games.start, {
      roomId,
      contextoGameId: 1336,
    });
    for (const type of ["hint", "giveup"] as const) {
      await asUser(t, member).mutation(api.requests.create, { gameId, type });
    }

    switch (reason) {
      case "left":
        await asUser(t, host).mutation(api.rooms.leave, { roomId });
        break;
      case "expired":
        await t.mutation(internal.cleanup.removeExpiredGuests, {});
        break;
      case "merged": {
        const mergeId = await t.run((ctx) =>
          startGuestMerge(ctx, sessionOf(t, host), member),
        );
        if (mergeId === null) throw new Error("merge did not start");
        // Observe the atomic membership/Host handoff before request expiry or
        // any later merge batch can hide a missing withdrawal.
        await t.mutation(internal.guestMerge.runBatch, { mergeId });
        break;
      }
      case "idle":
        await asUser(t, member).mutation(api.presence.heartbeat, {
          roomId,
          userId: member,
          sessionId: "member",
          interval: 10000,
        });
        await t.mutation(internal.cleanup._cleanupRoom, { roomId });
        break;
    }

    expect(
      await asUser(t, member).query(api.rooms.getByCode, { code }),
    ).toMatchObject({
      room: { hostUserId: member, status: "active" },
    });
    expect(
      await asUser(t, member).query(api.requests.listPending, { gameId }),
    ).toEqual([]);
  },
);

test("a Guest who is not the Host expires without moving the Host", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true, guestExpiresAt: 1 });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.join, { code });

  await t.mutation(internal.cleanup.removeExpiredGuests, {});

  const room = await asUser(t, host).query(api.rooms.getByCode, { code });
  expect(room?.room).toMatchObject({ _id: roomId, hostUserId: host });
  expect(room?.members.map((m) => m.userId)).toEqual([host]);
});

test("an expired Guest's pending request is withdrawn and a handled one is kept", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true, guestExpiresAt: 1 });
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await asUser(t, guest).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  const [denied] = await asUser(t, host).query(api.requests.listPending, {
    gameId,
  });
  await asUser(t, host).mutation(api.requests.deny, {
    requestId: denied._id,
  });
  await asUser(t, guest).mutation(api.requests.create, {
    gameId,
    type: "giveup",
  });

  await t.mutation(internal.cleanup.removeExpiredGuests, {});

  const requests = await t.run((ctx) =>
    ctx.db.query("pendingRequests").collect(),
  );
  expect(requests).toEqual([
    expect.objectContaining({
      requesterUserId: guest,
      type: "hint",
      status: "denied",
    }),
  ]);
});

test("expiring a Guest who hosted many ended Rooms counts the members it reads", async () => {
  const t = setupTest({ transactionLimits: { documentsRead: 200 } });
  const guest = await seedUser(t, { isAnonymous: true, guestExpiresAt: 1 });
  const members = await Promise.all(
    Array.from({ length: 20 }, () => seedUser(t)),
  );
  for (let i = 0; i < 12; i++) {
    await t.run(async (ctx) => {
      const roomId = await openRoom(
        ctx,
        { code: `ENDED${i}`, hostUserId: guest },
        i,
      );
      for (const member of members) await admit(ctx, roomId, member, i);
      await closeRoom(ctx, roomId);
    });
  }

  await t.mutation(internal.cleanup.removeExpiredGuests, {});
  await finishScheduledFunctions(t);

  const result = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", guest),
    memberships: await ctx.db
      .query("roomMembers")
      .withIndex("by_user", (q) => q.eq("userId", guest))
      .collect(),
    hosted: await ctx.db
      .query("rooms")
      .withIndex("by_host_user", (q) => q.eq("hostUserId", guest))
      .collect(),
  }));
  expect(result.user).toMatchObject({ name: "Former Guest" });
  expect(result.memberships).toEqual([]);
  expect(result.hosted).toEqual([]);
});

test("an ended Room's Host moves to a remaining member when the Host leaves", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const member = await seedUser(t);
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, member).mutation(api.rooms.join, { code });
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });

  await asUser(t, host).mutation(api.rooms.leave, { roomId });

  const room = await t.run((ctx) => ctx.db.get("rooms", roomId));
  expect(room).toMatchObject({ status: "ended", hostUserId: member });
});

test("reopening restores the retained Game and memberships and withdraws the new Host's requests", async () => {
  vi.useFakeTimers();
  const t = setupTest();
  const host = await seedUser(t);
  const member = await seedUser(t);
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, member).mutation(api.rooms.join, { code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId,
    contextoGameId: 1336,
  });
  await asUser(t, member).mutation(api.requests.create, {
    gameId,
    type: "hint",
  });
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });
  expect(
    await asUser(t, member).query(api.games.getActive, { roomId }),
  ).toMatchObject({ _id: gameId, status: "in_progress" });
  await expect(
    asUser(t, member).mutation(api.requests.create, { gameId, type: "giveup" }),
  ).rejects.toThrow();
  expect(await asUser(t, host).query(api.rooms.listMine, {})).toEqual([]);

  const replay = await asUser(t, member).mutation(api.rooms.playAgain, {
    roomId,
  });

  expect(
    await asUser(t, host).query(api.games.getActive, { roomId }),
  ).toMatchObject({
    _id: gameId,
    status: "in_progress",
  });
  expect(
    await asUser(t, member).query(api.rooms.getByCode, { code: replay.code }),
  ).toMatchObject({
    room: { status: "active", hostUserId: member },
    members: expect.arrayContaining([
      expect.objectContaining({ userId: host }),
      expect.objectContaining({ userId: member }),
    ]),
  });
  expect(await asUser(t, host).query(api.rooms.listMine, {})).toEqual([
    expect.objectContaining({ _id: roomId }),
  ]);
  expect(
    await asUser(t, member).query(api.requests.listPending, { gameId }),
  ).toEqual([]);
});

test.each([true, undefined, false])(
  "Host succession respects membership active=%s without migrating legacy rows",
  async (active) => {
    vi.useFakeTimers();
    const t = setupTest();
    const host = await seedUser(t);
    const first = await seedUser(t);
    const second = await seedUser(t);
    const { roomId, code } = await asUser(t, host).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, first).mutation(api.rooms.join, { code });
    vi.advanceTimersByTime(1);
    await asUser(t, second).mutation(api.rooms.join, { code });
    // Fixture for a legacy or explicitly inactive membership. All observations
    // below use public APIs, including authorization after succession.
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query("roomMembers")
        .withIndex("by_room_user", (q) =>
          q.eq("roomId", roomId).eq("userId", first),
        )
        .unique();
      await ctx.db.patch("roomMembers", member!._id, { active });
    });

    await asUser(t, host).mutation(api.rooms.leave, { roomId });

    const successor = active === false ? second : first;
    expect(
      await asUser(t, successor).query(api.rooms.getByCode, { code }),
    ).toMatchObject({
      room: { status: "active", hostUserId: successor },
      isViewerHost: true,
    });
    await expect(
      asUser(t, successor).mutation(api.games.start, {
        roomId,
        contextoGameId: 1336,
      }),
    ).resolves.toHaveProperty("gameId");
  },
);

test.each(["before", "after"] as const)(
  "a disconnected Host returns %s cleanup: the online incumbent stays Host",
  async (returning) => {
    vi.useFakeTimers();
    const t = setupTest();
    const host = await seedUser(t);
    const member = await seedUser(t);
    const { roomId, code } = await asUser(t, host).mutation(
      api.rooms.create,
      {},
    );
    await asUser(t, member).mutation(api.rooms.join, { code });
    const heartbeat = (userId: Id<"users">) =>
      asUser(t, userId).mutation(api.presence.heartbeat, {
        roomId,
        userId,
        sessionId: `session-${userId}`,
        interval: 10000,
      });
    const connection = await heartbeat(host);
    await asUser(t, host).mutation(api.presence.disconnect, {
      sessionToken: connection!.sessionToken,
    });
    await heartbeat(member);
    if (returning === "before") await heartbeat(host);
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });
    if (returning === "after") await heartbeat(host);
    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    expect(
      await asUser(t, host).query(api.rooms.getByCode, { code }),
    ).toMatchObject({
      room: {
        status: "active",
        hostUserId: returning === "before" ? host : member,
      },
    });
  },
);

test.each([0, 1])(
  "idle cleanup requires more than 30 minutes without activity (overdue by %sms)",
  async (overdue) => {
    vi.useFakeTimers();
    const t = setupTest();
    const host = await seedUser(t);
    const { roomId, code } = await asUser(t, host).mutation(
      api.rooms.create,
      {},
    );
    await t.run(async (ctx) => {
      const activity = await ctx.db
        .query("roomActivity")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .unique();
      await ctx.db.patch("roomActivity", activity!._id, {
        lastActivityAt: Date.now() - IDLE_TIMEOUT_MS - overdue,
      });
    });

    await t.mutation(internal.cleanup._cleanupRoom, { roomId });

    expect(
      await asUser(t, host).query(api.rooms.getByCode, { code }),
    ).toMatchObject({
      room: { status: overdue === 0 ? "active" : "ended", hostUserId: host },
    });
  },
);
