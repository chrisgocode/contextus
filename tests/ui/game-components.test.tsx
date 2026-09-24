// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuessInput } from "@/app/r/[code]/_components/GuessInput";
import { GuessList } from "@/app/r/[code]/_components/GuessList";
import { GameSetupCalendar } from "@/app/r/[code]/_components/GameSetupCalendar";
import { HintGiveupBar } from "@/app/r/[code]/_components/HintGiveupBar";
import { PendingRequestsSidebar } from "@/app/r/[code]/_components/PendingRequestsSidebar";
import { reportClientError } from "@/lib/report-error";
import { render, screen, userEvent, waitFor } from "./test-utils";

const convex = vi.hoisted(() => ({
  useAction: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

describe("GuessInput", () => {
  it("submits a trimmed non-empty guess and clears the field", async () => {
    const submit = vi.fn().mockResolvedValue({
      lemma: "apple",
      unlockedAchievementIds: [],
      won: false,
    });
    convex.useAction.mockReturnValue(submit);
    const user = userEvent.setup();

    render(<GuessInput gameId={"game" as never} />);
    const input = screen.getByPlaceholderText("Type a word…");
    await user.type(input, "apple");
    await user.click(screen.getByRole("button", { name: "Guess" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ gameId: "game", word: "apple" }),
    );
    expect(input).toHaveValue("");
  });

  it("shows duplicate and failed submission errors", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({
        alreadyGuessed: true,
        message: "Already guessed.",
      })
      .mockRejectedValueOnce(new Error("offline"));
    convex.useAction.mockReturnValue(submit);
    const user = userEvent.setup();

    render(<GuessInput gameId={"game" as never} />);
    const input = screen.getByPlaceholderText("Type a word…");
    await user.type(input, "apple");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Already guessed.",
    );

    await user.clear(input);
    await user.type(input, "pear");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not submit guess. Try again.",
    );
    expect(reportClientError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "guess.submit" }),
    );
  });
});

describe("HintGiveupBar", () => {
  it("lets a host request a hint directly", async () => {
    const hostHint = vi.fn().mockResolvedValue(null);
    convex.useAction.mockReturnValueOnce(hostHint).mockReturnValueOnce(vi.fn());
    convex.useMutation.mockReturnValue(vi.fn());
    convex.useQuery.mockReturnValue([]);
    const user = userEvent.setup();

    render(<HintGiveupBar gameId={"game" as never} isHost />);
    await user.click(screen.getByRole("button", { name: "Get hint" }));

    expect(hostHint).toHaveBeenCalledWith({ gameId: "game" });
  });

  it("disables a guest's pending request and reports request failures", async () => {
    const createRequest = vi.fn().mockRejectedValue(new Error("offline"));
    convex.useMutation.mockReturnValue(createRequest);
    convex.useAction.mockReturnValue(vi.fn());
    convex.useQuery.mockReturnValue([{ type: "hint" }]);
    const user = userEvent.setup();

    render(<HintGiveupBar gameId={"game" as never} isHost={false} />);
    expect(screen.getByRole("button", { name: "Request hint" })).toBeDisabled();
    expect(
      screen.getByText("Hint request pending host approval."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Request give up" }));
    expect(
      await screen.findByText("Could not request to give up. Try again."),
    ).toBeVisible();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "request.giveup" }),
    );
  });
});

describe("PendingRequestsSidebar", () => {
  it("approves the visible request and notifies the parent", async () => {
    const approve = vi.fn().mockResolvedValue(null);
    const onApproveSuccess = vi.fn();
    convex.useAction.mockReturnValue(approve);
    convex.useMutation.mockReturnValue(vi.fn());
    const user = userEvent.setup();

    render(
      <PendingRequestsSidebar
        pending={
          [
            {
              _id: "request",
              _creationTime: 1,
              gameId: "game",
              requesterUserId: "user",
              requesterName: "Alex",
              requesterImage: null,
              type: "hint",
            },
          ] as never
        }
        onApproveSuccess={onApproveSuccess}
      />,
    );
    expect(screen.getByText(/Alex/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(approve).toHaveBeenCalledWith({ requestId: "request" });
    expect(onApproveSuccess).toHaveBeenCalledOnce();
  });

  it("renders empty and loading states without fake controls", () => {
    convex.useAction.mockReturnValue(vi.fn());
    convex.useMutation.mockReturnValue(vi.fn());
    const { rerender } = render(<PendingRequestsSidebar pending={undefined} />);
    expect(
      screen.queryByRole("heading", { name: "Requests" }),
    ).not.toBeInTheDocument();

    rerender(<PendingRequestsSidebar pending={[]} />);
    expect(screen.getByText("No pending requests.")).toBeVisible();
  });
});

describe("GuessList", () => {
  it("shows empty and ranked guess states", () => {
    convex.useQuery.mockReturnValue({ sorted: [], latest: null });
    const { rerender } = render(<GuessList gameId={"game" as never} />);
    expect(screen.getByText("No guesses yet. Type one!")).toBeVisible();

    convex.useQuery.mockReturnValue({
      latest: {
        _id: "guess-2",
        distance: 20,
        lemma: "pear",
        source: "hint",
        userImage: null,
        userName: "Alex",
      },
      sorted: [
        {
          _id: "guess-2",
          distance: 20,
          lemma: "pear",
          source: "hint",
          userImage: null,
          userName: "Alex",
        },
        {
          _id: "guess-1",
          distance: 1800,
          lemma: "stone",
          source: "guess",
          userImage: null,
          userName: null,
        },
      ],
    });
    rerender(<GuessList gameId={"game" as never} />);

    expect(screen.getAllByText("pear")).toHaveLength(2);
    expect(screen.getByText("stone")).toBeVisible();
    expect(screen.getAllByText("hint")).toHaveLength(2);
  });
});

describe("GameSetupCalendar", () => {
  it("keeps non-host members waiting", () => {
    convex.useMutation.mockReturnValue(vi.fn());
    convex.useQuery.mockReturnValue([]);
    render(<GameSetupCalendar roomId={"room" as never} isHost={false} />);
    expect(
      screen.getByText("Waiting for the host to start a game."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Start game" }),
    ).not.toBeInTheDocument();
  });

  it("reports a failed attempt to start the selected puzzle", async () => {
    const start = vi.fn().mockRejectedValue(new Error("offline"));
    convex.useMutation.mockReturnValue(start);
    convex.useQuery.mockReturnValue([]);
    const user = userEvent.setup();
    render(<GameSetupCalendar roomId={"room" as never} isHost />);

    await user.click(screen.getByRole("button", { name: "Start game" }));
    expect(
      await screen.findByText("Could not start the game. Try again."),
    ).toBeVisible();
    expect(start).toHaveBeenCalledWith({
      contextoGameId: expect.any(Number),
      roomId: "room",
    });
    expect(reportClientError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "game.start" }),
    );
  });
});
