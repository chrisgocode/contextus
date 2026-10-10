import { ConvexError } from "convex/values";

// Errors that code matches on: the client to pick a user message, the server
// to categorize a failed Game turn. Each is thrown as `ConvexError` data
// `{ code, message }`. Match on `code`; `message` is the default wording and
// can change freely. Errors nothing matches on stay plain strings.
const messages = {
  notAuthenticated: "Not authenticated",
  notMember: "Not a member of this room",
  hostOnly: "Host only",
  roomNotFound: "Room not found",
  gameNotFound: "Game not found",
  gameEnded: "Game is no longer in progress",
  gameInProgress: "A game is already in progress",
  guestRoomLimit: "Guest room limit reached",
  rateLimited: "Too many requests. Wait a moment and try again.",
  emptyWord: "Empty word",
  wordTooLong: "Word is too long",
  hintDuplicate: "Hint lemma already guessed",
  hintExhausted: "Could not find an unguessed hint",
  requestNotFound: "Request not found",
  requestHandled: "Request not found or already handled",
  requestAlreadyPending: "Request already pending",
  requestPendingByOther: "Another request is already pending",
  contextoUnavailable: "Contexto is unavailable, please try again",
  contextoUnexpectedPayload: "Contexto returned an unexpected response",
  usernameLength: "Username has the wrong length.",
  usernameCharacters: "Username can only contain letters and numbers.",
  usernameTaken: "Username is already taken.",
  profileImageTooLarge: "Profile image must be 1 MB or smaller.",
  profileImageType: "Profile image must be a PNG, JPEG, WebP or GIF.",
} as const;

export type AppErrorCode = keyof typeof messages;

export type AppErrorData = { code: AppErrorCode; message: string };

/** The error for `code`, with `message` in place of the default wording. */
export function appError(
  code: AppErrorCode,
  message: string = messages[code],
): ConvexError<AppErrorData> {
  return new ConvexError({ code, message });
}

/**
 * The `{ code, message }` data of an error made by `appError`, or null for
 * anything else. Reads the shape, so it works on both sides of the wire.
 */
export function appErrorData(error: unknown): AppErrorData | null {
  if (typeof error !== "object" || error === null || !("data" in error))
    return null;
  const { data } = error;
  if (typeof data !== "object" || data === null) return null;
  if (!("code" in data) || !("message" in data)) return null;
  const { code, message } = data;
  if (typeof code !== "string" || typeof message !== "string") return null;
  if (!Object.hasOwn(messages, code)) return null;
  return { code: code as AppErrorCode, message };
}
