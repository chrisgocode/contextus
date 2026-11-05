import type { Doc, Id } from "../_generated/dataModel";
import type { GamePlayerStats } from "./achievements";

// Storage stays compatible with existing history rows. Attempts and credited
// solves are independent milestones, each with its own first-event metadata.
type History = Pick<
  Doc<"userGameHistory">,
  | "firstPlayedAt"
  | "firstAttemptAt"
  | "firstAttemptDistance"
  | "firstAttemptGameId"
  | "firstSolvedAt"
  | "firstSolvedGameId"
>;

type Milestone<T> = { kind: "unreached" } | { kind: "reached"; event: T };
type Decision<T> = { kind: "unchanged" } | { kind: "record"; patch: T };

function attempt(history: History): Milestone<{
  at: number;
  distance?: number;
  gameId?: Id<"games">;
}> {
  return history.firstAttemptAt === undefined
    ? { kind: "unreached" }
    : {
        kind: "reached",
        event: {
          at: history.firstAttemptAt,
          distance: history.firstAttemptDistance,
          gameId: history.firstAttemptGameId,
        },
      };
}

function solve(
  history: History,
): Milestone<{ at: number; gameId?: Id<"games"> }> {
  return history.firstSolvedAt === undefined
    ? { kind: "unreached" }
    : {
        kind: "reached",
        event: { at: history.firstSolvedAt, gameId: history.firstSolvedGameId },
      };
}

export function firstAttempt(
  history: History,
  event: { now: number; distance: number; gameId: Id<"games"> },
): Decision<
  Pick<
    History,
    "firstAttemptAt" | "firstAttemptDistance" | "firstAttemptGameId"
  >
> {
  if (attempt(history).kind === "reached") return { kind: "unchanged" };
  return {
    kind: "record",
    patch: {
      firstAttemptAt: event.now,
      firstAttemptDistance: event.distance,
      firstAttemptGameId: event.gameId,
    },
  };
}

export function firstSolve(
  history: History,
  gameId: Id<"games">,
  now: number,
): Decision<Pick<History, "firstSolvedAt" | "firstSolvedGameId">> {
  if (solve(history).kind === "reached") return { kind: "unchanged" };
  return {
    kind: "record",
    patch: { firstSolvedAt: now, firstSolvedGameId: gameId },
  };
}

// Ties keep the account's metadata, matching the existing merge policy. Select
// each entire event together so its distance and Game never drift from its time.
function earliest<T extends { at: number }>(
  account: Milestone<T>,
  guest: Milestone<T>,
): Milestone<T> {
  if (account.kind === "unreached") return guest;
  if (guest.kind === "unreached") return account;
  return guest.event.at < account.event.at ? guest : account;
}

export function reconcileHistory(account: History, guest: History) {
  const firstAttempt = earliest(attempt(account), attempt(guest));
  const accountSolve = solve(account);
  const guestSolve = solve(guest);
  const firstSolve = earliest(accountSolve, guestSolve);
  return {
    overlappingSolve:
      accountSolve.kind === "reached" && guestSolve.kind === "reached",
    patch: {
      firstPlayedAt: Math.min(account.firstPlayedAt, guest.firstPlayedAt),
      firstAttemptAt:
        firstAttempt.kind === "reached" ? firstAttempt.event.at : undefined,
      firstAttemptDistance:
        firstAttempt.kind === "reached"
          ? firstAttempt.event.distance
          : guest.firstAttemptDistance,
      firstAttemptGameId:
        firstAttempt.kind === "reached"
          ? firstAttempt.event.gameId
          : guest.firstAttemptGameId,
      firstSolvedAt:
        firstSolve.kind === "reached" ? firstSolve.event.at : undefined,
      firstSolvedGameId:
        firstSolve.kind === "reached"
          ? firstSolve.event.gameId
          : guest.firstSolvedGameId,
    },
  };
}

type NoBacktracking =
  | { kind: "eligible"; lastDistance: number }
  | { kind: "failed" };

function advanceNoBacktracking(
  state: NoBacktracking,
  distance: number,
): NoBacktracking {
  if (state.kind === "failed" || !(distance < state.lastDistance))
    return { kind: "failed" };
  return { kind: "eligible", lastDistance: distance };
}

// Called only for accepted real guesses. Failure is absorbing within this Game;
// starting another Game starts a fresh sequence without resetting history.
export function advanceRealGuess(
  previous: GamePlayerStats | null,
  distance: number,
): GamePlayerStats {
  const eligibility =
    previous === null
      ? { kind: "eligible" as const, lastDistance: distance }
      : advanceNoBacktracking(
          previous.noBacktrackingSoFar
            ? { kind: "eligible", lastDistance: previous.lastDistance }
            : { kind: "failed" },
          distance,
        );
  return {
    realGuessCount: (previous?.realGuessCount ?? 0) + 1,
    bestDistance: Math.min(previous?.bestDistance ?? distance, distance),
    lastDistance: distance,
    noBacktrackingSoFar: eligibility.kind === "eligible",
  };
}

// Progress is a best-so-far observation, bounded by the current definition.
// Lowering a target repairs stale progress even when the new observation is low.
export function advanceProgress(
  previous: number | undefined,
  current: number,
  target: number,
) {
  return Math.min(target, Math.max(previous ?? current, current));
}
