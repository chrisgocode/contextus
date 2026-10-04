import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  it.each<[ErrorContext, string, string | null]>([
    [
      "guess.submit",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    ["guess.submit", "Word is too long", "That word is too long."],
    ["guess.submit", "Not authenticated", null],
    [
      "host.hint",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "host.hint",
      "Hint lemma already guessed",
      "That hint was already guessed.",
    ],
    [
      "host.hint",
      "Could not find an unguessed hint",
      "No unguessed hints remain.",
    ],
    ["host.hint", "Host only", null],
    ["host.hint", "Contexto is unavailable, please try again", null],
    ["host.hint", "Contexto returned an unexpected response", null],
    [
      "host.giveup",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    ["host.giveup", "Could not find an unguessed hint", null],
    [
      "request.hint",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "request.hint",
      "hint request already pending",
      "Hint request already pending.",
    ],
    [
      "request.hint",
      "Another hint request is already pending",
      "Someone already asked for a hint.",
    ],
    ["request.hint", "Another giveup request is already pending", null],
    [
      "request.giveup",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "request.giveup",
      "giveup request already pending",
      "Give-up request already pending.",
    ],
    [
      "request.giveup",
      "Another giveup request is already pending",
      "Someone already asked to give up.",
    ],
    [
      "request.approve.hint",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "request.approve.hint",
      "Hint lemma already guessed",
      "That hint was already guessed.",
    ],
    [
      "request.approve.hint",
      "Could not find an unguessed hint",
      "No unguessed hints remain.",
    ],
    [
      "request.approve.hint",
      "Request not found or already handled",
      "This request was already handled.",
    ],
    [
      "request.approve.giveup",
      "Request not found or already handled",
      "This request was already handled.",
    ],
    ["request.approve.giveup", "Hint lemma already guessed", null],
    [
      "request.cancel.hint",
      "Request not found or already handled",
      "The host already answered this request.",
    ],
    [
      "request.cancel.giveup",
      "Request not found or already handled",
      "The host already answered this request.",
    ],
    ["request.cancel.hint", "Game is no longer in progress", null],
    [
      "request.deny.hint",
      "Request not found",
      "This request is no longer available.",
    ],
    [
      "request.deny.giveup",
      "Request not found",
      "This request is no longer available.",
    ],
    ["request.deny.hint", "Request not found or already handled", null],
    ["game.start", "Room not found", "Room not found."],
    [
      "game.start",
      "A game is already in progress",
      "A game is already in progress.",
    ],
    ["game.start", "Invalid game id", null],
    ["room.create", "Guest room limit reached", "Guest room limit reached"],
    ["room.autojoin", "Guest room limit reached", "Guest room limit reached"],
    ["room.autojoin", "Room not found", "Room not found."],
    ["room.autojoin", "Not a member of this room", null],
    ["room.leave", "Room not found", null],
    ["room.playAgain", "Group not found", null],
    [
      "profile.update",
      "Username must be 3-20 characters.",
      "Username must be 3-20 characters.",
    ],
    [
      "profile.update",
      "Username can only contain letters and numbers.",
      "Username can only contain letters and numbers.",
    ],
    [
      "profile.update",
      "Username is already taken.",
      "Username is already taken.",
    ],
    [
      "profile.update",
      "Profile image must be 1 MB or smaller.",
      "Profile image must be 1 MB or smaller.",
    ],
    [
      "profile.update",
      "Profile image must be a PNG, JPEG, WebP or GIF.",
      "Profile image must be a PNG, JPEG, WebP or GIF.",
    ],
    ["profile.update", "Uploaded profile image was not found.", null],
    [
      "room.create",
      "Too many requests. Wait a moment and try again.",
      "Too many requests. Wait a moment and try again.",
    ],
    [
      "guess.submit",
      "Too many requests. Wait a moment and try again.",
      "Too many requests. Wait a moment and try again.",
    ],
  ])("%s: %s → %s", (context, data, expected) => {
    const error = { data, message: "Server Error stack trace" };
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
      runMutation(() => Promise.reject({ data: "Word is too long" }), {
        context: "guess.submit",
        fallback: "Could not submit guess.",
      }),
    ).resolves.toEqual({ ok: false, message: "That word is too long." });
    expect(captureException).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("That word is too long.");
  });
});
