// @vitest-environment jsdom

import { act } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/version/route";
import {
  NewVersionNotifier,
  NewVersionToast,
} from "@/app/_components/NewVersionNotifier";
import { watchForNewVersion } from "@/lib/new-version";
import { render, screen, userEvent } from "./test-utils";

vi.mock("sonner", () => ({
  toast: { custom: vi.fn(), dismiss: vi.fn() },
}));

const POLL_MS = 60_000;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("watchForNewVersion", () => {
  it("notifies when the deployed version differs after a poll", async () => {
    const onNewVersion = vi.fn();
    const fetchLatestVersion = vi.fn().mockResolvedValue("v2");
    const stop = watchForNewVersion("v1", onNewVersion, { fetchLatestVersion });

    expect(fetchLatestVersion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("v2");
    stop();
  });

  it("stays quiet while the deployed version matches", async () => {
    const onNewVersion = vi.fn();
    const fetchLatestVersion = vi.fn().mockResolvedValue("v1");
    const stop = watchForNewVersion("v1", onNewVersion, { fetchLatestVersion });

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(fetchLatestVersion).toHaveBeenCalledTimes(3);
    expect(onNewVersion).not.toHaveBeenCalled();
    stop();
  });

  it("checks immediately when the user returns to the tab", async () => {
    const onNewVersion = vi.fn();
    const fetchLatestVersion = vi.fn().mockResolvedValue("v2");
    const stop = watchForNewVersion("v1", onNewVersion, { fetchLatestVersion });

    setVisibility("hidden");
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(onNewVersion).toHaveBeenCalledWith("v2");

    onNewVersion.mockClear();
    fetchLatestVersion.mockResolvedValue("v3");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onNewVersion).toHaveBeenCalledWith("v3");
    stop();
  });

  it("does not poll while the tab is hidden", async () => {
    const fetchLatestVersion = vi.fn().mockResolvedValue("v1");
    const stop = watchForNewVersion("v1", vi.fn(), { fetchLatestVersion });

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);

    expect(fetchLatestVersion).not.toHaveBeenCalled();
    stop();
  });

  it("notifies once per distinct deployed version", async () => {
    const onNewVersion = vi.fn();
    const fetchLatestVersion = vi.fn().mockResolvedValue("v2");
    const stop = watchForNewVersion("v1", onNewVersion, { fetchLatestVersion });

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("v2");

    fetchLatestVersion.mockResolvedValue("v3");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(onNewVersion).toHaveBeenLastCalledWith("v3");
    expect(onNewVersion).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores failed and empty checks", async () => {
    const onNewVersion = vi.fn();
    const fetchLatestVersion = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("v2");
    const stop = watchForNewVersion("v1", onNewVersion, { fetchLatestVersion });

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(onNewVersion).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("v2");
    stop();
  });

  it("collapses overlapping triggers into one request", async () => {
    let resolve!: (version: string) => void;
    const fetchLatestVersion = vi.fn(
      () => new Promise<string>((r) => (resolve = r)),
    );
    const stop = watchForNewVersion("v1", vi.fn(), { fetchLatestVersion });

    window.dispatchEvent(new Event("focus"));
    setVisibility("visible");
    window.dispatchEvent(new Event("online"));
    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);

    resolve("v1");
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("focus"));
    expect(fetchLatestVersion).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops checking and drops in-flight results once stopped", async () => {
    let resolve!: (version: string) => void;
    const onNewVersion = vi.fn();
    const fetchLatestVersion = vi.fn(
      () => new Promise<string>((r) => (resolve = r)),
    );
    const stop = watchForNewVersion("v1", onNewVersion, { fetchLatestVersion });

    window.dispatchEvent(new Event("focus"));
    stop();
    resolve("v2");
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    window.dispatchEvent(new Event("focus"));

    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it("reads the deployed version from the version endpoint by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ version: "v2" }));
    vi.stubGlobal("fetch", fetchMock);
    const onNewVersion = vi.fn();
    const stop = watchForNewVersion("v1", onNewVersion);

    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(fetchMock).toHaveBeenCalledWith("/api/version", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(onNewVersion).toHaveBeenCalledWith("v2");

    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    onNewVersion.mockClear();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(onNewVersion).not.toHaveBeenCalled();
    stop();
  });

  it("gives up on a hung version request so later checks still run", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stop = watchForNewVersion("v1", vi.fn());

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("version endpoint", () => {
  it("returns the version this deployment was built with", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "abc123");

    const response = GET();

    await expect(response.json()).resolves.toEqual({ version: "abc123" });
  });
});

describe("NewVersionNotifier", () => {
  it("shows a persistent refresh toast when a new deployment is detected", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "v1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ version: "v2" })),
    );

    const { unmount } = render(<NewVersionNotifier />);
    await flush();
    expect(toast.custom).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    expect(toast.custom).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      expect.objectContaining({
        id: "new-version",
        duration: Infinity,
        position: "bottom-right",
      }),
    );
    unmount();
  });

  it("does nothing when the build has no version", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<NewVersionNotifier />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a toast that refreshes or dismisses", async () => {
    vi.useRealTimers();
    const onRefresh = vi.fn();
    const onDismiss = vi.fn();
    render(<NewVersionToast onRefresh={onRefresh} onDismiss={onDismiss} />);

    expect(screen.getByText("New version available")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
