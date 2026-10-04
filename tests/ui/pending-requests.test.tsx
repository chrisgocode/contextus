import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HostView,
  type PendingRequests,
  type RequesterView,
  usePendingRequests,
} from "@/app/(app)/r/[code]/_components/PendingRequests";
import { fakeRequests, RequestsProvider } from "./fake-requests";
import { act, renderHook, waitFor } from "./test-utils";

const convex = vi.hoisted(() => ({
  useAction: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

// Rerender with a Game id to move the provider to that Game.
function renderRequests(isHost: boolean) {
  let gameId = "game";
  const view = renderHook(() => usePendingRequests(), {
    wrapper: ({ children }) => (
      <RequestsProvider gameId={gameId} isHost={isHost}>
        {children}
      </RequestsProvider>
    ),
  });
  return {
    result: view.result,
    rerender: (nextGameId = gameId) => {
      gameId = nextGameId;
      view.rerender();
    },
  };
}

function asHost(requests: PendingRequests): HostView {
  if (requests.role !== "host") throw new Error("Expected the Host's view");
  return requests;
}

function asRequester(requests: PendingRequests): RequesterView {
  if (requests.role !== "requester") {
    throw new Error("Expected a requester's view");
  }
  return requests;
}

const request = (id: string, type: "hint" | "giveup", created: number) => ({
  _id: id,
  _creationTime: created,
  gameId: "game",
  requesterUserId: `user-${id}`,
  requester: { name: `Player ${id}`, image: null },
  type,
  status: "pending",
  createdAt: created,
});

describe("usePendingRequests for the Host", () => {
  const hint = request("hint1", "hint", 1);
  const giveup = request("giveup1", "giveup", 2);

  it("waits on every pending request and asks nothing of a requester", () => {
    fakeRequests(convex, { listPending: [hint, giveup] });
    const { result } = renderRequests(true);
    const host = asHost(result.current);

    expect(host.waiting.map((r) => r._id)).toEqual(["hint1", "giveup1"]);
    expect(host.canAsk).toEqual({ hint: true, giveup: true });
  });

  it("keeps an approved hint being given after it leaves pending, then reveals it", async () => {
    const fake = fakeRequests(convex, { listPending: [hint] });
    let resolve: (value: unknown) => void = () => {};
    fake.approve.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result, rerender } = renderRequests(true);

    act(() => void asHost(result.current).approve(hint as never));
    expect(fake.approve).toHaveBeenCalledWith({ requestId: "hint1" });
    expect(asHost(result.current).busy.has("hint1" as never)).toBe(true);
    expect(asHost(result.current).waiting).toEqual([]);

    fake.listPending = [];
    rerender();
    expect(asHost(result.current).giving).toEqual([{ request: hint }]);

    await act(async () => resolve({ lemma: "pomelo", distance: 299 }));
    expect(asHost(result.current).giving).toEqual([
      { request: hint, hint: { lemma: "pomelo", distance: 299 } },
    ]);
    expect(asHost(result.current).busy.size).toBe(0);
  });

  it("clears a given hint a few seconds after its reveal settles", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeRequests(convex, { listPending: [hint] });
      fake.approve.mockResolvedValue({ lemma: "pomelo", distance: 299 });
      const { result } = renderRequests(true);
      await act(() => asHost(result.current).approve(hint as never));

      act(() => asHost(result.current).settled("hint1" as never));
      await act(() => vi.advanceTimersByTimeAsync(3999));
      expect(asHost(result.current).giving).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(asHost(result.current).giving).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the reveal and says why when no hint can be found", async () => {
    const fake = fakeRequests(convex, { listPending: [hint] });
    fake.approve.mockRejectedValue({
      data: "Could not find an unguessed hint",
    });
    const { result } = renderRequests(true);

    await act(() => asHost(result.current).approve(hint as never));
    expect(asHost(result.current).giving).toEqual([]);
    expect(asHost(result.current).waiting.map((r) => r._id)).toEqual(["hint1"]);
    expect(toast.error).toHaveBeenCalledWith("No unguessed hints remain.");
  });

  it("approves a give-up without a reveal", async () => {
    const fake = fakeRequests(convex, { listPending: [giveup] });
    const { result } = renderRequests(true);

    await act(() => asHost(result.current).approve(giveup as never));
    expect(fake.approve).toHaveBeenCalledWith({ requestId: "giveup1" });
    expect(asHost(result.current).giving).toEqual([]);
  });

  it("denies a request, busy until it lands", async () => {
    const fake = fakeRequests(convex, { listPending: [hint] });
    let resolve: (value: unknown) => void = () => {};
    fake.deny.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result } = renderRequests(true);

    act(() => void asHost(result.current).deny(hint as never));
    expect(fake.deny).toHaveBeenCalledWith({ requestId: "hint1" });
    expect(asHost(result.current).busy.has("hint1" as never)).toBe(true);
    await act(async () => resolve(null));
    expect(asHost(result.current).busy.size).toBe(0);
  });

  it("doesn't carry a hint being given into the next Game", () => {
    const fake = fakeRequests(convex, { listPending: [hint] });
    fake.approve.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderRequests(true);
    act(() => void asHost(result.current).approve(hint as never));
    expect(asHost(result.current).giving).toHaveLength(1);

    fake.listPending = [];
    rerender("next");
    expect(asHost(result.current).giving).toEqual([]);
    expect(asHost(result.current).busy.size).toBe(0);
  });

  it("gets a hint or gives up directly", async () => {
    const fake = fakeRequests(convex);
    const { result } = renderRequests(true);

    await act(() => result.current.ask("hint"));
    await act(() => result.current.ask("giveup"));
    expect(fake.hostHint).toHaveBeenCalledWith({ gameId: "game" });
    expect(fake.hostGiveup).toHaveBeenCalledWith({ gameId: "game" });
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("holds both kinds while asking and says why asking failed", async () => {
    const fake = fakeRequests(convex);
    let reject: (reason: unknown) => void = () => {};
    fake.hostHint.mockImplementation(() => new Promise((_, r) => (reject = r)));
    const { result } = renderRequests(true);

    let landed: Promise<boolean> = Promise.resolve(true);
    act(() => void (landed = result.current.ask("hint")));
    expect(result.current.asking).toBe("hint");
    expect(result.current.canAsk).toEqual({ hint: false, giveup: false });

    await act(async () => reject({ data: "Could not find an unguessed hint" }));
    expect(await landed).toBe(false);
    expect(result.current.askError).toBe("No unguessed hints remain.");
    expect(result.current.canAsk).toEqual({ hint: true, giveup: true });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("usePendingRequests for a requester", () => {
  const pendingHint = { _id: "hint1", status: "pending", createdAt: 0 };
  const approvedHint = {
    ...pendingHint,
    status: "approved",
    hint: { lemma: "pomelo", distance: 299 },
  };

  it("asks the Host and doesn't query the Host's requests", async () => {
    const fake = fakeRequests(convex, {
      listPending: [request("x", "hint", 0)],
    });
    const { result } = renderRequests(false);

    expect("waiting" in result.current).toBe(false);
    expect(await act(() => result.current.ask("giveup"))).toBe(true);
    expect(fake.create).toHaveBeenCalledWith({
      gameId: "game",
      type: "giveup",
    });
    expect(fake.hostGiveup).not.toHaveBeenCalled();
  });

  it("holds a kind the viewer or someone else already asked for", () => {
    fakeRequests(convex, {
      latestMine: { hint: null, giveup: { ...pendingHint, _id: "giveup1" } },
      pendingFromOthers: { hint: { name: "Noor" }, giveup: null },
    });
    const { result } = renderRequests(false);
    const requester = asRequester(result.current);

    expect(requester.canAsk).toEqual({ hint: false, giveup: false });
    expect(requester.others).toEqual({ hint: { name: "Noor" }, giveup: null });
  });

  it("shows the outcome of a request the page watched while pending", () => {
    const fake = fakeRequests(convex, {
      latestMine: { hint: pendingHint, giveup: null },
    });
    const { result, rerender } = renderRequests(false);
    expect(asRequester(result.current).mine.hint).toEqual(pendingHint);

    fake.latestMine = { hint: approvedHint, giveup: null };
    rerender();
    expect(asRequester(result.current).mine.hint).toEqual(approvedHint);
    expect(asRequester(result.current).canAsk.hint).toBe(true);
  });

  it("doesn't replay decisions made before the page loaded", () => {
    fakeRequests(convex, {
      latestMine: {
        hint: approvedHint,
        giveup: { _id: "giveup1", status: "denied", createdAt: 0 },
      },
    });
    const { result } = renderRequests(false);
    expect(asRequester(result.current).mine).toEqual({
      hint: null,
      giveup: null,
    });
  });

  it("hides an outcome once dismissed", () => {
    const fake = fakeRequests(convex, {
      latestMine: { hint: pendingHint, giveup: null },
    });
    const { result, rerender } = renderRequests(false);
    const denied = { ...pendingHint, status: "denied" };
    fake.latestMine = { hint: denied, giveup: null };
    rerender();
    expect(asRequester(result.current).mine.hint).toEqual(denied);

    act(() => asRequester(result.current).dismiss("hint1" as never));
    expect(asRequester(result.current).mine.hint).toBeNull();
  });

  it("doesn't bring back an old decision after a newer request is taken back", () => {
    const denied = { _id: "hint0", status: "denied", createdAt: 0 };
    const fake = fakeRequests(convex, {
      latestMine: { hint: { ...denied, status: "pending" }, giveup: null },
    });
    const { result, rerender } = renderRequests(false);
    const update = (hint: unknown) => {
      fake.latestMine = { hint, giveup: null };
      rerender();
    };
    update(denied);
    expect(asRequester(result.current).mine.hint).toEqual(denied);

    // Asking again, then taking it back, leaves the old denial newest.
    update({ _id: "hint1", status: "pending", createdAt: 1 });
    update(denied);
    expect(asRequester(result.current).mine.hint).toBeNull();
  });

  it("leaves an approved give-up to the end screen", () => {
    const pendingGiveup = { _id: "giveup1", status: "pending", createdAt: 0 };
    const fake = fakeRequests(convex, {
      latestMine: { hint: null, giveup: pendingGiveup },
    });
    const { result, rerender } = renderRequests(false);
    fake.latestMine = {
      hint: null,
      giveup: { ...pendingGiveup, status: "approved" },
    };
    rerender();
    expect(asRequester(result.current).mine.giveup).toBeNull();
  });

  it("takes back a request, and says when the Host already answered it", async () => {
    const fake = fakeRequests(convex, {
      latestMine: { hint: pendingHint, giveup: null },
    });
    fake.cancel.mockRejectedValue({
      data: "Request not found or already handled",
    });
    const { result } = renderRequests(false);

    await act(() =>
      asRequester(result.current).takeBack("hint", pendingHint as never),
    );
    expect(fake.cancel).toHaveBeenCalledWith({ requestId: "hint1" });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The host already answered this request.",
      ),
    );
    expect(asRequester(result.current).busy.size).toBe(0);
  });
});
