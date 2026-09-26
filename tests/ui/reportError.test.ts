import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "../../lib/report-error";
import { captureException } from "../../lib/sentry-client";

vi.mock("../../lib/sentry-client", () => ({ captureException: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../../lib/toast", () => ({
  lazyToast: (show: (t: typeof toast) => void) => show(toast),
}));

describe("reportClientError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports unexpected errors and only suppresses explicitly disabled toasts", () => {
    const error = new Error("failure");

    reportClientError(error, {
      userMessage: "Inline error",
      context: "inline",
      showToast: false,
    });
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { surface: "inline" },
    });
    expect(toast.error).not.toHaveBeenCalled();

    reportClientError(error, { userMessage: "Toast error" });
    expect(toast.error).toHaveBeenCalledWith("Toast error");
  });

  it.each([
    [
      "guess.submit",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "host.hint",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "host.giveup",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "request.hint",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "request.giveup",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "request.approve.hint",
      "Game is no longer in progress",
      "This game has already ended.",
    ],
    [
      "request.approve.giveup",
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
    [
      "request.hint",
      "hint request already pending",
      "Hint request already pending.",
    ],
    [
      "request.giveup",
      "giveup request already pending",
      "Give-up request already pending.",
    ],
    ["room.autojoin", "Room not found", "Room not found."],
    ["game.start", "Room not found", "Room not found."],
    [
      "game.start",
      "A game is already in progress",
      "A game is already in progress.",
    ],
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
  ])("handles %s: %s", (context, data, message) => {
    const error = { data, message: "Server Error stack trace" };
    reportClientError(error, { context, userMessage: "Fallback" });
    expect(captureException).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(message);
  });

  it.each([
    ["guess.submit", "Not authenticated"],
    ["host.hint", "Host only"],
    ["room.join", "Not a member of this room"],
    ["game.start", "Invalid game id"],
    ["profile.update", "Uploaded profile image was not found."],
    ["room.playAgain", "Group not found"],
    ["host.hint", "Contexto is unavailable, please try again"],
    ["host.hint", "Contexto returned an unexpected response"],
    ["room.leave", "Room not found"],
  ])("still reports %s: %s", (context, data) => {
    const error = { data };
    reportClientError(error, { context, userMessage: "Fallback" });
    expect(captureException).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("Fallback");
  });
});
