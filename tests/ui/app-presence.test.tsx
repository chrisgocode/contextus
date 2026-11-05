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
  it("restores the heartbeat cadence and unload beacon after a connected page returns", async () => {
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    await act(async () => {});
    act(() => window.dispatchEvent(new Event("beforeunload")));
    await act(() => vi.advanceTimersByTimeAsync(VISIBLE_INTERVAL_MS));
    expect(convex.heartbeat).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(async () => {});
    act(() => setHidden(true));
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_INTERVAL_MS));
    expect(convex.heartbeat).toHaveBeenCalledTimes(4);
    expect(convex.heartbeat).toHaveBeenLastCalledWith({
      sessionId: expect.any(String),
      interval: HIDDEN_INTERVAL_MS,
    });
    act(() => window.dispatchEvent(new Event("beforeunload")));
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_INTERVAL_MS));
    expect(convex.heartbeat).toHaveBeenCalledTimes(4);
    unmount();
  });

  it("restarts presence after unload and page restoration, without accepting an old token", async () => {
    const old = Promise.withResolvers<{ sessionToken: string }>();
    convex.heartbeat
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ sessionToken: "restored-token" });
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    act(() => window.dispatchEvent(new Event("beforeunload")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(async () => {});
    expect(convex.heartbeat).toHaveBeenCalledTimes(2);
    expect(convex.heartbeat.mock.calls[0][0].sessionId).not.toBe(
      convex.heartbeat.mock.calls[1][0].sessionId,
    );
    await act(async () => old.resolve({ sessionToken: "old-token" }));
    expect(convex.disconnect).toHaveBeenCalledWith({
      sessionToken: "old-token",
    });
    expect(convex.disconnect).not.toHaveBeenCalledWith({
      sessionToken: "restored-token",
    });
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(() => vi.advanceTimersByTimeAsync(VISIBLE_INTERVAL_MS));
    expect(convex.heartbeat).toHaveBeenCalledTimes(3);
    unmount();
    expect(convex.disconnect).toHaveBeenCalledWith({
      sessionToken: "restored-token",
    });
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(() => vi.advanceTimersByTimeAsync(VISIBLE_INTERVAL_MS));
    expect(convex.heartbeat).toHaveBeenCalledTimes(3);
  });

  it("stops scheduling on unload before token acquisition and disconnects the late token", async () => {
    let resolve!: (result: { sessionToken: string }) => void;
    convex.heartbeat.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    window.dispatchEvent(new Event("beforeunload"));
    await act(async () => resolve({ sessionToken: "late-token" }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(1);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(convex.disconnect).toHaveBeenCalledWith({
      sessionToken: "late-token",
    });
    unmount();
  });

  it("reschedules repeated visibility changes with only one timer", async () => {
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    act(() => setHidden(true));
    act(() => setHidden(false));
    act(() => setHidden(true));
    await act(() => vi.advanceTimersByTimeAsync(59_999));
    expect(convex.heartbeat).toHaveBeenCalledTimes(4);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(convex.heartbeat).toHaveBeenCalledTimes(5);
    act(() => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(7);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(7);
  });

  it("retries a failed initial heartbeat and releases the acquired token", async () => {
    convex.heartbeat.mockRejectedValueOnce(new Error("offline"));
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(2);
    unmount();
    expect(convex.disconnect).toHaveBeenCalledWith({ sessionToken: "token" });
  });

  it("keeps its disconnect token when a renewal fails or returns no token", async () => {
    convex.heartbeat
      .mockResolvedValueOnce({ sessionToken: "first-token" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    unmount();
    expect(convex.disconnect).toHaveBeenCalledWith({
      sessionToken: "first-token",
    });
  });

  it("releases a token acquired after unmount without restarting the timer", async () => {
    let resolve!: (result: { sessionToken: string }) => void;
    convex.heartbeat.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    signInAs({ _id: "alice", isAnonymous: false });
    const { unmount } = render(<AppPresence />);
    unmount();
    await act(async () => resolve({ sessionToken: "late-token" }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(1);
    expect(convex.disconnect).toHaveBeenCalledWith({
      sessionToken: "late-token",
    });
  });

  it("isolates a late old-user heartbeat from the new user and sign-out", async () => {
    let resolveOld!: (result: { sessionToken: string }) => void;
    convex.heartbeat.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveOld = done;
        }),
    );
    signInAs({ _id: "alice", isAnonymous: false });
    const { rerender } = render(<AppPresence />);
    const oldSession = convex.heartbeat.mock.calls[0][0].sessionId;
    signInAs({ _id: "bob", isAnonymous: false });
    rerender(<AppPresence />);
    const newSession = convex.heartbeat.mock.calls[1][0].sessionId;
    expect(newSession).not.toBe(oldSession);
    await act(async () => resolveOld({ sessionToken: "alice-token" }));
    expect(convex.disconnect).toHaveBeenCalledWith({
      sessionToken: "alice-token",
    });
    expect(convex.disconnect).not.toHaveBeenCalledWith({
      sessionToken: "token",
    });
    signInAs(null);
    rerender(<AppPresence />);
    expect(convex.disconnect).toHaveBeenCalledWith({ sessionToken: "token" });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("disconnects immediately on sign-out even while the user query is cached", async () => {
    signInAs({ _id: "alice", isAnonymous: false });
    const { rerender } = render(<AppPresence />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: false });
    rerender(<AppPresence />);
    expect(convex.disconnect).toHaveBeenCalledWith({ sessionToken: "token" });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("gives each tab its own session and keeps the other tab running", async () => {
    convex.heartbeat
      .mockResolvedValueOnce({ sessionToken: "tab-one" })
      .mockResolvedValueOnce({ sessionToken: "tab-two" });
    signInAs({ _id: "alice", isAnonymous: false });
    const first = render(<AppPresence />);
    const second = render(<AppPresence />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(convex.heartbeat.mock.calls[0][0].sessionId).not.toBe(
      convex.heartbeat.mock.calls[1][0].sessionId,
    );
    first.unmount();
    expect(convex.disconnect).toHaveBeenCalledWith({ sessionToken: "tab-one" });
    expect(convex.disconnect).not.toHaveBeenCalledWith({
      sessionToken: "tab-two",
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(convex.heartbeat).toHaveBeenCalledTimes(3);
    second.unmount();
  });

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
    const { unmount } = render(<AppPresence />);
    await act(() => vi.advanceTimersByTimeAsync(0));

    window.dispatchEvent(new Event("beforeunload"));

    expect(sendBeacon).toHaveBeenCalledWith(
      "https://convex.test/api/mutation",
      expect.any(Blob),
    );
    const blob = sendBeacon.mock.calls[0][1] as Blob;
    expect(blob.type).toBe("application/json");
    const body = new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    await vi.runAllTimersAsync();
    expect(JSON.parse(await body)).toEqual({
      path: "presence:disconnect",
      args: { sessionToken: "token" },
    });
    unmount();
    expect(convex.disconnect).not.toHaveBeenCalled();
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
