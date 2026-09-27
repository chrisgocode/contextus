import { describe, expect, it } from "vitest";
import { contextoGameIdForDate, launchDate } from "@/lib/contexto";

describe("contextoGameIdForDate", () => {
  it("numbers the launch day as game 1", () => {
    expect(contextoGameIdForDate(launchDate())).toBe(1);
  });

  it("maps every moment of a local calendar day to that day's game", () => {
    expect(contextoGameIdForDate(new Date(2026, 4, 16, 0, 0))).toBe(1336);
    expect(contextoGameIdForDate(new Date(2026, 4, 16, 23, 59))).toBe(1336);
    expect(contextoGameIdForDate(new Date(2026, 4, 17, 0, 0))).toBe(1337);
  });
});
