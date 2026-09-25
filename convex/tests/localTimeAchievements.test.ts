import { afterEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  asUser,
  fakeWordOracle,
  seedUser,
  setupTest,
} from "../testHelpers.test";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ARCHIVE_PUZZLE = 1336;

async function solveAt(
  t: ReturnType<typeof setupTest>,
  instant: string,
  players: { host: Id<"users">; teammate?: Id<"users"> },
  contextoGameId = ARCHIVE_PUZZLE,
) {
  vi.setSystemTime(new Date(instant));
  const { roomId, code } = await asUser(t, players.host).mutation(
    api.rooms.create,
    {},
  );
  if (players.teammate !== undefined) {
    await asUser(t, players.teammate).mutation(api.rooms.join, { code });
  }
  const { gameId } = await asUser(t, players.host).mutation(api.games.start, {
    roomId,
    contextoGameId,
  });
  if (players.teammate !== undefined) {
    await asUser(t, players.teammate).action(api.guesses.submit, {
      gameId,
      word: "opener",
    });
  }
  return await asUser(t, players.host).action(api.guesses.submit, {
    gameId,
    word: "answer",
  });
}

async function achievementIds(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
) {
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("userAchievements")
      .withIndex("by_user_achievement", (q) => q.eq("userId", userId))
      .collect(),
  );
  return rows.map((row) => row.achievementId);
}

function setup() {
  vi.useFakeTimers();
  const t = setupTest();
  const answers: Record<string, number> = { opener: 500, answer: 0 };
  fakeWordOracle({
    guesses: Object.fromEntries(
      [ARCHIVE_PUZZLE, 1337, 1338, 1339, 1480, 1481].map((id) => [id, answers]),
    ),
  });
  return t;
}

test("solving on three consecutive days unlocks On a Roll, falling back to UTC days", async () => {
  const t = setup();
  const host = await seedUser(t);

  await solveAt(t, "2026-03-01T23:30:00Z", { host });
  await solveAt(t, "2026-03-02T00:30:00Z", { host });
  const third = await solveAt(t, "2026-03-03T12:00:00Z", { host });

  expect(third.unlockedAchievementIds).toContain("on_a_roll");
});

test("a skipped day restarts the streak and same-day solves count once", async () => {
  const t = setup();
  const host = await seedUser(t);

  await solveAt(t, "2026-03-01T10:00:00Z", { host });
  await solveAt(t, "2026-03-01T20:00:00Z", { host });
  await solveAt(t, "2026-03-02T10:00:00Z", { host });
  await solveAt(t, "2026-03-04T10:00:00Z", { host });
  await solveAt(t, "2026-03-05T10:00:00Z", { host });

  await expect(achievementIds(t, host)).resolves.not.toContain("on_a_roll");

  await solveAt(t, "2026-03-06T10:00:00Z", { host });
  await expect(achievementIds(t, host)).resolves.toContain("on_a_roll");
});

test("streak days follow each player's own time zone", async () => {
  const t = setup();
  const losAngeles = await seedUser(t);
  const tokyo = await seedUser(t);
  await asUser(t, losAngeles).mutation(api.users.setTimeZone, {
    timeZone: "america/los_angeles",
  });
  await asUser(t, tokyo).mutation(api.users.setTimeZone, {
    timeZone: "Asia/Tokyo",
  });
  await asUser(t, losAngeles).mutation(api.users.setTimeZone, {
    timeZone: "Not/AZone",
  });

  // LA: Mar 1, Mar 2, Mar 3. Tokyo: Mar 2, Mar 3, Mar 3. UTC: Mar 2, 2, 3.
  for (const instant of [
    "2026-03-02T05:00:00Z",
    "2026-03-02T20:00:00Z",
    "2026-03-03T14:00:00Z",
  ]) {
    await solveAt(t, instant, { host: losAngeles });
    await solveAt(t, instant, { host: tokyo });
  }

  await expect(achievementIds(t, losAngeles)).resolves.toContain("on_a_roll");
  await expect(achievementIds(t, tokyo)).resolves.not.toContain("on_a_roll");
});

test("streaks count calendar days across a daylight saving change", async () => {
  const t = setup();
  const host = await seedUser(t);
  await asUser(t, host).mutation(api.users.setTimeZone, {
    timeZone: "America/Los_Angeles",
  });

  // 23:30 PST Mar 7, 23:30 PDT Mar 8, 00:30 PDT Mar 9.
  await solveAt(t, "2026-03-08T07:30:00Z", { host });
  await solveAt(t, "2026-03-09T06:30:00Z", { host });
  await solveAt(t, "2026-03-09T07:30:00Z", { host });

  await expect(achievementIds(t, host)).resolves.toContain("on_a_roll");
});

test("Night Owl unlocks for solves between local midnight and 4 AM", async () => {
  const t = setup();
  const host = await seedUser(t);
  await asUser(t, host).mutation(api.users.setTimeZone, {
    timeZone: "America/Los_Angeles",
  });

  const atFour = await solveAt(t, "2026-03-02T12:00:00Z", { host });
  const atOneThirty = await solveAt(t, "2026-03-03T09:30:00Z", { host });

  expect(atFour.unlockedAchievementIds).not.toContain("night_owl");
  expect(atOneThirty.unlockedAchievementIds).toContain("night_owl");
});

test("solve-time achievements credit each active guesser in their own time zone", async () => {
  const t = setup();
  const host = await seedUser(t);
  const teammate = await seedUser(t);
  await asUser(t, host).mutation(api.users.setTimeZone, {
    timeZone: "America/Los_Angeles",
  });
  await asUser(t, teammate).mutation(api.users.setTimeZone, {
    timeZone: "Asia/Tokyo",
  });

  // 09:00 in Los Angeles, 02:00 in Tokyo.
  await solveAt(t, "2026-03-02T17:00:00Z", { host, teammate });

  await expect(achievementIds(t, host)).resolves.not.toContain("night_owl");
  await expect(achievementIds(t, teammate)).resolves.toContain("night_owl");
});

test("Early Bird unlocks for today's puzzle within 10 minutes of local midnight", async () => {
  const t = setup();
  const host = await seedUser(t);
  await asUser(t, host).mutation(api.users.setTimeZone, {
    timeZone: "Asia/Tokyo",
  });
  // Puzzle 1337 is 2026-05-17, released at 2026-05-17T00:00 in Tokyo.
  const todaysPuzzle = 1337;

  const archive = await solveAt(t, "2026-05-16T15:05:00Z", { host }, 1336);
  const tenMinutesIn = await solveAt(
    t,
    "2026-05-16T15:10:00Z",
    { host },
    todaysPuzzle,
  );
  const fiveMinutesIn = await solveAt(
    t,
    "2026-05-16T15:05:00Z",
    { host },
    todaysPuzzle,
  );

  expect(archive.unlockedAchievementIds).not.toContain("early_bird");
  expect(tenMinutesIn.unlockedAchievementIds).not.toContain("early_bird");
  expect(fiveMinutesIn.unlockedAchievementIds).toContain("early_bird");
});

test("profile progress shows the best streak toward each streak achievement", async () => {
  const t = setup();
  const host = await seedUser(t, {
    username: "streaker",
    displayUsername: "Streaker",
  });

  await solveAt(t, "2026-03-01T10:00:00Z", { host });
  await solveAt(t, "2026-03-02T10:00:00Z", { host });
  await solveAt(t, "2026-03-04T10:00:00Z", { host });

  const profile = await asUser(t, host).query(api.achievements.listForProfile, {
    username: "streaker",
  });
  const progress = (id: string) =>
    profile?.achievements.find((a) => a.achievementId === id)?.progress;
  expect(progress("on_a_roll")).toEqual({ current: 2, target: 3 });
  expect(progress("habit_formed")).toEqual({ current: 2, target: 7 });
});
