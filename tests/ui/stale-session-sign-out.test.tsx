import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STALE_SIGN_OUT_DELAY_MS,
  StaleSessionSignOut,
} from "@/app/_components/StaleSessionSignOut";
import { reportClientError } from "@/lib/report-error";
import { act, render } from "./test-utils";

const convex = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));

const fetchMock = vi.fn();

function wait(ms: number) {
  return act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Pending, so the test doesn't reload the page.
  fetchMock.mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StaleSessionSignOut", () => {
  it("asks to sign out the session the backend no longer accepts, once a sign-in has had time to land", async () => {
    convex.useQuery.mockReturnValue("guest-session");

    render(<StaleSessionSignOut />);
    await wait(STALE_SIGN_OUT_DELAY_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await wait(1);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/stale", {
      method: "POST",
      body: JSON.stringify({ sessionId: "guest-session" }),
    });
  });

  it("keeps a signed-in user and waits while loading", async () => {
    convex.useQuery.mockReturnValue(undefined);
    const { rerender } = render(<StaleSessionSignOut />);

    convex.useQuery.mockReturnValue(null);
    rerender(<StaleSessionSignOut />);
    await wait(STALE_SIGN_OUT_DELAY_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves a page that is navigating away alone", async () => {
    convex.useQuery.mockReturnValue("guest-session");
    render(<StaleSessionSignOut />);

    window.dispatchEvent(new Event("beforeunload"));
    await wait(STALE_SIGN_OUT_DELAY_MS);

    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pageshow"));
    await wait(STALE_SIGN_OUT_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/stale", {
      method: "POST",
      body: JSON.stringify({ sessionId: "guest-session" }),
    });
  });

  it("reports a failed sign-out", async () => {
    fetchMock.mockResolvedValue(new Response("Invalid", { status: 400 }));
    convex.useQuery.mockReturnValue("guest-session");

    render(<StaleSessionSignOut />);
    await wait(STALE_SIGN_OUT_DELAY_MS);

    expect(reportClientError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "auth.signOut" }),
    );
  });
});
