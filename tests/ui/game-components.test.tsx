import { getFunctionName } from "convex/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GuessInput } from "@/app/(app)/r/[code]/_components/GuessInput";
import { GuessList } from "@/app/(app)/r/[code]/_components/GuessList";
import { loadCalendar } from "@/app/(app)/r/[code]/_components/calendar-loader";
import { GameSetupCalendar } from "@/app/(app)/r/[code]/_components/GameSetupCalendar";
import { HintGiveupBar } from "@/app/(app)/r/[code]/_components/HintGiveupBar";
import { AssistSheet } from "@/app/(app)/r/[code]/_components/AssistSheet";
import {
  HostRequestList,
  HostRequestRows,
  useHostRequests,
} from "@/app/(app)/r/[code]/_components/HostRequestRows";
import { RequestRows } from "@/app/(app)/r/[code]/_components/RequestRows";
import { reportClientError } from "@/lib/report-error";
import { act, cleanup, render, screen, userEvent, waitFor } from "./test-utils";

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
  sessionStorage.clear();
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

    render(
      <GuessInput
        gameId={"game" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("Type a word…");
    await user.type(input, "apple");
    await user.click(screen.getByRole("button", { name: "Guess" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ gameId: "game", word: "apple" }),
    );
    expect(input).toHaveValue("");
  });

  it("keeps an unsent guess across reloads until it is submitted", async () => {
    const submit = vi.fn().mockResolvedValue({
      lemma: "apple",
      unlockedAchievementIds: [],
      won: false,
    });
    convex.useAction.mockReturnValue(submit);
    const user = userEvent.setup();

    const first = render(
      <GuessInput
        gameId={"game" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    await user.type(screen.getByPlaceholderText("Type a word…"), "apple");
    first.unmount();

    render(
      <GuessInput
        gameId={"other" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Type a word…")).toHaveValue("");
    cleanup();

    render(
      <GuessInput
        gameId={"game" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("Type a word…");
    expect(input).toHaveValue("apple");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    await waitFor(() => expect(input).toHaveValue(""));
    cleanup();

    render(
      <GuessInput
        gameId={"game" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Type a word…")).toHaveValue("");
  });

  it("shows unknown words without reporting them", async () => {
    convex.useAction.mockReturnValue(
      vi.fn().mockResolvedValue({ message: "Unknown word." }),
    );
    const user = userEvent.setup();

    render(
      <GuessInput
        gameId={"game" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    await user.type(screen.getByPlaceholderText("Type a word…"), "pear");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown word.");
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("reports unexpected submission failures", async () => {
    const error = new Error("offline");
    convex.useAction.mockReturnValue(vi.fn().mockRejectedValue(error));
    const user = userEvent.setup();

    render(
      <GuessInput
        gameId={"game" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    await user.type(screen.getByPlaceholderText("Type a word…"), "pear");
    await user.click(screen.getByRole("button", { name: "Guess" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not submit guess. Try again.",
    );
    expect(reportClientError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ context: "guess.submit" }),
    );
  });

  it("shows a game-ended race inline", async () => {
    convex.useAction.mockReturnValue(
      vi.fn().mockRejectedValue({ data: "Game is no longer in progress" }),
    );
    const user = userEvent.setup();
    render(
      <GuessInput
        gameId={"game" as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    await user.type(screen.getByPlaceholderText("Type a word…"), "pear");
    await user.click(screen.getByRole("button", { name: "Guess" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This game has already ended.",
    );
  });
});

describe("HintGiveupBar", () => {
  function mockRequestQueries({
    latestMine = { hint: null, giveup: null },
    pendingFromOthers = { hint: null, giveup: null },
  }: {
    latestMine?: unknown;
    pendingFromOthers?: unknown;
  }) {
    convex.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "requests:latestMine") return latestMine;
      if (name === "requests:pendingFromOthers") return pendingFromOthers;
      throw new Error(`Unexpected query: ${name}`);
    });
  }

  it("holds a request type someone else already asked for", () => {
    convex.useMutation.mockReturnValue(vi.fn());
    convex.useAction.mockReturnValue(vi.fn());
    mockRequestQueries({
      pendingFromOthers: { hint: { name: "Noor" }, giveup: null },
    });
    render(<HintGiveupBar gameId={"game" as never} isHost={false} />);

    expect(screen.getByRole("button", { name: "Request hint" })).toBeDisabled();
    expect(screen.getByText("Noor already asked for a hint.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Request give up" }),
    ).toBeEnabled();
  });

  function mockHostHint(hostHint: unknown) {
    convex.useAction.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "hints:hostHint") return hostHint;
      if (name === "giveup:hostGiveup") return vi.fn();
      throw new Error(`Unexpected action: ${name}`);
    });
  }

  it("lets a host request a hint directly", async () => {
    const hostHint = vi.fn().mockResolvedValue(null);
    mockHostHint(hostHint);
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
    mockRequestQueries({
      latestMine: {
        hint: { _id: "request", status: "pending", createdAt: 0 },
        giveup: null,
      },
    });
    const user = userEvent.setup();

    render(<HintGiveupBar gameId={"game" as never} isHost={false} />);
    expect(screen.getByRole("button", { name: "Request hint" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Request give up" }));
    expect(
      await screen.findByText("Could not request to give up. Try again."),
    ).toBeVisible();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "request.giveup" }),
    );
  });

  it("tells the sheet to close once a request is sent", async () => {
    convex.useMutation.mockReturnValue(vi.fn().mockResolvedValue(null));
    convex.useAction.mockReturnValue(vi.fn());
    mockRequestQueries({});
    const onDone = vi.fn();
    const user = userEvent.setup();

    render(
      <HintGiveupBar gameId={"game" as never} isHost={false} onDone={onDone} />,
    );
    await user.click(screen.getByRole("button", { name: "Request hint" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("shows an exhausted hint pool inline", async () => {
    mockHostHint(
      vi.fn().mockRejectedValue({ data: "Could not find an unguessed hint" }),
    );
    convex.useMutation.mockReturnValue(vi.fn());
    convex.useQuery.mockReturnValue([]);
    const user = userEvent.setup();
    render(<HintGiveupBar gameId={"game" as never} isHost />);
    await user.click(screen.getByRole("button", { name: "Get hint" }));
    expect(await screen.findByText("No unguessed hints remain.")).toBeVisible();
  });
});

describe("RequestRows", () => {
  const host = { name: "Hana", image: null };
  const viewer = { name: "Vic", image: null };
  const pendingHint = { _id: "hint1", status: "pending", createdAt: 0 };
  const approvedHint = {
    ...pendingHint,
    status: "approved",
    hint: { lemma: "pomelo", distance: 299 },
  };

  function mockLatest(latest: unknown) {
    convex.useQuery.mockReturnValue(latest);
  }

  function reduceMotion() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  it("shows a pending hint and lets the requester take it back", async () => {
    const cancel = vi.fn().mockResolvedValue(null);
    convex.useMutation.mockReturnValue(cancel);
    mockLatest({ hint: pendingHint, giveup: null });
    const user = userEvent.setup();

    render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    expect(screen.getByText("Incoming hint")).toBeVisible();
    expect(screen.getByText("Hint requested")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take back" }));

    expect(cancel).toHaveBeenCalledWith({ requestId: "hint1" });
  });

  it("reveals the hint the Host approved while the page watched", () => {
    reduceMotion();
    convex.useMutation.mockReturnValue(vi.fn());
    mockLatest({ hint: pendingHint, giveup: null });
    const { rerender } = render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );

    mockLatest({ hint: approvedHint, giveup: null });
    rerender(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );

    expect(screen.getByText("Hint approved")).toBeVisible();
    // Credited like the Guess row it becomes: to the requester, not the Host.
    expect(screen.getByText("V")).toBeVisible();
    expect(screen.getByText("pomelo")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeVisible();
  });

  it("settles the scrambled letters into the hint over time", async () => {
    vi.useFakeTimers();
    try {
      convex.useMutation.mockReturnValue(vi.fn());
      mockLatest({ hint: pendingHint, giveup: null });
      const { rerender } = render(
        <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
      );
      mockLatest({ hint: approvedHint, giveup: null });
      rerender(
        <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
      );
      expect(screen.getByText("?")).toBeVisible();

      for (let i = 0; i < "pomelo".length; i++) {
        await act(() => vi.advanceTimersByTimeAsync(200));
      }
      expect(screen.getByText("300")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts down to when the request expires", () => {
    vi.useFakeTimers({ now: 18_000, toFake: ["Date"] });
    try {
      convex.useMutation.mockReturnValue(vi.fn());
      mockLatest({
        hint: { ...pendingHint, createdAt: 0, expiresAt: 60_000 },
        giveup: null,
      });
      render(
        <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
      );
      expect(screen.getByText("0:42")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the requester when nobody answered in time", () => {
    convex.useMutation.mockReturnValue(vi.fn());
    mockLatest({ hint: pendingHint, giveup: null });
    const { rerender } = render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    mockLatest({ hint: { ...pendingHint, status: "expired" }, giveup: null });
    rerender(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );

    expect(screen.getByText("Hint request expired")).toBeVisible();
    expect(
      screen.getByText("The host didn't answer in time. Ask again any time."),
    ).toBeVisible();
  });

  it("doesn't replay decisions made before the page loaded", () => {
    convex.useMutation.mockReturnValue(vi.fn());
    mockLatest({
      hint: approvedHint,
      giveup: { _id: "giveup1", status: "denied", createdAt: 0 },
    });
    render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("tells the requester the Host declined until they dismiss it", async () => {
    convex.useMutation.mockReturnValue(vi.fn());
    mockLatest({ hint: pendingHint, giveup: null });
    const { rerender } = render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    mockLatest({ hint: { ...pendingHint, status: "denied" }, giveup: null });
    rerender(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    const user = userEvent.setup();

    expect(screen.getByText("Hint declined")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Hint declined")).not.toBeInTheDocument();
  });

  it("keeps the live region mounted before a request appears", () => {
    convex.useMutation.mockReturnValue(vi.fn());
    mockLatest({ hint: null, giveup: null });
    const { rerender } = render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();

    mockLatest({ hint: pendingHint, giveup: null });
    rerender(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Hint requested");
  });

  it("doesn't bring back an old decision after a newer request is taken back", () => {
    convex.useMutation.mockReturnValue(vi.fn());
    const denied = { _id: "hint0", status: "denied", createdAt: 0 };
    mockLatest({ hint: { ...denied, status: "pending" }, giveup: null });
    const { rerender } = render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    const update = (hint: unknown) => {
      mockLatest({ hint, giveup: null });
      rerender(
        <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
      );
    };
    update(denied);
    expect(screen.getByText("Hint declined")).toBeVisible();

    // Asking again, then taking it back, leaves the old denial newest.
    update({ _id: "hint1", status: "pending", createdAt: 1 });
    update(denied);
    expect(screen.queryByText("Hint declined")).not.toBeInTheDocument();
  });

  it("hides the answer behind a pending give-up", () => {
    convex.useMutation.mockReturnValue(vi.fn());
    mockLatest({
      hint: null,
      giveup: { _id: "giveup1", status: "pending", createdAt: 0 },
    });
    render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    expect(screen.getByText("Answer · if host agrees")).toBeVisible();
    expect(screen.getByText("Give-up requested")).toBeInTheDocument();
  });

  it("reports a take-back the Host already answered", async () => {
    convex.useMutation.mockReturnValue(
      vi
        .fn()
        .mockRejectedValue({ data: "Request not found or already handled" }),
    );
    mockLatest({ hint: pendingHint, giveup: null });
    const user = userEvent.setup();
    render(
      <RequestRows gameId={"game" as never} host={host} viewer={viewer} />,
    );
    await user.click(screen.getByRole("button", { name: "Take back" }));
    expect(reportClientError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: "request.cancel.hint",
        userMessage: "The host already answered this request.",
      }),
    );
  });
});

// The page's arrangement: requests answered in the Assist sheet, the hints
// they produce revealed above the guess list.
function HostRequests({
  pending,
  onApproved = () => {},
}: {
  pending: never[];
  onApproved?: () => void;
}) {
  const requests = useHostRequests(pending);
  return (
    <>
      <HostRequestList requests={requests} onApproved={onApproved} />
      <HostRequestRows requests={requests} />
    </>
  );
}

function SheetWithRequests({ pending }: { pending: never[] }) {
  const requests = useHostRequests(pending);
  return <AssistSheet gameId={"game" as never} isHost requests={requests} />;
}

describe("HostRequestRows", () => {
  const request = (
    id: string,
    type: "hint" | "giveup",
    name: string,
    created: number,
  ) => ({
    _id: id,
    _creationTime: created,
    gameId: "game",
    requesterUserId: `user-${id}`,
    requester: { name, image: null },
    type,
    status: "pending",
    createdAt: created,
  });
  const hint = request("hint1", "hint", "Vic", 1);
  const giveup = request("giveup1", "giveup", "Noor", 2);

  // jsdom has no IntersectionObserver; this one reports `inView` on observe.
  let inView = true;
  beforeEach(() => {
    inView = true;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private callback: IntersectionObserverCallback) {}
        observe() {
          this.callback(
            [{ isIntersecting: inView } as IntersectionObserverEntry],
            this as never,
          );
        }
        disconnect() {}
      },
    );
  });

  function mockActions(approve: unknown, deny: unknown = vi.fn()) {
    convex.useAction.mockReturnValue(approve);
    convex.useMutation.mockReturnValue(deny);
  }

  function reduceMotion() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  it("lists each request with who asked and what for", () => {
    mockActions(vi.fn());
    render(<HostRequests pending={[hint, giveup] as never} />);

    expect(screen.getByText("Waiting on you · 2")).toBeVisible();
    expect(screen.getByText("Vic")).toBeVisible();
    expect(screen.getByText("wants a hint")).toBeVisible();
    expect(screen.getByText("Noor")).toBeVisible();
    expect(screen.getByText("wants to give up")).toBeVisible();
    expect(screen.getByRole("button", { name: "Give hint" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Give up" })).toBeEnabled();
  });

  it("counts down to when each request expires", () => {
    vi.useFakeTimers({ now: 45_000, toFake: ["Date"] });
    try {
      mockActions(vi.fn());
      render(
        <HostRequests
          pending={[{ ...hint, createdAt: 0, expiresAt: 60_000 }] as never}
        />,
      );
      expect(screen.getByText("0:15")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels the requests with a heading", () => {
    mockActions(vi.fn());
    render(<HostRequests pending={[hint] as never} />);
    expect(
      screen.getByRole("heading", { name: "Waiting on you · 1" }),
    ).toBeVisible();
  });

  it("offers a way to the requests from down the page", async () => {
    inView = false;
    mockActions(vi.fn());
    convex.useQuery.mockReturnValue(undefined);
    const user = userEvent.setup();
    render(<SheetWithRequests pending={[hint, giveup] as never} />);

    await user.click(screen.getByRole("button", { name: "Show 2 requests" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("Waiting on you · 2")).toBeVisible();
  });

  it("lifts the way to the requests above an open on-screen keyboard", () => {
    inView = false;
    mockActions(vi.fn());
    // iOS Safari keeps the layout viewport and shrinks the visual one.
    vi.stubGlobal("visualViewport", {
      offsetTop: 0,
      height: window.innerHeight - 300,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    render(<SheetWithRequests pending={[hint] as never} />);

    expect(screen.getByRole("button", { name: "Show 1 request" })).toHaveStyle({
      bottom: "316px",
    }); // 300px keyboard + 1rem
  });

  it("counts waiting requests on the Assist button", () => {
    mockActions(vi.fn());
    render(<SheetWithRequests pending={[hint] as never} />);
    expect(
      screen.getByRole("button", { name: "Need help? 1 request waiting" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^Show / }),
    ).not.toBeInTheDocument();
  });

  it("closes the sheet to show the hint being given", async () => {
    mockActions(vi.fn(() => new Promise(() => {})));
    convex.useQuery.mockReturnValue(undefined);
    const user = userEvent.setup();
    render(<SheetWithRequests pending={[hint] as never} />);
    await user.click(
      screen.getByRole("button", { name: "Need help? 1 request waiting" }),
    );
    await user.click(screen.getByRole("button", { name: "Give hint" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps an empty live region until a request arrives", () => {
    mockActions(vi.fn());
    const { rerender } = render(<HostRequests pending={[]} />);
    const region = screen.getByRole("status", { name: "Requests" });
    expect(region).toBeEmptyDOMElement();

    rerender(<HostRequests pending={[hint] as never} />);
    expect(screen.getByRole("status", { name: "Requests" })).toBe(region);
    expect(region).toHaveTextContent("1 request waiting");
  });

  it("denies a request", async () => {
    const deny = vi.fn().mockResolvedValue(null);
    mockActions(vi.fn(), deny);
    const user = userEvent.setup();
    render(<HostRequests pending={[hint] as never} />);

    await user.click(screen.getByRole("button", { name: "Deny" }));
    expect(deny).toHaveBeenCalledWith({ requestId: "hint1" });
  });

  it("shuffles while the hint is found, then reveals it in the requester's row", async () => {
    reduceMotion();
    let resolve: (value: unknown) => void = () => {};
    const approve = vi.fn(() => new Promise((r) => (resolve = r)));
    mockActions(approve);
    const user = userEvent.setup();
    const { rerender } = render(<HostRequests pending={[hint] as never} />);

    await user.click(screen.getByRole("button", { name: "Give hint" }));
    expect(approve).toHaveBeenCalledWith({ requestId: "hint1" });
    expect(screen.getByText("Finding a hint for Vic")).toBeInTheDocument();

    // The request leaves the pending list before the action returns.
    rerender(<HostRequests pending={[]} />);
    expect(screen.getByText("Finding a hint for Vic")).toBeInTheDocument();

    await act(async () => resolve({ lemma: "pomelo", distance: 299 }));
    expect(screen.getByText("pomelo")).toBeVisible();
    expect(screen.getByText("300")).toBeVisible();
    expect(screen.getByText("V")).toBeVisible();
  });

  it("clears a given hint a few seconds after it settles", async () => {
    reduceMotion();
    vi.useFakeTimers();
    try {
      mockActions(
        vi.fn().mockResolvedValue({ lemma: "pomelo", distance: 299 }),
      );
      render(<HostRequests pending={[hint] as never} />);
      await act(async () => {
        screen.getByRole("button", { name: "Give hint" }).click();
      });
      expect(screen.getByText("pomelo")).toBeVisible();

      await act(() => vi.advanceTimersByTimeAsync(4000));
      expect(screen.queryByText("pomelo")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the buttons back and reports when no hint can be found", async () => {
    mockActions(
      vi.fn().mockRejectedValue({ data: "Could not find an unguessed hint" }),
    );
    const user = userEvent.setup();
    render(<HostRequests pending={[hint] as never} />);

    await user.click(screen.getByRole("button", { name: "Give hint" }));
    expect(
      await screen.findByRole("button", { name: "Give hint" }),
    ).toBeEnabled();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: "request.approve.hint",
        userMessage: "No unguessed hints remain.",
      }),
    );
  });

  it("approves a give-up without a reveal", async () => {
    const approve = vi.fn().mockResolvedValue({ lemma: "answer" });
    mockActions(approve);
    const user = userEvent.setup();
    render(<HostRequests pending={[giveup] as never} />);

    await user.click(screen.getByRole("button", { name: "Give up" }));
    expect(approve).toHaveBeenCalledWith({ requestId: "giveup1" });
    expect(screen.queryByText("answer")).not.toBeInTheDocument();
  });
});

describe("GuessList", () => {
  const guess = (id: string, lemma: string, distance: number) => ({
    _id: id,
    lemma,
    distance,
    source: "guess",
    player: { name: "Alex", image: null },
  });

  // Convex returns undefined while a subscription with new arguments loads,
  // so each query only answers for the arguments it was loaded with.
  function mockGuessQueries({
    sorted,
    found = null,
  }: {
    sorted: ReturnType<typeof guess>[];
    found?: ReturnType<typeof guess> | null | "loading";
  }) {
    convex.useQuery.mockImplementation((reference, args) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(reference);
      if (name === "guesses:listForGame") {
        return Object.keys(args).length === 1
          ? { sorted, latest: null }
          : undefined;
      }
      if (name === "guesses:findByLemma") {
        return found === "loading" ? undefined : found;
      }
      throw new Error(`Unexpected query: ${name}`);
    });
  }

  it("prompts for a first guess when there are none", () => {
    mockGuessQueries({ sorted: [] });
    render(<GuessList gameId={"game" as never} duplicate={null} />);
    expect(screen.getByText("No guesses yet. Type one!")).toBeVisible();
  });

  it("keeps the list and highlights the repeated guess on a duplicate", () => {
    mockGuessQueries({
      sorted: [guess("close", "near", 1), guess("far", "apple", 40)],
    });
    const { rerender } = render(
      <GuessList gameId={"game" as never} duplicate={null} />,
    );
    rerender(<GuessList gameId={"game" as never} duplicate="apple" />);

    expect(screen.getByText("All guesses (closest first)")).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Already guessed" }),
    ).toHaveTextContent("apple");
    expect(screen.queryByText("Earlier guess")).toBeNull();
    expect(
      convex.useQuery.mock.calls.some(
        ([reference, args]) =>
          getFunctionName(reference) === "guesses:findByLemma" &&
          args !== "skip",
      ),
    ).toBe(false);
  });

  it("confirms a duplicate outside the displayed list while it loads", () => {
    mockGuessQueries({ sorted: [guess("close", "near", 1)], found: "loading" });

    render(<GuessList gameId={"game" as never} duplicate="distant" />);
    expect(screen.getByText("All guesses (closest first)")).toBeVisible();
    expect(
      screen.getByRole("status", { name: "Already guessed" }),
    ).toHaveTextContent(/distant\s*\(already guessed\)/);
  });

  it("shows a repeated guess outside the displayed list", () => {
    mockGuessQueries({
      sorted: [guess("close", "near", 1)],
      found: guess("far", "distant", 500),
    });

    render(<GuessList gameId={"game" as never} duplicate="distant" />);
    expect(convex.useQuery).toHaveBeenCalledWith(expect.anything(), {
      gameId: "game",
      lemma: "distant",
    });
    expect(
      screen.getByRole("status", { name: "Already guessed" }),
    ).toHaveTextContent("distant");
    expect(screen.getByText("Earlier guess")).toBeVisible();
    expect(screen.getAllByText("distant", { exact: true })).toHaveLength(2);
  });
});

describe("GameSetupCalendar", () => {
  // The calendar is loaded on demand. Import it up front so the slow
  // react-day-picker import doesn't count against each test's timeout.
  beforeAll(async () => {
    await loadCalendar();
  });

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

  it("starts the puzzle for the host's local calendar day", async () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00:05 on 2026-09-25 in Tokyo, still 2026-09-24 in UTC.
    vi.setSystemTime(new Date("2026-09-24T15:05:00Z"));
    try {
      const start = vi.fn().mockResolvedValue({ gameId: "game" });
      convex.useMutation.mockReturnValue(start);
      convex.useQuery.mockReturnValue([]);
      const user = userEvent.setup();
      render(<GameSetupCalendar roomId={"room" as never} isHost />);

      await user.click(screen.getByRole("button", { name: "Start game" }));
      expect(start).toHaveBeenCalledWith({
        contextoGameId: 1468,
        roomId: "room",
      });
    } finally {
      vi.useRealTimers();
      process.env.TZ = originalTimeZone;
    }
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

  it("shows an already-started game inline", async () => {
    convex.useMutation.mockReturnValue(
      vi.fn().mockRejectedValue({ data: "A game is already in progress" }),
    );
    convex.useQuery.mockReturnValue([]);
    const user = userEvent.setup();
    render(<GameSetupCalendar roomId={"room" as never} isHost />);
    await user.click(screen.getByRole("button", { name: "Start game" }));
    expect(
      await screen.findByText("A game is already in progress."),
    ).toBeVisible();
  });
});
