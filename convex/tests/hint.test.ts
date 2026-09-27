import { expect, test } from "vitest";
import { initialHintTarget } from "../lib/hint";

test.each([
  // Anything worse than rank 299 starts at the floor.
  [null, 299],
  [500, 299],
  [300, 299],
  // At or under the floor, halve so the hint beats the current best.
  [299, 149],
  [100, 50],
  [2, 1],
  // Rank 1 cannot be halved; the caller walks upward from rank 2.
  [1, 2],
])("best rank %s starts the hint search at %i", (best, target) => {
  expect(initialHintTarget(best)).toBe(target);
});
