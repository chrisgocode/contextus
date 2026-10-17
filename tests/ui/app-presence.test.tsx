import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppPresence,
  HIDDEN_INTERVAL_MS,
  VISIBLE_INTERVAL_MS,
} from "@/app/_components/AppPresence";
import { act, render } from "./test-utils";

const convex = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  disconnect: vi.fn(),
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useConvex: () => ({ url: "https://convex.test" }),
    useConvexAuth: convex.useConvexAuth,
    useQuery: convex.useQuery,
    useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(reference) === "presence:appHeartbeat"
        ? convex.heartbeat
        : convex.disconnect,
  };
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function signInAs(user: { _id: string; isAnonymous: boolean } | null) {
  convex.useConvexAuth.mockReturnValue({ isAuthenticated: user !== null });
  convex.useQuery.mockReturnValue(user ?? undefined);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  convex.heartbeat.mockResolvedValue({ sessionToken: "token" });
  convex.disconnect.mockResolvedValue(null);
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe("AppPresence", () => {
  it("sends heartbeats while a registered user has the app open", async () => {
    signInAs({ _id: "alice", isAnonymous: false });
    render(<AppPresence />);

    await act(() => vi.advanceTimersByTimeAsync(VISIBLE_INTERVAL_MS));

    expect(convex.heartbeat).toHaveBeenCalledTimes(2);
    expect(convex.heartbeat).toHaveBeenLastCalledWith({
      sessionId: expect.any(String),
      interval: VISIBLE_INTERVAL_MS,
    });
  });

  it("keeps a background tab online with less frequent heartbeats", async () => {
    signInAs({ _id: "alice", isAnonymous: false });
    render(<AppPresence />);

    act(() => setHidden(true));
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_INTERVAL_MS));

    expect(convex.heartbeat).toHaveBeenCalledTimes(3);
    expect(convex.heartbeat).toHaveBeenLastCalledWith({
      sessionId: expect.any(String),
      interval: HIDDEN_INTERVAL_MS,
    });
    expect(convex.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects when the app closes", async () => {
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    unmount();

    expect(convex.disconnect).toHaveBeenCalledWith({ sessionToken: "token" });
  });

  it("disconnects with a beacon when the page unloads", async () => {
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    signInAs({ _id: "alice", isAnonymous: false });
    render(<AppPresence />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    window.dispatchEvent(new Event("beforeunload"));

    expect(sendBeacon).toHaveBeenCalledWith(
      "https://convex.test/api/mutation",
      expect.any(Blob),
    );
  });

  it.each([
    ["a Guest", { _id: "guest", isAnonymous: true }],
    ["a signed-out visitor", null],
  ])("sends nothing for %s", async (_, user) => {
    signInAs(user);
    render(<AppPresence />);

    await act(() => vi.advanceTimersByTimeAsync(VISIBLE_INTERVAL_MS));

    expect(convex.heartbeat).not.toHaveBeenCalled();
  });
});
