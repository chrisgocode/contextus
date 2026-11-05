import { act } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/version/route";
import { GuessInput } from "@/app/(app)/r/[code]/_components/GuessInput";
import { NewVersionNotifier } from "@/app/_components/NewVersionNotifier";
import { watchForNewVersion } from "@/lib/new-version";
import { fireEvent, render, screen } from "./test-utils";

vi.mock("convex/react", () => ({ useAction: vi.fn() }));

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
  sessionStorage.clear();
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

  it("does not notify again when deployments alternate between known versions", async () => {
    const onNewVersion = vi.fn();
    const fetchLatestVersion = vi
      .fn()
      .mockResolvedValueOnce("v2")
      .mockResolvedValueOnce("v3")
      .mockResolvedValueOnce("v2")
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("");
    const stop = watchForNewVersion("v1", onNewVersion, { fetchLatestVersion });

    await vi.advanceTimersByTimeAsync(POLL_MS * 5);

    expect(onNewVersion.mock.calls).toEqual([["v2"], ["v3"]]);
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
    const stop = watchForNewVersion("v1", vi.fn(), {
      fetchLatestVersion,
      pollIntervalMs: 1_000,
    });

    window.dispatchEvent(new Event("focus"));
    setVisibility("visible");
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(1_000);
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

  it.each(["response", "failure"])(
    "ignores a timed-out check's late %s during the next check",
    async (outcome) => {
      let resolveOld!: (version: string) => void;
      let rejectOld!: (error: Error) => void;
      let resolveNew!: (version: string) => void;
      const fetchLatestVersion = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve, reject) => {
              resolveOld = resolve;
              rejectOld = reject;
            }),
        )
        .mockImplementationOnce(
          () => new Promise<string>((r) => (resolveNew = r)),
        );
      const onNewVersion = vi.fn();
      const stop = watchForNewVersion("v1", onNewVersion, {
        fetchLatestVersion,
      });

      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(10_000);
      window.dispatchEvent(new Event("online"));
      expect(fetchLatestVersion).toHaveBeenCalledTimes(2);

      if (outcome === "response") resolveOld("obsolete");
      else rejectOld(new Error("late failure"));
      await vi.advanceTimersByTimeAsync(0);
      window.dispatchEvent(new Event("pageshow"));
      expect(fetchLatestVersion).toHaveBeenCalledTimes(2);
      expect(onNewVersion).not.toHaveBeenCalled();

      resolveNew("v3");
      await vi.advanceTimersByTimeAsync(0);
      expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("v3");
      stop();
    },
  );

  it.each(["focus", "online", "pageshow"])(
    "suppresses %s while hidden and checks on visible return",
    async (event) => {
      const fetchLatestVersion = vi.fn().mockResolvedValue("v2");
      const onNewVersion = vi.fn();
      const stop = watchForNewVersion("v1", onNewVersion, {
        fetchLatestVersion,
      });
      setVisibility("hidden");
      window.dispatchEvent(new Event(event));
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(fetchLatestVersion).not.toHaveBeenCalled();

      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
      expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("v2");
      stop();
    },
  );

  it("aborts pending network work and removes all listeners and timers on stop", async () => {
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    const onNewVersion = vi.fn();
    const stop = watchForNewVersion("v1", onNewVersion);
    window.dispatchEvent(new Event("pageshow"));
    stop();
    stop();
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    for (const event of ["focus", "online", "pageshow"]) {
      expect(removeWindowListener).toHaveBeenCalledWith(
        event,
        expect.any(Function),
      );
      window.dispatchEvent(new Event(event));
    }
    setVisibility("visible");
    resolve(Response.json({ version: "v2" }));
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(onNewVersion).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([null, {}, { version: 42 }, { version: "" }, { version: "v1" }])(
    "ignores an unusable or current version response %j and retries",
    async (body) => {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(Response.json(body)))
        .mockImplementationOnce(() =>
          Promise.resolve(Response.json({ version: "v2" })),
        );
      vi.stubGlobal("fetch", fetchMock);
      const onNewVersion = vi.fn();
      const stop = watchForNewVersion("v1", onNewVersion);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
      expect(onNewVersion).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("pageshow"));
      await vi.advanceTimersByTimeAsync(0);
      expect(onNewVersion).toHaveBeenCalledExactlyOnceWith("v2");
      stop();
    },
  );

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
  it("shows a dismissible refresh toast when a new deployment is detected", async () => {
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

    expect(toast.custom).toHaveBeenCalledOnce();
    const [renderToast] = vi.mocked(toast.custom).mock.calls[0];
    render(<>{renderToast("new-version")}</>);
    expect(screen.getByRole("status")).toHaveTextContent(
      "New version available",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(toast.dismiss).toHaveBeenCalledWith("new-version");
    unmount();
  });

  it("retains the unsent Game draft when Refresh requests a reload", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "v1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ version: "v2" })),
    );
    const game = (id: string) => (
      <GuessInput
        gameId={id as never}
        onAchievementsUnlocked={vi.fn()}
        onDuplicate={vi.fn()}
      />
    );
    const page = render(
      <>
        <NewVersionNotifier />
        {game("game")}
      </>,
    );
    fireEvent.change(screen.getByPlaceholderText("Type a word…"), {
      target: { value: "apple" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    const [renderToast] = vi.mocked(toast.custom).mock.calls[0];
    const notification = render(<>{renderToast("new-version")}</>);
    const reload = vi.fn();
    // jsdom cannot navigate; replace only the browser reload boundary.
    const browserWindow = window;
    vi.stubGlobal(
      "window",
      new Proxy(browserWindow, {
        get(target, property) {
          return property === "location"
            ? { reload }
            : Reflect.get(target, property);
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    page.unmount();
    notification.unmount();

    const otherGame = render(game("other"));
    expect(screen.getByPlaceholderText("Type a word…")).toHaveValue("");
    otherGame.unmount();
    render(game("game"));
    expect(screen.getByPlaceholderText("Type a word…")).toHaveValue("apple");
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
});
