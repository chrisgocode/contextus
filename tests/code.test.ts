import { expect, test } from "vitest";
import { ROOM_CODE_REGEX, generateRoomCode } from "../convex/lib/code";

test("generateRoomCode default length 6", () => {
  for (let i = 0; i < 50; i++) {
    expect(generateRoomCode()).toMatch(ROOM_CODE_REGEX);
  }
});

test("generateRoomCode excludes ambiguous chars", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode();
    expect(code).not.toMatch(/[01OI]/);
  }
});
