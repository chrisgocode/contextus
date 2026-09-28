const HINT_FLOOR = 299;
// Fits in one full hint rate limit bucket, since each tip spends a token.
export const MAX_WALK_ITERATIONS = 10;

export function initialHintTarget(best: number | null): number {
  if (best === null) return HINT_FLOOR;
  if (best > HINT_FLOOR) return HINT_FLOOR;
  if (best >= 2) return Math.floor(best / 2);
  // best === 1 → walk from rank 2 upward in caller
  return 2;
}
