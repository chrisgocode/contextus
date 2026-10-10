import { type AppErrorCode, appErrorData } from "@/convex/lib/errors";

// Each client error context lists the server errors it expects, by code, and
// what to tell the user for each. A rule without a message shows the server's
// message as is. Expected errors aren't sent to Sentry; anything else is.
type Rule = readonly [code: AppErrorCode, message?: string];

// Guesses, hints, room creation and Guest sign-ups are all rate limited, so
// every context expects this one.
const rateLimited: Rule = ["rateLimited"];

const gameEnded: Rule = ["gameEnded", "This game has already ended."];
const hintGuessed: Rule = ["hintDuplicate", "That hint was already guessed."];
const noHintsLeft: Rule = ["hintExhausted", "No unguessed hints remain."];
const alreadyHandled: Rule = [
  "requestHandled",
  "This request was already handled.",
];
const hostAnswered: Rule = [
  "requestHandled",
  "The host already answered this request.",
];
const requestGone: Rule = [
  "requestNotFound",
  "This request is no longer available.",
];
const roomNotFound: Rule = ["roomNotFound", "Room not found."];
const guestRoomLimit: Rule = ["guestRoomLimit"];

export const requestMessages = {
  "host.hint": [gameEnded, hintGuessed, noHintsLeft],
  "host.giveup": [gameEnded],
  "request.hint": [
    gameEnded,
    ["requestAlreadyPending", "Hint request already pending."],
    ["requestPendingByOther", "Someone already asked for a hint."],
  ],
  "request.giveup": [
    gameEnded,
    ["requestAlreadyPending", "Give-up request already pending."],
    ["requestPendingByOther", "Someone already asked to give up."],
  ],
  "request.approve.hint": [gameEnded, hintGuessed, noHintsLeft, alreadyHandled],
  "request.approve.giveup": [gameEnded, alreadyHandled],
  "request.cancel.hint": [hostAnswered],
  "request.cancel.giveup": [hostAnswered],
  "request.deny.hint": [requestGone, alreadyHandled],
  "request.deny.giveup": [requestGone, alreadyHandled],
} satisfies Record<string, readonly Rule[]>;

export const gameMessages = {
  "guess.submit": [gameEnded, ["wordTooLong", "That word is too long."]],
  "game.start": [
    roomNotFound,
    ["gameInProgress", "A game is already in progress."],
  ],
} satisfies Record<string, readonly Rule[]>;

export const roomMessages = {
  "room.create": [guestRoomLimit],
  "room.autojoin": [roomNotFound, guestRoomLimit],
  "room.guestJoin": [],
  "room.playAgain": [],
  "room.leave": [],
  "room.end": [],
  "room.clipboard": [],
} satisfies Record<string, readonly Rule[]>;

export const accountMessages = {
  "profile.update": [
    ["usernameLength"],
    ["usernameCharacters"],
    ["usernameTaken"],
    ["profileImageTooLarge"],
    ["profileImageType"],
  ],
  "guestPrompt.dismiss": [],
  "auth.signin": [],
  "auth.signOut": [],
  "users.setTimeZone": [],
} satisfies Record<string, readonly Rule[]>;

const messages: Record<ErrorContext, readonly Rule[]> = {
  ...requestMessages,
  ...gameMessages,
  ...roomMessages,
  ...accountMessages,
};

export type ErrorContext =
  | keyof typeof requestMessages
  | keyof typeof gameMessages
  | keyof typeof roomMessages
  | keyof typeof accountMessages;

/** The message for an error `context` expects, or null if it's unexpected. */
export function expectedClientErrorMessage(
  error: unknown,
  context: ErrorContext,
): string | null {
  const data = appErrorData(error);
  if (data === null) return null;
  for (const [code, message] of [rateLimited, ...messages[context]]) {
    if (data.code === code) return message ?? data.message;
  }
  return null;
}
