import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, seedUser, setupTest } from "./helpers";

test("create requires auth", async () => {
  const t = setupTest();
  await expect(t.mutation(api.rooms.create, {})).rejects.toThrow();
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
  const { roomId, code } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
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
  const { code, roomId } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
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
  const { code, roomId } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
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
  const { code, roomId } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
  await asUser(t, host).mutation(api.rooms.endRoom, { roomId });
  await expect(
    asUser(t, other).mutation(api.rooms.join, { code }),
  ).rejects.toThrow();
});

test("leave removes membership", async () => {
  const t = setupTest();
  const host = await seedUser(t);
  const other = await seedUser(t);
  const { code, roomId } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
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
