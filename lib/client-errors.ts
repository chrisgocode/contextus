export function getErrorData(error: unknown): unknown {
  return typeof error === "object" && error !== null && "data" in error
    ? error.data
    : undefined;
}

// Each client error context lists the server errors it expects, as
// `ConvexError` data, and what to tell the user for each. A rule without a
// message shows the server's text as is. Expected errors aren't sent to
// Sentry; anything else is.
type Rule = readonly [data: string | RegExp, message?: string];

// Guesses, hints, room creation and Guest sign-ups are all rate limited, so
// every context expects this one.
const rateLimited: Rule = ["Too many requests. Wait a moment and try again."];

const gameEnded: Rule = [
  "Game is no longer in progress",
  "This game has already ended.",
];
const hintGuessed: Rule = [
  "Hint lemma already guessed",
  "That hint was already guessed.",
];
const noHintsLeft: Rule = [
  "Could not find an unguessed hint",
  "No unguessed hints remain.",
];
const alreadyHandled: Rule = [
  "Request not found or already handled",
  "This request was already handled.",
];
const hostAnswered: Rule = [
  "Request not found or already handled",
  "The host already answered this request.",
];
const requestGone: Rule = [
  "Request not found",
  "This request is no longer available.",
];
const roomNotFound: Rule = ["Room not found", "Room not found."];
const guestRoomLimit: Rule = ["Guest room limit reached"];

export const requestMessages = {
  "host.hint": [gameEnded, hintGuessed, noHintsLeft],
  "host.giveup": [gameEnded],
  "request.hint": [
    gameEnded,
    ["hint request already pending", "Hint request already pending."],
    [
      "Another hint request is already pending",
      "Someone already asked for a hint.",
    ],
  ],
  "request.giveup": [
    gameEnded,
    ["giveup request already pending", "Give-up request already pending."],
    [
      "Another giveup request is already pending",
      "Someone already asked to give up.",
    ],
  ],
  "request.approve.hint": [gameEnded, hintGuessed, noHintsLeft, alreadyHandled],
  "request.approve.giveup": [gameEnded, alreadyHandled],
  "request.cancel.hint": [hostAnswered],
  "request.cancel.giveup": [hostAnswered],
  "request.deny.hint": [requestGone],
  "request.deny.giveup": [requestGone],
} satisfies Record<string, readonly Rule[]>;

export const gameMessages = {
  "guess.submit": [gameEnded, ["Word is too long", "That word is too long."]],
  "game.start": [
    roomNotFound,
    ["A game is already in progress", "A game is already in progress."],
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
    [/^Username must be \d+-\d+ characters\.$/],
    ["Username can only contain letters and numbers."],
    ["Username is already taken."],
    ["Profile image must be 1 MB or smaller."],
    ["Profile image must be a PNG, JPEG, WebP or GIF."],
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
  const data = getErrorData(error);
  if (typeof data !== "string") return null;
  for (const [match, message] of [rateLimited, ...messages[context]]) {
    if (typeof match === "string" ? data === match : match.test(data))
      return message ?? data;
  }
  return null;
}
