import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { backfillMissingUsernames } from "../users";
import {
  asUser,
  seedUser,
  sessionOf,
  setupTest,
  storeUpload,
} from "../testHelpers.test";

afterEach(() => {
  vi.useRealTimers();
});

test("getUser returns profile fields for the current user", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    name: "Ada",
    email: "ada@test.dev",
    username: "briskabacus12",
    displayUsername: "BriskAbacus12",
  });

  const profile = await asUser(t, user).query(api.users.getUser, {});

  expect(profile).toMatchObject({
    _id: user,
    name: "Ada",
    email: "ada@test.dev",
    username: "briskabacus12",
    displayUsername: "BriskAbacus12",
    isCurrentUser: true,
  });
});

test("staleSession names the caller's session once it no longer signs them in", async () => {
  const t = setupTest();
  const live = await seedUser(t);
  const deleted = await seedUser(t, { isAnonymous: true });
  const cleanupStarted = await seedUser(t, { isAnonymous: true });
  await t.run(async (ctx) => {
    await ctx.db.delete("authSessions", sessionOf(t, deleted));
    await ctx.db.delete("users", deleted);
    await ctx.db.patch("users", cleanupStarted, { guestCleanupStarted: true });
  });

  const staleSession = (userId: typeof live) =>
    asUser(t, userId).query(api.users.staleSession, {});
  expect(await staleSession(live)).toBeNull();
  expect(await staleSession(deleted)).toBe(sessionOf(t, deleted));
  expect(await staleSession(cleanupStarted)).toBe(sessionOf(t, cleanupStarted));
  expect(await t.query(api.users.staleSession, {})).toBeNull();
});

test("getByUsername resolves normalized usernames and keeps email private", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    name: "Ada",
    email: "ada@test.dev",
    username: "briskabacus12",
    displayUsername: "BriskAbacus12",
  });

  const profile = await t.query(api.users.getByUsername, {
    username: "BriskAbacus12",
  });

  expect(profile).toMatchObject({
    _id: user,
    name: "Ada",
    email: null,
    username: "briskabacus12",
    displayUsername: "BriskAbacus12",
    isCurrentUser: false,
  });
});

test("getByUsername marks the authenticated owner", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    email: "owner@test.dev",
    username: "ownername",
    displayUsername: "OwnerName",
  });

  const profile = await asUser(t, user).query(api.users.getByUsername, {
    username: "ownername",
  });

  expect(profile).toMatchObject({
    _id: user,
    email: "owner@test.dev",
    isCurrentUser: true,
  });
});

test("getUser omits email when reading another user", async () => {
  const t = setupTest();
  const viewer = await seedUser(t);
  const viewed = await seedUser(t, {
    email: "viewed@test.dev",
  });

  const profile = await asUser(t, viewer).query(api.users.getUser, {
    userId: viewed,
  });

  expect(profile?.email).toBeNull();
});

test("profile queries return null when the requested user does not exist", async () => {
  const t = setupTest();
  const viewer = await seedUser(t);
  const deleted = await seedUser(t, {
    username: "deleteduser",
    displayUsername: "DeletedUser",
  });
  await t.run(async (ctx) => await ctx.db.delete("users", deleted));

  await expect(
    asUser(t, viewer).query(api.users.getUser, { userId: deleted }),
  ).resolves.toBeNull();
  await expect(
    t.query(api.users.getByUsername, { username: "missinguser" }),
  ).resolves.toBeNull();
  await expect(
    t.query(api.users.getActivityGraph, { username: "missinguser" }),
  ).resolves.toBeNull();
});

test("updateProfile updates the authenticated user's profile", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    username: "briskabacus12",
    displayUsername: "BriskAbacus12",
  });
  const other = await seedUser(t, {
    username: "calmacorn34",
    displayUsername: "CalmAcorn34",
  });

  await asUser(t, user).mutation(api.users.updateProfile, {
    name: "Updated User",
    username: "BrightUser20",
  });

  const updated = await t.run(async (ctx) => await ctx.db.get("users", user));
  const untouched = await t.run(
    async (ctx) => await ctx.db.get("users", other),
  );

  expect(updated).toMatchObject({
    name: "Updated User",
    username: "brightuser20",
    displayUsername: "BrightUser20",
  });
  expect(untouched).toMatchObject({
    username: "calmacorn34",
    displayUsername: "CalmAcorn34",
  });
});

test("updateProfile rejects anonymous users", async () => {
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    username: "guestname",
    displayUsername: "GuestName",
  });

  await expect(
    asUser(t, guest).mutation(api.users.updateProfile, {
      name: "Updated Guest",
      username: "UpdatedGuest",
    }),
  ).rejects.toThrow("Registered account required");
});

test("updateProfile rejects invalid and duplicate usernames", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    username: "briskabacus12",
    displayUsername: "BriskAbacus12",
  });
  await seedUser(t, {
    username: "takenuser1",
    displayUsername: "TakenUser1",
  });

  await expect(
    asUser(t, user).mutation(api.users.updateProfile, {
      name: "Test User",
      username: "bad-name",
    }),
  ).rejects.toThrow("Username can only contain letters and numbers.");

  await expect(
    asUser(t, user).mutation(api.users.updateProfile, {
      name: "Test User",
      username: "TakenUser1",
    }),
  ).rejects.toThrow("Username is already taken.");
});

test("updateProfile rejects blank names and missing avatar uploads", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    username: "profileuser",
    displayUsername: "ProfileUser",
  });

  await expect(
    asUser(t, user).mutation(api.users.updateProfile, {
      name: "   ",
      username: "ProfileUser",
    }),
  ).rejects.toThrow("Name is required.");

  const deletedAvatar = await t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob(["avatar"]));
    await ctx.storage.delete(id);
    return id;
  });
  await expect(
    asUser(t, user).mutation(api.users.updateProfile, {
      name: "Profile User",
      username: "ProfileUser",
      avatarStorageId: deletedAvatar,
    }),
  ).rejects.toThrow("Uploaded profile image was not found.");
});

test("registered users can upload and read a profile image", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    username: "avataruser",
    displayUsername: "AvatarUser",
  });
  const avatarStorageId = await storeUpload(
    t,
    new Blob(["avatar"], { type: "image/png" }),
  );

  await expect(
    asUser(t, user).mutation(api.users.generateProfileImageUploadUrl, {}),
  ).resolves.toMatch(/^https?:\/\//);
  await asUser(t, user).mutation(api.users.updateProfile, {
    name: "Avatar User",
    username: "AvatarUser",
    avatarStorageId,
  });

  const profile = await asUser(t, user).query(api.users.getByUsername, {
    username: "avataruser",
  });
  expect(profile?.image).toMatch(/^https?:\/\/.*\/api\/storage\//);
});

test("updateProfile rejects oversized and non-raster avatar uploads", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    username: "avatarlimits",
    displayUsername: "AvatarLimits",
  });
  const oversized = await storeUpload(
    t,
    new Blob([new Uint8Array(1024 * 1024 + 1)], { type: "image/png" }),
  );
  const svg = await storeUpload(
    t,
    new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], {
      type: "image/svg+xml",
    }),
  );
  const untyped = await storeUpload(t, new Blob(["avatar"]));

  await expect(
    asUser(t, user).mutation(api.users.updateProfile, {
      name: "Avatar Limits",
      username: "AvatarLimits",
      avatarStorageId: oversized,
    }),
  ).rejects.toThrow("Profile image must be 1 MB or smaller.");
  for (const avatarStorageId of [svg, untyped]) {
    await expect(
      asUser(t, user).mutation(api.users.updateProfile, {
        name: "Avatar Limits",
        username: "AvatarLimits",
        avatarStorageId,
      }),
    ).rejects.toThrow("Profile image must be a PNG, JPEG, WebP or GIF.");
  }
});

test("updateProfile rejects another user's avatar file", async () => {
  const t = setupTest();
  const owner = await seedUser(t, {
    username: "avatarowner",
    displayUsername: "AvatarOwner",
  });
  const thief = await seedUser(t, {
    username: "avatarthief",
    displayUsername: "AvatarThief",
  });
  const avatarStorageId = await storeUpload(
    t,
    new Blob(["avatar"], { type: "image/png" }),
  );
  await asUser(t, owner).mutation(api.users.updateProfile, {
    name: "Avatar Owner",
    username: "AvatarOwner",
    avatarStorageId,
  });

  await expect(
    asUser(t, thief).mutation(api.users.updateProfile, {
      name: "Avatar Thief",
      username: "AvatarThief",
      avatarStorageId,
    }),
  ).rejects.toThrow("Uploaded profile image was not found.");
});

test("updateProfile deletes the replaced avatar file", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    username: "avatarswap",
    displayUsername: "AvatarSwap",
  });
  const first = await storeUpload(
    t,
    new Blob(["first"], { type: "image/png" }),
  );
  const second = await storeUpload(
    t,
    new Blob(["second"], { type: "image/webp" }),
  );
  const save = (avatarStorageId?: typeof first) =>
    asUser(t, user).mutation(api.users.updateProfile, {
      name: "Avatar Swap",
      username: "AvatarSwap",
      ...(avatarStorageId === undefined ? {} : { avatarStorageId }),
    });

  await save(first);
  await save(first);
  await save();
  await expect(
    t.run(async (ctx) => ctx.db.system.get("_storage", first)),
  ).resolves.not.toBeNull();

  await save(second);
  const [firstFile, secondFile, stored] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.system.get("_storage", first),
      ctx.db.system.get("_storage", second),
      ctx.db.get("users", user),
    ]),
  );
  expect(firstFile).toBeNull();
  expect(secondFile).not.toBeNull();
  expect(stored?.avatarStorageId).toBe(second);
});

test("registered users never receive guest account prompts", async () => {
  const t = setupTest();
  const user = await seedUser(t, {
    isAnonymous: false,
    guestCompletedGames: 3,
  });

  await expect(
    asUser(t, user).query(api.users.getGuestAccountPrompt, {}),
  ).resolves.toBeNull();
  await expect(
    asUser(t, user).mutation(api.users.dismissGuestAccountPrompt, {}),
  ).resolves.toBeNull();
});

test("guest account prompts stay hidden before the first milestone", async () => {
  const t = setupTest();
  const guest = await seedUser(t, {
    isAnonymous: true,
    guestCompletedGames: 2,
  });

  await expect(
    asUser(t, guest).query(api.users.getGuestAccountPrompt, {}),
  ).resolves.toBeNull();
  await asUser(t, guest).mutation(api.users.dismissGuestAccountPrompt, {});
  const stored = await t.run(async (ctx) => ctx.db.get("users", guest));
  expect(stored?.guestPromptedGames).toBeUndefined();
});

test("backfillMissingUsernames is not callable by public clients", () => {
  expect(backfillMissingUsernames.isInternal).toBe(true);
  expect(backfillMissingUsernames).not.toHaveProperty("isPublic");
});

test("backfillMissingUsernames assigns generated usernames to existing users", async () => {
  const t = setupTest();
  const user = await seedUser(t, { username: undefined });

  const result = await t.mutation(internal.users.backfillMissingUsernames, {
    batchSize: 10,
  });
  const updated = await t.run(async (ctx) => await ctx.db.get("users", user));

  expect(result.updated).toBe(1);
  expect(updated?.username).toMatch(/^[a-z0-9]{3,20}$/);
  expect(updated?.displayUsername).toMatch(/^[A-Za-z0-9]{3,20}$/);
  expect(updated?.displayUsername).toHaveLength(updated?.username?.length ?? 0);
});

test("backfillMissingUsernames clamps the batch size and reports more work", async () => {
  const t = setupTest();
  const existing = await seedUser(t, {
    username: "existing",
    displayUsername: "Existing",
  });
  await seedUser(t, { username: undefined });
  await seedUser(t, { username: undefined });

  const first = await t.mutation(internal.users.backfillMissingUsernames, {
    batchSize: 0,
  });
  const unchanged = await t.run(
    async (ctx) => await ctx.db.get("users", existing),
  );

  expect(first).toEqual({ updated: 1, hasMore: true });
  expect(unchanged).toMatchObject({
    username: "existing",
    displayUsername: "Existing",
  });
});

test("getActivityGraph aggregates user history by UTC day", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));

  const t = setupTest();
  const user = await seedUser(t);
  const other = await seedUser(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("userGameHistory", {
      userId: user,
      contextoGameId: 1,
      firstPlayedAt: Date.UTC(2026, 5, 24, 23, 30),
    });
    await ctx.db.insert("userGameHistory", {
      userId: user,
      contextoGameId: 2,
      firstPlayedAt: Date.UTC(2026, 5, 25, 0, 30),
    });
    await ctx.db.insert("userGameHistory", {
      userId: user,
      contextoGameId: 3,
      firstPlayedAt: Date.UTC(2026, 5, 25, 18, 0),
    });
    await ctx.db.insert("userGameHistory", {
      userId: other,
      contextoGameId: 4,
      firstPlayedAt: Date.UTC(2026, 5, 25, 18, 0),
    });
  });

  const graph = await asUser(t, user).query(api.users.getActivityGraph, {});

  expect(graph?.totalCount).toBe(3);
  expect(graph?.days).toHaveLength(365);
  expect(graph?.days.at(-2)).toMatchObject({
    date: "2026-06-24",
    count: 1,
    level: 1,
  });
  expect(graph?.days.at(-1)).toMatchObject({
    date: "2026-06-25",
    count: 2,
    level: 2,
  });
});

test.each([
  { viewer: "another signed-in user", signedIn: true, username: "PublicUser" },
  { viewer: "a signed-out visitor", signedIn: false, username: "PUBLICUSER" },
])(
  "getActivityGraph shows the named user's activity to $viewer",
  async ({ signedIn, username }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));

    const t = setupTest();
    const viewer = await seedUser(t);
    const viewed = await seedUser(t, {
      username: "publicuser",
      displayUsername: "PublicUser",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("userGameHistory", {
        userId: viewed,
        contextoGameId: 1,
        firstPlayedAt: Date.UTC(2026, 5, 25, 12, 0),
      });
    });

    const graph = await (signedIn ? asUser(t, viewer) : t).query(
      api.users.getActivityGraph,
      { username },
    );

    expect(graph?.totalCount).toBe(1);
    expect(graph?.days.at(-1)).toMatchObject({
      date: "2026-06-25",
      count: 1,
      level: 1,
    });
  },
);

test("getActivityGraph caps busy-day intensity at four", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));
  const t = setupTest();
  const user = await seedUser(t);
  await t.run(async (ctx) => {
    for (let contextoGameId = 1; contextoGameId <= 5; contextoGameId++) {
      await ctx.db.insert("userGameHistory", {
        userId: user,
        contextoGameId,
        firstPlayedAt: Date.UTC(2026, 5, 25, 12, contextoGameId),
      });
    }
  });

  const graph = await asUser(t, user).query(api.users.getActivityGraph, {});

  expect(graph?.days.at(-1)).toMatchObject({ count: 5, level: 4 });
});
