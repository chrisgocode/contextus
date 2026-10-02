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
      "request.deny.hint",
      "Request not found",
      "This request is no longer available.",
    ],
    [
      "profile.update",
      "Username is already taken.",
      "Username is already taken.",
    ],
    ["guess.submit", "Word is too long", "That word is too long."],
    [
      "room.create",
      "Too many requests. Wait a moment and try again.",
      "Too many requests. Wait a moment and try again.",
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
