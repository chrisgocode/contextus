import { getFunctionName } from "convex/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appError } from "@/convex/lib/errors";
import { GuessInput } from "@/app/(app)/r/[code]/_components/GuessInput";
import { GuessList } from "@/app/(app)/r/[code]/_components/GuessList";
import { loadCalendar } from "@/app/(app)/r/[code]/_components/calendar-loader";
import { GameSetupCalendar } from "@/app/(app)/r/[code]/_components/GameSetupCalendar";
import { HintGiveupBar } from "@/app/(app)/r/[code]/_components/HintGiveupBar";
import { AssistSheet } from "@/app/(app)/r/[code]/_components/AssistSheet";
import {
  HostRequestList,
  HostRequestRows,
} from "@/app/(app)/r/[code]/_components/HostRequestRows";
import { RequestRows } from "@/app/(app)/r/[code]/_components/RequestRows";
import { fakeRequests, RequestsProvider } from "./fake-requests";
import { act, cleanup, render, screen, userEvent, waitFor } from "./test-utils";

const convex = vi.hoisted(() => ({
  useAction: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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

  it("shows unknown words inline", async () => {
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
  });

  it("shows unexpected submission failures inline", async () => {
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
  });

  it("shows a game-ended race inline", async () => {
    convex.useAction.mockReturnValue(
      vi.fn().mockRejectedValue(appError("gameEnded")),
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
  function renderBar(isHost: boolean, onDone?: () => void) {
    return render(
      <RequestsProvider isHost={isHost}>
        <HintGiveupBar onDone={onDone} />
      </RequestsProvider>,
    );
  }

  it("holds a request type someone else already asked for", () => {
    fakeRequests(convex, {
      pendingFromOthers: { hint: { name: "Noor" }, giveup: null },
    });
    renderBar(false);

    expect(screen.getByRole("button", { name: "Request hint" })).toBeDisabled();
    expect(screen.getByText("Noor already asked for a hint.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Request give up" }),
    ).toBeEnabled();
  });

  it("disables a guest's pending request and shows request failures", async () => {
    const fake = fakeRequests(convex, {
      latestMine: {
        hint: { _id: "request", status: "pending", createdAt: 0 },
        giveup: null,
      },
    });
    fake.create.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();

    renderBar(false);
    expect(screen.getByRole("button", { name: "Request hint" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Request give up" }));
    expect(
      await screen.findByText("Could not request to give up. Try again."),
    ).toBeVisible();
  });

  it("tells the sheet to close once a request is sent", async () => {
    fakeRequests(convex);
    const onDone = vi.fn();
    const user = userEvent.setup();

    renderBar(false, onDone);
    await user.click(screen.getByRole("button", { name: "Request hint" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("shows an exhausted hint pool inline", async () => {
    const fake = fakeRequests(convex);
    fake.hostHint.mockRejectedValue(appError("hintExhausted"));
    const user = userEvent.setup();
    renderBar(true);
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

  // Renders the rows watching `first`, then moves them on to each of `then`.
  function renderRows(
    first: Record<"hint" | "giveup", unknown>,
    ...then: Record<"hint" | "giveup", unknown>[]
  ) {
    const fake = fakeRequests(convex, { latestMine: first });
    const rows = () => (
      <RequestsProvider isHost={false}>
        <RequestRows host={host} viewer={viewer} />
      </RequestsProvider>
    );
    const view = render(rows());
    for (const latest of then) {
      fake.latestMine = latest;
      view.rerender(rows());
    }
    return { fake, view, rows };
  }

  function reduceMotion() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  it("shows a pending hint and lets the requester take it back", async () => {
    const { fake } = renderRows({ hint: pendingHint, giveup: null });
    const user = userEvent.setup();

    expect(screen.getByText("Incoming hint")).toBeVisible();
    expect(screen.getByText("Hint requested")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take back" }));

    expect(fake.cancel).toHaveBeenCalledWith({ requestId: "hint1" });
  });

  it("reveals the hint the Host approved while the page watched", () => {
    reduceMotion();
    renderRows(
      { hint: pendingHint, giveup: null },
      { hint: approvedHint, giveup: null },
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
      renderRows(
        { hint: pendingHint, giveup: null },
        { hint: approvedHint, giveup: null },
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
      renderRows({
        hint: { ...pendingHint, createdAt: 0, expiresAt: 60_000 },
        giveup: null,
      });
      expect(screen.getByText("0:42")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the countdown from now, not from when the page loaded", () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    try {
      const { fake, view, rows } = renderRows({ hint: null, giveup: null });
      vi.setSystemTime(240_000);
      fake.latestMine = {
        hint: { ...pendingHint, createdAt: 240_000, expiresAt: 300_000 },
        giveup: null,
      };
      view.rerender(rows());
      expect(screen.getByText("1:00")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("credits a pending hint to the requester, not the Host", () => {
    renderRows({ hint: pendingHint, giveup: null });
    expect(screen.getByText("V")).toBeVisible();
    expect(screen.queryByText("H")).not.toBeInTheDocument();
  });

  it("tells the requester when nobody answered in time", () => {
    renderRows(
      { hint: pendingHint, giveup: null },
      { hint: { ...pendingHint, status: "expired" }, giveup: null },
    );

    expect(screen.getByText("Hint request expired")).toBeVisible();
    expect(
      screen.getByText("The host didn't answer in time. Ask again any time."),
    ).toBeVisible();
  });

  it("tells the requester the Host declined until they dismiss it", async () => {
    renderRows(
      { hint: pendingHint, giveup: null },
      { hint: { ...pendingHint, status: "denied" }, giveup: null },
    );
    const user = userEvent.setup();

    expect(screen.getByText("Hint declined")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Hint declined")).not.toBeInTheDocument();
  });

  it("keeps the live region mounted before a request appears", () => {
    const { fake, view, rows } = renderRows({ hint: null, giveup: null });
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();

    fake.latestMine = { hint: pendingHint, giveup: null };
    view.rerender(rows());
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Hint requested");
  });

  it("hides the answer behind a pending give-up", () => {
    renderRows({
      hint: null,
      giveup: { _id: "giveup1", status: "pending", createdAt: 0 },
    });
    expect(screen.getByText("Answer · if host agrees")).toBeVisible();
    expect(screen.getByText("Give-up requested")).toBeInTheDocument();
  });

  it("shows nothing to the Host", () => {
    fakeRequests(convex);
    render(
      <RequestsProvider isHost>
        <RequestRows host={host} viewer={viewer} />
      </RequestsProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

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

  // The page's arrangement: requests answered in the Assist sheet, the hints
  // they produce revealed above the guess list, under one provider.
  const page = () => (
    <RequestsProvider isHost>
      <AssistSheet />
      <HostRequestRows />
    </RequestsProvider>
  );
  const list = () => (
    <RequestsProvider isHost>
      <HostRequestList onApproved={() => {}} />
      <HostRequestRows />
    </RequestsProvider>
  );

  function reduceMotion() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  it("lists each request with who asked and what for", () => {
    fakeRequests(convex, { listPending: [hint, giveup] });
    render(list());

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
      fakeRequests(convex, {
        listPending: [{ ...hint, createdAt: 0, expiresAt: 60_000 }],
      });
      render(
        <RequestsProvider isHost>
          <HostRequestList onApproved={() => {}} />
        </RequestsProvider>,
      );
      expect(screen.getByText("0:15")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels the requests with a heading", () => {
    fakeRequests(convex, { listPending: [hint] });
    render(list());
    expect(
      screen.getByRole("heading", { name: "Waiting on you · 1" }),
    ).toBeVisible();
  });

  it("offers a way to the requests from down the page", async () => {
    inView = false;
    fakeRequests(convex, { listPending: [hint, giveup] });
    const user = userEvent.setup();
    render(page());

    await user.click(screen.getByRole("button", { name: "Show 2 requests" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("Waiting on you · 2")).toBeVisible();
  });

  it("lifts the way to the requests above an open on-screen keyboard", () => {
    inView = false;
    fakeRequests(convex, { listPending: [hint] });
    // iOS Safari keeps the layout viewport and shrinks the visual one.
    vi.stubGlobal("visualViewport", {
      offsetTop: 0,
      height: window.innerHeight - 300,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    render(page());

    expect(screen.getByRole("button", { name: "Show 1 request" })).toHaveStyle({
      bottom: "316px",
    }); // 300px keyboard + 1rem
  });

  it("counts waiting requests on the Assist button", () => {
    fakeRequests(convex, { listPending: [hint] });
    render(page());
    expect(
      screen.getByRole("button", { name: "Need help? 1 request waiting" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^Show / }),
    ).not.toBeInTheDocument();
  });

  it("keeps an empty live region until a request arrives", () => {
    const fake = fakeRequests(convex);
    const { rerender } = render(list());
    const region = screen.getByRole("status", { name: "Requests" });
    expect(region).toBeEmptyDOMElement();

    fake.listPending = [hint];
    rerender(list());
    expect(screen.getByRole("status", { name: "Requests" })).toBe(region);
    expect(region).toHaveTextContent("Vic wants a hint");
  });

  const rows = () => (
    <RequestsProvider isHost>
      <HostRequestRows />
    </RequestsProvider>
  );

  it("shows each waiting request above the guess list, oldest first", () => {
    vi.useFakeTimers({ now: 45_000, toFake: ["Date"] });
    try {
      fakeRequests(convex, {
        // Out of order, so the rows have to sort them.
        listPending: [
          { ...giveup, createdAt: 0, expiresAt: 50_000 },
          { ...hint, createdAt: 0, expiresAt: 60_000 },
        ],
      });
      render(rows());

      const labels = screen
        .getAllByText(/wants/)
        .map((label) => label.textContent);
      expect(labels).toEqual(["Vic wants a hint", "Noor wants to give up"]);
      expect(screen.getByText("Hint for Vic")).toBeInTheDocument();
      expect(screen.getByText("0:15")).toBeInTheDocument();
      expect(screen.getByText("0:05")).toBeInTheDocument();
      expect(screen.getByText("V")).toBeVisible();
      expect(screen.getByText("N")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("denies a request from its row", async () => {
    const fake = fakeRequests(convex, { listPending: [hint] });
    const user = userEvent.setup();
    render(rows());

    await user.click(
      screen.getByRole("button", { name: "Deny Vic's request" }),
    );
    expect(fake.deny).toHaveBeenCalledWith({ requestId: "hint1" });
  });

  it("gives up from a request's row", async () => {
    const fake = fakeRequests(convex, { listPending: [giveup] });
    const user = userEvent.setup();
    render(rows());

    await user.click(screen.getByRole("button", { name: "Give up for Noor" }));
    expect(fake.approve).toHaveBeenCalledWith({ requestId: "giveup1" });
  });

  it("reveals a hint given from its row in the row's place", async () => {
    reduceMotion();
    const fake = fakeRequests(convex, { listPending: [hint, giveup] });
    let resolve: (value: unknown) => void = () => {};
    fake.approve.mockImplementation(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    const { rerender } = render(rows());

    await user.click(screen.getByRole("button", { name: "Give hint for Vic" }));
    expect(fake.approve).toHaveBeenCalledWith({ requestId: "hint1" });
    expect(screen.getByText("Finding a hint for Vic")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Give hint for Vic" }),
    ).not.toBeInTheDocument();

    fake.listPending = [giveup];
    rerender(rows());
    await act(async () => resolve({ lemma: "pomelo", distance: 299 }));
    const region = screen.getByRole("status", { name: "Requests" });
    expect(region.textContent?.indexOf("pomelo")).toBeLessThan(
      region.textContent?.indexOf("Noor wants to give up") ?? 0,
    );
  });

  it("disables a request's buttons while it's being answered", async () => {
    const fake = fakeRequests(convex, { listPending: [giveup] });
    fake.deny.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(rows());

    await user.click(
      screen.getByRole("button", { name: "Deny Noor's request" }),
    );
    expect(
      screen.getByRole("button", { name: "Give up for Noor" }),
    ).toBeDisabled();
  });

  it("denies a request", async () => {
    const fake = fakeRequests(convex, { listPending: [hint] });
    const user = userEvent.setup();
    render(list());

    await user.click(screen.getByRole("button", { name: "Deny" }));
    expect(fake.deny).toHaveBeenCalledWith({ requestId: "hint1" });
  });

  it("closes the sheet on approval and reveals the hint above the guess list", async () => {
    reduceMotion();
    const fake = fakeRequests(convex, { listPending: [hint] });
    let resolve: (value: unknown) => void = () => {};
    fake.approve.mockImplementation(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    const { rerender } = render(page());

    await user.click(
      screen.getByRole("button", { name: "Need help? 1 request waiting" }),
    );
    await user.click(screen.getByRole("button", { name: "Give hint" }));
    expect(fake.approve).toHaveBeenCalledWith({ requestId: "hint1" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Finding a hint for Vic")).toBeInTheDocument();

    // The request leaves the pending list before the action returns.
    fake.listPending = [];
    rerender(page());
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
      const fake = fakeRequests(convex, { listPending: [hint] });
      fake.approve.mockResolvedValue({ lemma: "pomelo", distance: 299 });
      render(list());
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

  it("shows a requester neither the rows nor the waiting list", () => {
    fakeRequests(convex);
    render(
      <RequestsProvider isHost={false}>
        <HostRequestList onApproved={() => {}} />
        <HostRequestRows />
      </RequestsProvider>,
    );
    expect(screen.queryByText(/Waiting on you/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Requests" }),
    ).not.toBeInTheDocument();
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

  it("shows a failed attempt to start the selected puzzle", async () => {
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
  });

  it("shows an already-started game inline", async () => {
    convex.useMutation.mockReturnValue(
      vi.fn().mockRejectedValue(appError("gameInProgress")),
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
