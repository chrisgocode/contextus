import { expect, test } from "vitest";
import { generateRoomCode } from "../lib/code";

test("generateRoomCode makes 6-char codes without ambiguous chars", () => {
  for (let i = 0; i < 200; i++) {
    expect(generateRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  }
});
