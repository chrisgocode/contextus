import { expect, test } from "vitest";
import { initialHintTarget, HINT_FLOOR } from "../convex/lib/hint";

test("no guesses -> 299", () => {
  expect(initialHintTarget(null)).toBe(HINT_FLOOR);
});

test("best=500 -> 299", () => {
  expect(initialHintTarget(500)).toBe(HINT_FLOOR);
});

test("best=299 -> 299", () => {
  expect(initialHintTarget(299)).toBe(HINT_FLOOR);
});

test("best=100 -> 50", () => {
  expect(initialHintTarget(100)).toBe(50);
});

test("best=2 -> 1", () => {
  expect(initialHintTarget(2)).toBe(1);
});

test("best=1 -> 2 (walk start)", () => {
  expect(initialHintTarget(1)).toBe(2);
});
