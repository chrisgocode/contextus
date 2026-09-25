// @vitest-environment jsdom

import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/global-error";
import { EndGameBanner } from "@/app/r/[code]/_components/EndGameBanner";
import SignIn from "@/app/signin/page";
import { reportClientError } from "@/lib/report-error";
import { render, screen, userEvent, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  dismissPrompt: vi.fn(),
  push: vi.fn(),
  signIn: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocks.signIn }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));
vi.mock("next/error", () => ({
  default: ({ statusCode }: { statusCode: number }) => (
    <p>Application error {statusCode}</p>
  ),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
  mocks.useMutation.mockReturnValue(mocks.dismissPrompt);
  mocks.useQuery.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "guesses:listForGame")
      return {
        sorted: [
          { distance: 100, source: "guess" },
          { distance: 800, source: "guess" },
          { distance: 1800, source: "hint" },
        ],
      };
    if (name === "users:getGuestAccountPrompt") return null;
    if (name === "games:getById")
      return { winner: { name: "Alex", image: null } };
    throw new Error(`Unexpected query: ${name}`);
  });
});

describe("EndGameBanner", () => {
  it("summarizes guesses, hints, and the answer", () => {
    render(
      <EndGameBanner
        answerLemma="apple"
        gameId={"game" as never}
        status="won"
      />,
    );

    expect(screen.getByRole("heading", { name: "Congrats!" })).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === "You got it in 2 guesses and 1 hints.",
      ),
    ).toBeVisible();
    expect(screen.getByText("apple")).toBeVisible();
    expect(screen.getByText("Alex won")).toBeVisible();
  });

  it("reveals the answer after the group gives up", () => {
    render(
      <EndGameBanner
        answerLemma="pear"
        gameId={"game" as never}
        status="given_up"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Game given up" }),
    ).toBeVisible();
    expect(screen.getByText("pear")).toBeVisible();
  });

  it("dismisses the guest prompt before navigating to account creation", async () => {
    mocks.dismissPrompt.mockResolvedValue(null);
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "guesses:listForGame") return { sorted: [] };
      if (name === "users:getGuestAccountPrompt") return { messageIndex: 0 };
      if (name === "games:getById") return { winner: null };
      throw new Error(`Unexpected query: ${name}`);
    });
    const user = userEvent.setup();
    render(
      <EndGameBanner
        answerLemma="apple"
        gameId={"game" as never}
        status="won"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(mocks.dismissPrompt).toHaveBeenCalledWith({});
    expect(mocks.push).toHaveBeenCalledWith("/signin?redirectTo=%2F");
  });
});

describe("SignIn", () => {
  it("preserves the requested redirect when starting Google sign-in", async () => {
    window.history.replaceState({}, "", "/signin?redirectTo=%2Fr%2FABCDEF");
    mocks.signIn.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<SignIn />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    expect(mocks.signIn).toHaveBeenCalledWith("google", {
      redirectTo: "/r/ABCDEF",
    });
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
  });

  it("reports sign-in failures and lets the user retry", async () => {
    mocks.signIn.mockRejectedValue(new Error("blocked"));
    const user = userEvent.setup();
    render(<SignIn />);
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(await screen.findByText("Sign-in failed. Try again.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "auth.signin" }),
    );
  });
});

it("reports uncaught application errors", async () => {
  const error = new Error("boom");
  render(<GlobalError error={error} />);
  expect(screen.getByText("Application error 0")).toBeVisible();
  await waitFor(() =>
    expect(mocks.captureException).toHaveBeenCalledWith(error),
  );
});
