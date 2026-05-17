import type { Doc, Id } from "../_generated/dataModel";

export type NewGuess = {
  gameId: Id<"games">;
  userId: Id<"users">;
  lemma: string;
  distance: number;
  source: "guess" | "hint";
  createdAt: number;
};

export type GamePatch = Partial<
  Pick<Doc<"games">, "status" | "winnerUserId" | "answerLemma" | "endedAt">
>;

export type GuessEvent = {
  userId: Id<"users">;
  lemma: string;
  distance: number;
  source: "guess" | "hint";
  closeRequestId: Id<"pendingRequests"> | null;
};

export type GuessSnapshot = {
  game: Doc<"games">;
  existingGuess: Doc<"gameGuesses"> | null;
  now: number;
};

export type GuessDecision =
  | { kind: "reject"; reason: "not_in_progress" | "duplicate" }
  | {
      kind: "record";
      insertGuess: NewGuess;
      gamePatch: GamePatch | null;
      lastActivityAt: number;
      upsertHistoryForUserId: Id<"users">;
      closeRequestId: Id<"pendingRequests"> | null;
      won: boolean;
    };

export function decideGuess(
  snapshot: GuessSnapshot,
  event: GuessEvent,
): GuessDecision {
  if (snapshot.game.status !== "in_progress") {
    return { kind: "reject", reason: "not_in_progress" };
  }
  if (snapshot.existingGuess !== null) {
    return { kind: "reject", reason: "duplicate" };
  }
  const won = event.distance === 0 && event.source === "guess";
  return {
    kind: "record",
    insertGuess: {
      gameId: snapshot.game._id,
      userId: event.userId,
      lemma: event.lemma,
      distance: event.distance,
      source: event.source,
      createdAt: snapshot.now,
    },
    gamePatch: won
      ? {
          status: "won",
          winnerUserId: event.userId,
          answerLemma: event.lemma,
          endedAt: snapshot.now,
        }
      : null,
    lastActivityAt: snapshot.now,
    upsertHistoryForUserId: event.userId,
    closeRequestId: event.closeRequestId,
    won,
  };
}

export type GiveupEvent = {
  answerLemma: string;
  closeRequestId: Id<"pendingRequests"> | null;
};

export type GiveupSnapshot = {
  game: Doc<"games">;
  now: number;
};

export type GiveupDecision =
  | { kind: "reject"; reason: "not_in_progress" }
  | {
      kind: "finalize";
      gamePatch: GamePatch;
      lastActivityAt: number;
      closeRequestId: Id<"pendingRequests"> | null;
    };

export function decideGiveup(
  snapshot: GiveupSnapshot,
  event: GiveupEvent,
): GiveupDecision {
  if (snapshot.game.status !== "in_progress") {
    return { kind: "reject", reason: "not_in_progress" };
  }
  return {
    kind: "finalize",
    gamePatch: {
      status: "given_up",
      answerLemma: event.answerLemma,
      endedAt: snapshot.now,
    },
    lastActivityAt: snapshot.now,
    closeRequestId: event.closeRequestId,
  };
}
