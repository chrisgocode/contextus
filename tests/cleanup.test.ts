import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  IDLE_TIMEOUT_MS,
  decideRoomCleanup,
} from "../convex/lib/cleanup";
import type { Id } from "../convex/_generated/dataModel";
import { asUser, seedUser, setupTest } from "./helpers";

const host = "u_host" as unknown as Id<"users">;
const other = "u_other" as unknown as Id<"users">;
const newer = "u_newer" as unknown as Id<"users">;

describe("decideRoomCleanup", () => {
  test("no-op when host online", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: Date.now() },
      members: [
        { userId: host, joinedAt: 1 },
        { userId: other, joinedAt: 2 },
      ],
      onlineUserIds: new Set([host, other]),
      now: Date.now(),
    });
    expect(r.kind).toBe("noop");
  });

  test("migrates host to oldest-joined online member", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: Date.now() },
      members: [
        { userId: host, joinedAt: 1 },
        { userId: other, joinedAt: 2 },
        { userId: newer, joinedAt: 3 },
      ],
      onlineUserIds: new Set([other, newer]),
      now: Date.now(),
    });
    expect(r).toEqual({ kind: "migrateHost", newHostUserId: other });
  });

  test("ends room when no online + idle past timeout", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: 0 },
      members: [{ userId: host, joinedAt: 1 }],
      onlineUserIds: new Set(),
      now: IDLE_TIMEOUT_MS + 1,
    });
    expect(r.kind).toBe("endRoom");
  });

  test("no-op when no online but not yet idle", () => {
    const now = Date.now();
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: now - 1000 },
      members: [{ userId: host, joinedAt: 1 }],
      onlineUserIds: new Set(),
      now,
    });
    expect(r.kind).toBe("noop");
  });

  test("no-op when host happens to be only online member", () => {
    const r = decideRoomCleanup({
      room: { hostUserId: host, lastActivityAt: Date.now() },
      members: [
        { userId: host, joinedAt: 1 },
        { userId: other, joinedAt: 2 },
      ],
      onlineUserIds: new Set([host]),
      now: Date.now(),
    });
    expect(r.kind).toBe("noop");
  });
});

describe("cleanup.tick", () => {
  test("ends idle room when all members are offline (disconnected presence)", async () => {
    const t = setupTest();
    const hostUser = await seedUser(t, { name: "Host" });
    const { roomId } = await asUser(t, hostUser).mutation(
      api.rooms.create,
      {},
    );

    // Host comes online, then disconnects (presence record kept as offline).
    const beat = await asUser(t, hostUser).mutation(api.presence.heartbeat, {
      roomId,
      userId: hostUser,
      sessionId: "s1",
      interval: 10000,
    });
    if (beat === null) throw new Error("heartbeat returned null");
    await t.mutation(api.presence.disconnect, {
      sessionToken: beat.sessionToken,
    });

    // Force the room past the idle timeout.
    await t.run(async (ctx) => {
      const activity = await ctx.db
        .query("roomActivity")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .unique();
      if (activity === null) throw new Error("missing roomActivity");
      await ctx.db.patch(activity._id, {
        lastActivityAt: Date.now() - IDLE_TIMEOUT_MS - 1000,
      });
    });

    await t.action(internal.cleanup.tick, {});

    const status = await t.run(async (ctx) => {
      const room = await ctx.db.get(roomId);
      return room?.status;
    });
    expect(status).toBe("ended");
  });
});
