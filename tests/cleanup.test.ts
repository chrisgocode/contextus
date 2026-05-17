import { describe, expect, test } from "vitest";
import {
  IDLE_TIMEOUT_MS,
  decideRoomCleanup,
} from "../convex/lib/cleanup";
import type { Id } from "../convex/_generated/dataModel";

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
