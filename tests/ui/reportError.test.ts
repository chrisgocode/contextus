import { ConvexError, type Value } from "convex/values";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appError } from "../../convex/lib/errors";
import type { ErrorContext } from "../../lib/client-errors";
import { reportClientError, runMutation } from "../../lib/report-error";
import { captureException } from "../../lib/sentry-client";

vi.mock("../../lib/sentry-client", () => ({ captureException: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../../lib/toast", () => ({
  lazyToast: (show: (t: typeof toast) => void) => show(toast),
}));

beforeEach(() => vi.clearAllMocks());

// Contexts come from the message tables, so a typo doesn't compile.
// @ts-expect-error "request.aprove.hint" is not an ErrorContext.
const typo: ErrorContext = "request.aprove.hint";
void typo;

describe("reportClientError", () => {
  it("reports unexpected errors and only suppresses explicitly disabled toasts", () => {
    const error = new Error("failure");

    expect(
      reportClientError(error, {
        userMessage: "Inline error",
        context: "guess.submit",
        showToast: false,
      }),
    ).toBe("Inline error");
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { surface: "guess.submit" },
    });
    expect(toast.error).not.toHaveBeenCalled();

    reportClientError(error, {
      userMessage: "Toast error",
      context: "room.end",
    });
    expect(toast.error).toHaveBeenCalledWith("Toast error");
  });

  // Every expected server error, by the context that expects it. Server
  // errors not listed for a context are reported to Sentry.
  it.each<[ErrorContext, ConvexError<Value>, string | null]>([
    ["guess.submit", appError("gameEnded"), "This game has already ended."],
    ["guess.submit", appError("wordTooLong"), "That word is too long."],
    ["guess.submit", appError("notAuthenticated"), null],
    ["host.hint", appError("gameEnded"), "This game has already ended."],
    ["host.hint", appError("hintDuplicate"), "That hint was already guessed."],
    ["host.hint", appError("hintExhausted"), "No unguessed hints remain."],
    ["host.hint", appError("hostOnly"), null],
    ["host.hint", appError("contextoUnavailable"), null],
    ["host.hint", appError("contextoUnexpectedPayload"), null],
    ["host.giveup", appError("gameEnded"), "This game has already ended."],
    ["host.giveup", appError("hintExhausted"), null],
    ["request.hint", appError("gameEnded"), "This game has already ended."],
    [
      "request.hint",
      appError("requestAlreadyPending", "hint request already pending"),
      "Hint request already pending.",
    ],
    [
      "request.hint",
      appError(
        "requestPendingByOther",
        "Another hint request is already pending",
      ),
      "Someone already asked for a hint.",
    ],
    ["request.hint", appError("requestNotFound"), null],
    ["request.giveup", appError("gameEnded"), "This game has already ended."],
    [
      "request.giveup",
      appError("requestAlreadyPending", "giveup request already pending"),
      "Give-up request already pending.",
    ],
    [
      "request.giveup",
      appError(
        "requestPendingByOther",
        "Another giveup request is already pending",
      ),
      "Someone already asked to give up.",
    ],
    [
      "request.approve.hint",
      appError("gameEnded"),
      "This game has already ended.",
    ],
    [
      "request.approve.hint",
      appError("hintDuplicate"),
      "That hint was already guessed.",
    ],
    [
      "request.approve.hint",
      appError("hintExhausted"),
      "No unguessed hints remain.",
    ],
    [
      "request.approve.hint",
      appError("requestHandled"),
      "This request was already handled.",
    ],
    [
      "request.approve.giveup",
      appError("requestHandled"),
      "This request was already handled.",
    ],
    ["request.approve.giveup", appError("hintDuplicate"), null],
    [
      "request.cancel.hint",
      appError("requestHandled"),
      "The host already answered this request.",
    ],
    [
      "request.cancel.giveup",
      appError("requestHandled"),
      "The host already answered this request.",
    ],
    ["request.cancel.hint", appError("gameEnded"), null],
    [
      "request.deny.hint",
      appError("requestNotFound"),
      "This request is no longer available.",
    ],
    [
      "request.deny.giveup",
      appError("requestNotFound"),
      "This request is no longer available.",
    ],
    [
      "request.deny.hint",
      appError("requestHandled"),
      "This request was already handled.",
    ],
    ["game.start", appError("roomNotFound"), "Room not found."],
    [
      "game.start",
      appError("gameInProgress"),
      "A game is already in progress.",
    ],
    ["game.start", new ConvexError("Invalid game id"), null],
    ["room.create", appError("guestRoomLimit"), "Guest room limit reached"],
    ["room.autojoin", appError("guestRoomLimit"), "Guest room limit reached"],
    ["room.autojoin", appError("roomNotFound"), "Room not found."],
    ["room.autojoin", appError("notMember"), null],
    ["room.leave", appError("roomNotFound"), null],
    ["room.playAgain", new ConvexError("Group not found"), null],
    [
      "profile.update",
      appError("usernameLength", "Username must be 3-20 characters."),
      "Username must be 3-20 characters.",
    ],
    [
      "profile.update",
      appError("usernameCharacters"),
      "Username can only contain letters and numbers.",
    ],
    ["profile.update", appError("usernameTaken"), "Username is already taken."],
    [
      "profile.update",
      appError("profileImageTooLarge"),
      "Profile image must be 1 MB or smaller.",
    ],
    [
      "profile.update",
      appError("profileImageType"),
      "Profile image must be a PNG, JPEG, WebP or GIF.",
    ],
    [
      "profile.update",
      new ConvexError("Uploaded profile image was not found."),
      null,
    ],
    [
      "room.create",
      appError("rateLimited"),
      "Too many requests. Wait a moment and try again.",
    ],
    [
      "guess.submit",
      appError("rateLimited"),
      "Too many requests. Wait a moment and try again.",
    ],
    // Only codes are matched: the same wording without one is unexpected.
    ["guess.submit", new ConvexError("Word is too long"), null],
    ["guess.submit", new ConvexError({ code: "notACode", message: "?" }), null],
  ])("%s: %s → %s", (context, error, expected) => {
    const message = reportClientError(error, {
      context,
      userMessage: "Fallback",
    });
    expect(message).toBe(expected ?? "Fallback");
    expect(toast.error).toHaveBeenCalledWith(expected ?? "Fallback");
    if (expected === null) expect(captureException).toHaveBeenCalledOnce();
    else expect(captureException).not.toHaveBeenCalled();
  });
});

describe("runMutation", () => {
  it("returns the value of a successful call without reporting", async () => {
    await expect(
      runMutation(() => Promise.resolve("abc"), {
        context: "room.create",
        fallback: "Fallback",
      }),
    ).resolves.toEqual({ ok: true, value: "abc" });
    expect(captureException).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("returns the message for a failure and reports it like reportClientError", async () => {
    const error = new Error("offline");
    await expect(
      runMutation(() => Promise.reject(error), {
        context: "guess.submit",
        fallback: "Could not submit guess.",
        showToast: false,
      }),
    ).resolves.toEqual({ ok: false, message: "Could not submit guess." });
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { surface: "guess.submit" },
    });
    expect(toast.error).not.toHaveBeenCalled();

    await expect(
      runMutation(() => Promise.reject(appError("wordTooLong")), {
        context: "guess.submit",
        fallback: "Could not submit guess.",
      }),
    ).resolves.toEqual({ ok: false, message: "That word is too long." });
    expect(captureException).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("That word is too long.");
  });
});
