import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import {
  requireHostByGame,
  requireHostByRoom,
  requireMemberByGame,
  requireMemberByRoom,
  tryHostByGame,
  tryHostByRoom,
  tryMemberByGame,
  tryMemberByRoom,
} from "../convex/access";
import { asUser, seedUser, setupTest } from "./helpers";

type Setup = {
  t: ReturnType<typeof setupTest>;
  host: Id<"users">;
  member: Id<"users">;
  outsider: Id<"users">;
  roomId: Id<"rooms">;
  gameId: Id<"games">;
};

async function seedRoomWithGame(): Promise<Setup> {
  const t = setupTest();
  const host = await seedUser(t, { name: "Host" });
  const member = await seedUser(t, { name: "Member" });
  const outsider = await seedUser(t, { name: "Outsider" });
  const { roomId, gameId } = await t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: "ABC123",
      hostUserId: host,
      status: "active",
      lastActivityAt: now,
    });
    await ctx.db.insert("roomMembers", { roomId, userId: host, joinedAt: now });
    await ctx.db.insert("roomMembers", {
      roomId,
      userId: member,
      joinedAt: now,
    });
    const gameId = await ctx.db.insert("games", {
      roomId,
      contextoGameId: 42,
      status: "in_progress",
      startedAt: now,
    });
    return { roomId, gameId };
  });
  return { t, host, member, outsider, roomId, gameId };
}

describe("requireMemberByGame", () => {
  test("returns {userId, room, game} for member", async () => {
    const s = await seedRoomWithGame();
    const result = await asUser(s.t, s.member).run((ctx) =>
      requireMemberByGame(ctx, { gameId: s.gameId }),
    );
    expect(result.userId).toBe(s.member);
    expect(result.room._id).toBe(s.roomId);
    expect(result.game._id).toBe(s.gameId);
  });

  test("throws ConvexError when unauthenticated", async () => {
    const s = await seedRoomWithGame();
    await expect(
      s.t.run((ctx) => requireMemberByGame(ctx, { gameId: s.gameId })),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("throws when not a member", async () => {
    const s = await seedRoomWithGame();
    await expect(
      asUser(s.t, s.outsider).run((ctx) =>
        requireMemberByGame(ctx, { gameId: s.gameId }),
      ),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("throws when game does not exist", async () => {
    const s = await seedRoomWithGame();
    const fakeGameId = "missing" as unknown as Id<"games">;
    await expect(
      asUser(s.t, s.member).run((ctx) =>
        requireMemberByGame(ctx, { gameId: fakeGameId }),
      ),
    ).rejects.toThrow();
  });
});

describe("tryMemberByGame", () => {
  test("returns payload for member", async () => {
    const s = await seedRoomWithGame();
    const r = await asUser(s.t, s.member).run((ctx) =>
      tryMemberByGame(ctx, { gameId: s.gameId }),
    );
    expect(r).not.toBeNull();
    expect(r?.game._id).toBe(s.gameId);
  });

  test("returns null for non-member", async () => {
    const s = await seedRoomWithGame();
    const r = await asUser(s.t, s.outsider).run((ctx) =>
      tryMemberByGame(ctx, { gameId: s.gameId }),
    );
    expect(r).toBeNull();
  });

  test("returns null when unauthenticated", async () => {
    const s = await seedRoomWithGame();
    const r = await s.t.run((ctx) =>
      tryMemberByGame(ctx, { gameId: s.gameId }),
    );
    expect(r).toBeNull();
  });

  test("returns null when game does not exist", async () => {
    const s = await seedRoomWithGame();
    const fakeGameId = "missing" as unknown as Id<"games">;
    const r = await asUser(s.t, s.member).run((ctx) =>
      tryMemberByGame(ctx, { gameId: fakeGameId }),
    );
    expect(r).toBeNull();
  });
});

describe("requireMemberByRoom", () => {
  test("returns {userId, room} for member", async () => {
    const s = await seedRoomWithGame();
    const r = await asUser(s.t, s.member).run((ctx) =>
      requireMemberByRoom(ctx, { roomId: s.roomId }),
    );
    expect(r.userId).toBe(s.member);
    expect(r.room._id).toBe(s.roomId);
  });

  test("throws when not a member", async () => {
    const s = await seedRoomWithGame();
    await expect(
      asUser(s.t, s.outsider).run((ctx) =>
        requireMemberByRoom(ctx, { roomId: s.roomId }),
      ),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("tryMemberByRoom", () => {
  test("returns payload for member, null for non-member", async () => {
    const s = await seedRoomWithGame();
    const ok = await asUser(s.t, s.member).run((ctx) =>
      tryMemberByRoom(ctx, { roomId: s.roomId }),
    );
    expect(ok?.room._id).toBe(s.roomId);
    const no = await asUser(s.t, s.outsider).run((ctx) =>
      tryMemberByRoom(ctx, { roomId: s.roomId }),
    );
    expect(no).toBeNull();
  });
});

describe("requireHostByGame", () => {
  test("returns payload for host", async () => {
    const s = await seedRoomWithGame();
    const r = await asUser(s.t, s.host).run((ctx) =>
      requireHostByGame(ctx, { gameId: s.gameId }),
    );
    expect(r.userId).toBe(s.host);
    expect(r.game._id).toBe(s.gameId);
  });

  test("throws for member who is not host", async () => {
    const s = await seedRoomWithGame();
    await expect(
      asUser(s.t, s.member).run((ctx) =>
        requireHostByGame(ctx, { gameId: s.gameId }),
      ),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("throws for outsider", async () => {
    const s = await seedRoomWithGame();
    await expect(
      asUser(s.t, s.outsider).run((ctx) =>
        requireHostByGame(ctx, { gameId: s.gameId }),
      ),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("tryHostByGame", () => {
  test("payload for host, null otherwise", async () => {
    const s = await seedRoomWithGame();
    const yes = await asUser(s.t, s.host).run((ctx) =>
      tryHostByGame(ctx, { gameId: s.gameId }),
    );
    expect(yes?.userId).toBe(s.host);
    const no = await asUser(s.t, s.member).run((ctx) =>
      tryHostByGame(ctx, { gameId: s.gameId }),
    );
    expect(no).toBeNull();
  });
});

describe("requireHostByRoom", () => {
  test("payload for host", async () => {
    const s = await seedRoomWithGame();
    const r = await asUser(s.t, s.host).run((ctx) =>
      requireHostByRoom(ctx, { roomId: s.roomId }),
    );
    expect(r.userId).toBe(s.host);
  });

  test("throws for non-host member", async () => {
    const s = await seedRoomWithGame();
    await expect(
      asUser(s.t, s.member).run((ctx) =>
        requireHostByRoom(ctx, { roomId: s.roomId }),
      ),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("tryHostByRoom", () => {
  test("payload for host, null otherwise", async () => {
    const s = await seedRoomWithGame();
    const yes = await asUser(s.t, s.host).run((ctx) =>
      tryHostByRoom(ctx, { roomId: s.roomId }),
    );
    expect(yes?.userId).toBe(s.host);
    const no = await asUser(s.t, s.outsider).run((ctx) =>
      tryHostByRoom(ctx, { roomId: s.roomId }),
    );
    expect(no).toBeNull();
  });
});
