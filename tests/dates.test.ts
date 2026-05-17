import { expect, test } from "vitest";
import {
  LAUNCH_DATE_UTC,
  contextoGameIdForDate,
  dateForContextoGameId,
} from "../convex/lib/dates";

test("gameId 1 = launch date", () => {
  expect(contextoGameIdForDate(new Date(LAUNCH_DATE_UTC))).toBe(1);
});

test("gameId 1336 = 2026-05-16 UTC", () => {
  expect(contextoGameIdForDate(new Date(Date.UTC(2026, 4, 16)))).toBe(1336);
});

test("roundtrip", () => {
  for (const n of [1, 2, 100, 500, 1336, 2000]) {
    expect(contextoGameIdForDate(dateForContextoGameId(n))).toBe(n);
  }
});
