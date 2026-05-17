import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  decideGiveup,
  decideGuess,
} from "../convex/lib/gameTransitions";

const userA = "u_a" as unknown as Id<"users">;
const userB = "u_b" as unknown as Id<"users">;
const gameId = "g_1" as unknown as Id<"games">;
const roomId = "r_1" as unknown as Id<"rooms">;
const requestId = "p_1" as unknown as Id<"pendingRequests">;

function mkGame(
  overrides: Partial<Doc<"games">> = {},
): Doc<"games"> {
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

function mkGuess(
  overrides: Partial<Doc<"gameGuesses">> = {},
): Doc<"gameGuesses"> {
  return {
    _id: "gg_1" as unknown as Id<"gameGuesses">,
    _creationTime: 0,
    gameId,
    userId: userA,
    lemma: "x",
    distance: 5,
    source: "guess",
    createdAt: 1000,
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
        closeRequestId: null,
      },
    );
    expect(d).toEqual({ kind: "reject", reason: "not_in_progress" });
  });

  test("rejects when duplicate (existing guess for lemma)", () => {
    const d = decideGuess(
      { game: mkGame(), existingGuess: mkGuess({ lemma: "apple" }), now: 2000 },
      {
        userId: userA,
        lemma: "apple",
        distance: 5,
        source: "guess",
        closeRequestId: null,
      },
    );
    expect(d).toEqual({ kind: "reject", reason: "duplicate" });
  });

  test("records non-winning guess: no game patch, won=false", () => {
    const d = decideGuess(
      { game: mkGame(), existingGuess: null, now: 2000 },
      {
        userId: userA,
        lemma: "apple",
        distance: 7,
        source: "guess",
        closeRequestId: null,
      },
    );
    expect(d.kind).toBe("record");
    if (d.kind !== "record") return;
    expect(d.won).toBe(false);
    expect(d.gamePatch).toBeNull();
    expect(d.insertGuess).toEqual({
      gameId,
      userId: userA,
      lemma: "apple",
      distance: 7,
      source: "guess",
      createdAt: 2000,
    });
    expect(d.lastActivityAt).toBe(2000);
    expect(d.upsertHistoryForUserId).toBe(userA);
    expect(d.closeRequestId).toBeNull();
  });

  test("records winning guess (distance 0, source=guess): patches game to won", () => {
    const d = decideGuess(
      { game: mkGame(), existingGuess: null, now: 3000 },
      {
        userId: userB,
        lemma: "answer",
        distance: 0,
        source: "guess",
        closeRequestId: null,
      },
    );
    expect(d.kind).toBe("record");
    if (d.kind !== "record") return;
    expect(d.won).toBe(true);
    expect(d.gamePatch).toEqual({
      status: "won",
      winnerUserId: userB,
      answerLemma: "answer",
      endedAt: 3000,
    });
  });

  test("hint with distance=0 does not win the game", () => {
    const d = decideGuess(
      { game: mkGame(), existingGuess: null, now: 3000 },
      {
        userId: userA,
        lemma: "answer",
        distance: 0,
        source: "hint",
        closeRequestId: null,
      },
    );
    expect(d.kind).toBe("record");
    if (d.kind !== "record") return;
    expect(d.won).toBe(false);
    expect(d.gamePatch).toBeNull();
  });

  test("passes closeRequestId through when provided", () => {
    const d = decideGuess(
      { game: mkGame(), existingGuess: null, now: 2000 },
      {
        userId: userA,
        lemma: "x",
        distance: 4,
        source: "hint",
        closeRequestId: requestId,
      },
    );
    expect(d.kind).toBe("record");
    if (d.kind !== "record") return;
    expect(d.closeRequestId).toBe(requestId);
  });
});

describe("decideGiveup", () => {
  test("rejects when game not in_progress", () => {
    const d = decideGiveup(
      { game: mkGame({ status: "given_up" }), now: 4000 },
      { answerLemma: "answer", closeRequestId: null },
    );
    expect(d).toEqual({ kind: "reject", reason: "not_in_progress" });
  });

  test("finalizes: patches game to given_up with answer + endedAt", () => {
    const d = decideGiveup(
      { game: mkGame(), now: 4000 },
      { answerLemma: "answer", closeRequestId: null },
    );
    expect(d.kind).toBe("finalize");
    if (d.kind !== "finalize") return;
    expect(d.gamePatch).toEqual({
      status: "given_up",
      answerLemma: "answer",
      endedAt: 4000,
    });
    expect(d.lastActivityAt).toBe(4000);
    expect(d.closeRequestId).toBeNull();
  });

  test("passes closeRequestId through", () => {
    const d = decideGiveup(
      { game: mkGame(), now: 4000 },
      { answerLemma: "answer", closeRequestId: requestId },
    );
    if (d.kind !== "finalize") throw new Error("expected finalize");
    expect(d.closeRequestId).toBe(requestId);
  });
});
