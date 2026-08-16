import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, seedUser, setupTest } from "./helpers";

test("create requires auth", async () => {
  const t = setupTest();
  await expect(t.mutation(api.rooms.create, {})).rejects.toThrow();
});

test("anonymous users can create and host rooms", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const { roomId } = await asUser(t, guest).mutation(api.rooms.create, {});

  await asUser(t, guest).mutation(api.rooms.endRoom, { roomId });

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room).toMatchObject({ hostUserId: guest, status: "ended" });
});

test("anonymous users are limited to three active rooms", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });

  for (let i = 0; i < 3; i++) {
    await asUser(t, guest).mutation(api.rooms.create, {});
  }

  await expect(asUser(t, guest).mutation(api.rooms.create, {})).rejects.toThrow(
    "Guest room limit reached",
  );
});

test("anonymous users cannot join a fourth active room", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const guest = await seedUser(t, { isAnonymous: true });
  const codes: string[] = [];
  for (let i = 0; i < 4; i++) {
    codes.push((await asUser(t, host).mutation(api.rooms.create, {})).code);
  }
  for (const code of codes.slice(0, 3)) {
    await asUser(t, guest).mutation(api.rooms.join, { code });
  }

  await expect(
    asUser(t, guest).mutation(api.rooms.join, { code: codes[3] }),
  ).rejects.toThrow("Guest room limit reached");
});

test("ending a room frees a guest room slot", async () => {
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  const first = await asUser(t, guest).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.create, {});

  await asUser(t, guest).mutation(api.rooms.endRoom, { roomId: first.roomId });

  await expect(
    asUser(t, guest).mutation(api.rooms.create, {}),
  ).resolves.toEqual(expect.objectContaining({ code: expect.any(String) }));
});

test("leaving a room frees a guest room slot", async () => {
	const t = setupTest();
	const host = await seedUser(t);
	const guest = await seedUser(t, { isAnonymous: true });
	const rooms = [];
	for (let i = 0; i < 4; i++) {
		rooms.push(await asUser(t, host).mutation(api.rooms.create, {}));
	}
	for (const room of rooms.slice(0, 3)) {
		await asUser(t, guest).mutation(api.rooms.join, { code: room.code });
	}

	await asUser(t, guest).mutation(api.rooms.leave, {
		roomId: rooms[0].roomId,
	});

	await expect(
		asUser(t, guest).mutation(api.rooms.join, { code: rooms[3].code }),
	).resolves.toEqual(expect.objectContaining({ roomId: rooms[3].roomId }));
});

test("create returns a valid code and inserts host as member", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const { code, roomId } = await asUser(t, userId).mutation(
    api.rooms.create,
    {},
  );
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  const members = await t.run(async (ctx) =>
    ctx.db
      .query("roomMembers")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
  );
  expect(members).toHaveLength(1);
  expect(members[0].userId).toBe(userId);
});

test("create inserts a matching roomActivity row", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const { roomId } = await asUser(t, userId).mutation(api.rooms.create, {});
  const activity = await t.run(async (ctx) =>
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique(),
  );
  expect(activity).not.toBeNull();
  expect(activity!.lastActivityAt).toBeGreaterThan(0);
});

test("join updates roomActivity", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const joiner = await seedUser(t);
  const { roomId, code } = await asUser(t, host).mutation(api.rooms.create, {});
  const before = await t.run(async (ctx) =>
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique(),
  );
  await new Promise((r) => setTimeout(r, 5));
  await asUser(t, joiner).mutation(api.rooms.join, { code });
  const after = await t.run(async (ctx) =>
    ctx.db
      .query("roomActivity")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .unique(),
  );
  expect(after).not.toBeNull();
  expect(after!.lastActivityAt).toBeGreaterThan(before!.lastActivityAt);
});

test("join is idempotent", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const other = await seedUser(t);
  const { code, roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  await asUser(t, other).mutation(api.rooms.join, { code });
  const members = await t.run(async (ctx) =>
    ctx.db
      .query("roomMembers")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
  );
  expect(members.filter((m) => m.userId === other)).toHaveLength(1);
});

test("join unknown code throws", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  await expect(
    asUser(t, userId).mutation(api.rooms.join, { code: "ZZZZZZ" }),
  ).rejects.toThrow();
});

test("join is case-insensitive", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const other = await seedUser(t);
  const { code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, {
    code: code.toLowerCase(),
  });
});

test("endRoom: only host can end", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const other = await seedUser(t);
  const { code, roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  await expect(
    asUser(t, other).mutation(api.rooms.endRoom, { roomId }),
  ).rejects.toThrow();
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });
  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room?.status).toBe("ended");
});

test("join refused for ended room", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const other = await seedUser(t);
  const { code, roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });
  await expect(
    asUser(t, other).mutation(api.rooms.join, { code }),
  ).rejects.toThrow();
});

test("leave removes membership", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const other = await seedUser(t);
  const { code, roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  await asUser(t, other).mutation(api.rooms.leave, { roomId });
  const members = await t.run(async (ctx) =>
    ctx.db
      .query("roomMembers")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect(),
  );
  expect(members.map((m) => m.userId)).toEqual([host]);
});

test("getByCode returns members sorted by joinedAt with host flag", async () => {
  const t = setupTest();
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { code } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, other).mutation(api.rooms.join, { code });
  const result = await asUser(t, host).query(api.rooms.getByCode, { code });
  expect(result?.members).toHaveLength(2);
  expect(result?.members[0].isHost).toBe(true);
  expect(result?.members[1].isHost).toBe(false);
});

test("public room previews do not expose member details", async () => {
  const t = setupTest();
  const host = await seedUser(t, { email: "private@test.dev" });
  const { code } = await asUser(t, host).mutation(api.rooms.create, {});

  const result = await t.query(api.rooms.getByCode, { code });

	expect(result?.members).toEqual([]);
});

test("getByCode null for unknown", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const result = await asUser(t, userId).query(api.rooms.getByCode, {
    code: "ZZZZZZ",
  });
  expect(result).toBeNull();
});

test("listMine returns active rooms for user, newest activity first", async () => {
  const t = setupTest();
  const userId = await seedUser(t);
  const u = asUser(t, userId);
  const r1 = await u.mutation(api.rooms.create, {});
  const r2 = await u.mutation(api.rooms.create, {});
  // touch r1 to be newer
  await u.mutation(api.rooms.join, { code: r1.code });
  const rooms = await u.query(api.rooms.listMine, {});
  expect(rooms.map((r) => r.code)).toEqual([r1.code, r2.code]);
});

test("listRecentGroups returns a registered user's ended room", async () => {
  const t = setupTest();
  const host = await seedUser(t, { name: "Chris", isAnonymous: false });
  const partner = await seedUser(t, { name: "Jane", isAnonymous: false });
  const { code, roomId } = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, partner).mutation(api.rooms.join, { code });
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });

  const groups = await asUser(t, host).query(api.rooms.listRecentGroups, {});

  expect(groups).toEqual([
    expect.objectContaining({
      roomId,
      members: [
        expect.objectContaining({ userId: host, name: "Chris" }),
        expect.objectContaining({ userId: partner, name: "Jane" }),
      ],
    }),
  ]);
});

test("listRecentGroups returns the three newest unique participant sets", async () => {
  const t = setupTest();
  const chris = await seedUser(t, { name: "Chris", isAnonymous: false });
  const jane = await seedUser(t, { name: "Jane", isAnonymous: false });
  const alex = await seedUser(t, { name: "Alex", isAnonymous: false });
  const bob = await seedUser(t, { name: "Bob", isAnonymous: false });
  const dana = await seedUser(t, { name: "Dana", isAnonymous: false });

  async function endedRoomWith(partner: typeof jane) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const room = await asUser(t, chris).mutation(api.rooms.create, {});
    await asUser(t, partner).mutation(api.rooms.join, { code: room.code });
    await asUser(t, chris).mutation(api.rooms.endRoom, { roomId: room.roomId });
    return room;
  }

  await endedRoomWith(alex);
  const withBob = await endedRoomWith(bob);
  const withDana = await endedRoomWith(dana);
  await endedRoomWith(jane);
  const newestWithJane = await endedRoomWith(jane);

  const groups = await asUser(t, chris).query(api.rooms.listRecentGroups, {});

  expect(groups.map((group) => group.roomId)).toEqual([
    newestWithJane.roomId,
    withDana.roomId,
    withBob.roomId,
  ]);
});

test("a registered member can reactivate a group with a fresh room code", async () => {
  const t = setupTest();
  const chris = await seedUser(t, { name: "Chris", isAnonymous: false });
  const jane = await seedUser(t, { name: "Jane", isAnonymous: false });
  const original = await asUser(t, chris).mutation(api.rooms.create, {});
  await asUser(t, jane).mutation(api.rooms.join, { code: original.code });
  await asUser(t, chris).mutation(api.rooms.endRoom, {
    roomId: original.roomId,
  });

  const replayed = await asUser(t, jane).mutation(api.rooms.playAgain, {
    roomId: original.roomId,
  });

  expect(replayed.roomId).toBe(original.roomId);
  expect(replayed.code).not.toBe(original.code);
  await expect(
    asUser(t, jane).query(api.rooms.getByCode, { code: original.code }),
  ).resolves.toBeNull();
  const room = await asUser(t, jane).query(api.rooms.getByCode, {
    code: replayed.code,
  });
  expect(room?.room.status).toBe("active");
  expect(room?.isViewerHost).toBe(true);
  await expect(
    asUser(t, chris).query(api.rooms.listMine, {}),
  ).resolves.toContainEqual(expect.objectContaining({ _id: original.roomId }));
});

test("playAgain preserves an unfinished game", async () => {
  const t = setupTest();
  const host = await seedUser(t, { isAnonymous: false });
  const partner = await seedUser(t, { isAnonymous: false });
  const room = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, partner).mutation(api.rooms.join, { code: room.code });
  const { gameId } = await asUser(t, host).mutation(api.games.start, {
    roomId: room.roomId,
    contextoGameId: 1336,
  });
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId: room.roomId });

  await asUser(t, partner).mutation(api.rooms.playAgain, {
    roomId: room.roomId,
  });

  const active = await asUser(t, partner).query(api.games.getActive, {
    roomId: room.roomId,
  });
  expect(active?._id).toBe(gameId);
});

test("rooms involving guests are not reusable groups", async () => {
  const t = setupTest();
  const host = await seedUser(t, { isAnonymous: false });
  const guest = await seedUser(t, { isAnonymous: true });
  const room = await asUser(t, host).mutation(api.rooms.create, {});
  await asUser(t, guest).mutation(api.rooms.join, { code: room.code });
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId: room.roomId });

  await expect(
    asUser(t, host).query(api.rooms.listRecentGroups, {}),
  ).resolves.toEqual([]);
  await expect(
    asUser(t, host).mutation(api.rooms.playAgain, { roomId: room.roomId }),
  ).rejects.toThrow("Registered accounts required");
});

test("a solo room is not a reusable group", async () => {
  const t = setupTest();
  const user = await seedUser(t, { isAnonymous: false });
  const room = await asUser(t, user).mutation(api.rooms.create, {});
  await asUser(t, user).mutation(api.rooms.endRoom, { roomId: room.roomId });

  const groups = await asUser(t, user).query(api.rooms.listRecentGroups, {});

  expect(groups).toEqual([]);
});
