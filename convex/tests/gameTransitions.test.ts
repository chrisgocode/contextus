import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { decideGiveup, decideGuess } from "../lib/gameTransitions";

const userA = "u_a" as unknown as Id<"users">;
const gameId = "g_1" as unknown as Id<"games">;
const roomId = "r_1" as unknown as Id<"rooms">;

function mkGame(overrides: Partial<Doc<"games">> = {}): Doc<"games"> {
  return {
    _id: gameId,
    _creationTime: 0,
    roomId,
    contextoGameId: 42,
    status: "in_progress",
    startedAt: 1000,
    ...overrides,
  };
}

describe("decideGuess", () => {
  test("rejects when game not in_progress", () => {
    const d = decideGuess(
      { game: mkGame({ status: "won" }), existingGuess: null, now: 2000 },
      {
        userId: userA,
        lemma: "apple",
        distance: 5,
        source: "guess",
      },
    );
    expect(d).toEqual({ kind: "reject", reason: "not_in_progress" });
  });

  test("hint with distance=0 does not win the game", () => {
    const d = decideGuess(
      { game: mkGame(), existingGuess: null, now: 3000 },
      {
        userId: userA,
        lemma: "answer",
        distance: 0,
        source: "hint",
      },
    );
    expect(d.kind).toBe("record");
    if (d.kind !== "record") return;
    expect(d.won).toBe(false);
    expect(d.gamePatch).toBeNull();
  });
});

describe("decideGiveup", () => {
  test("rejects when game not in_progress", () => {
    const d = decideGiveup(
      { game: mkGame({ status: "given_up" }), now: 4000 },
      { answerLemma: "answer" },
    );
    expect(d).toEqual({ kind: "reject", reason: "not_in_progress" });
  });
});
