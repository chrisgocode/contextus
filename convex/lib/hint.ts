const HINT_FLOOR = 299;
// The walk starts at the first unguessed rank, so it only retries when a tip
// turns out to be taken. Fits in one full hint rate limit bucket, since each
// tip spends a token.
export const MAX_WALK_ITERATIONS = 10;

export function initialHintTarget(best: number | null): number {
  if (best === null) return HINT_FLOOR;
  if (best > HINT_FLOOR) return HINT_FLOOR;
  if (best >= 2) return Math.floor(best / 2);
  // best === 1 → walk from rank 2 upward in caller
  return 2;
}

// Search state is local to one action; a retry never authorizes the next write.
export type HintSearch =
  | { kind: "single"; target: number }
  | { kind: "walking"; target: number; attempts: number };

export type HintDecision =
  | { kind: "complete" }
  | { kind: "retry"; search: HintSearch }
  | { kind: "reject"; reason: "hintDuplicate" | "hintExhausted" };

export function beginHintSearch(
  best: number | null,
  walkFrom: number,
): HintSearch {
  return best === 1
    ? { kind: "walking", target: walkFrom, attempts: 0 }
    : { kind: "single", target: initialHintTarget(best) };
}

export function decideHint(
  search: HintSearch,
  status: "recorded" | "duplicate",
): HintDecision {
  if (status === "recorded") return { kind: "complete" };
  if (search.kind === "single")
    return { kind: "reject", reason: "hintDuplicate" };
  const attempts = search.attempts + 1;
  return attempts >= MAX_WALK_ITERATIONS
    ? { kind: "reject", reason: "hintExhausted" }
    : {
        kind: "retry",
        search: { kind: "walking", target: search.target + 1, attempts },
      };
}
