const DEFAULT_POLL_INTERVAL_MS = 60_000;
// A hung request would block every later check, so give up well before the
// next poll.
const FETCH_TIMEOUT_MS = 10_000;

type WatchOptions = {
  /** Resolves to the currently deployed version, or null if unknown. */
  fetchLatestVersion?: () => Promise<string | null>;
  pollIntervalMs?: number;
};

type Check = {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
};

type WatchState =
  | { status: "watching" }
  | { status: "checking"; check: Check }
  | { status: "stopped" };

type CheckOutcome =
  | { type: "response"; version: string | null }
  | { type: "failure" }
  | { type: "timeout" };

async function fetchDeployedVersion(
  signal: AbortSignal,
): Promise<string | null> {
  const response = await fetch("/api/version", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("version" in body)) {
    return null;
  }
  return typeof body.version === "string" ? body.version : null;
}

/**
 * Watches for a deployment newer than `currentVersion` and calls
 * `onNewVersion` once per distinct newer version.
 *
 * Checks every `pollIntervalMs` while the tab is visible, and immediately when
 * the user comes back to the tab (focus, visibility, reconnect, bfcache
 * restore). Overlapping checks collapse into one request; failed or empty
 * checks are ignored so flaky networks never prompt a refresh.
 *
 * Browser-only. Returns a function that stops watching.
 */
export function watchForNewVersion(
  currentVersion: string,
  onNewVersion: (latestVersion: string) => void,
  {
    fetchLatestVersion,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  }: WatchOptions = {},
): () => void {
  let state: WatchState = { status: "watching" };
  const notifiedVersions = new Set<string>();

  function complete(check: Check, outcome: CheckOutcome) {
    // Only the currently owned check can finish. A timed-out or stopped
    // request may still resolve if the transport ignores cancellation.
    if (state.status !== "checking" || state.check !== check) return;
    clearTimeout(check.timeout);
    state = { status: "watching" };
    if (outcome.type === "timeout") check.controller.abort();
    if (outcome.type !== "response") return;

    const latest = outcome.version;
    if (!latest || latest === currentVersion || notifiedVersions.has(latest)) {
      return;
    }
    notifiedVersions.add(latest);
    onNewVersion(latest);
  }

  function checkIfVisible() {
    if (state.status !== "watching" || document.visibilityState !== "visible") {
      return;
    }
    const controller = new AbortController();
    const check: Check = {
      controller,
      timeout: setTimeout(
        () => complete(check, { type: "timeout" }),
        FETCH_TIMEOUT_MS,
      ),
    };
    state = { status: "checking", check };
    // The timeout belongs to the watcher, so even a custom fetcher or a body
    // that ignores abort cannot keep it in checking forever.
    void (async () => {
      try {
        const version = await (fetchLatestVersion
          ? fetchLatestVersion()
          : fetchDeployedVersion(controller.signal));
        complete(check, { type: "response", version });
      } catch {
        // Offline or mid-deploy: try again on the next trigger.
        complete(check, { type: "failure" });
      }
    })();
  }

  const interval = window.setInterval(checkIfVisible, pollIntervalMs);
  document.addEventListener("visibilitychange", checkIfVisible);
  window.addEventListener("focus", checkIfVisible);
  window.addEventListener("online", checkIfVisible);
  window.addEventListener("pageshow", checkIfVisible);

  return () => {
    if (state.status === "stopped") return;
    const previous = state;
    state = { status: "stopped" };
    if (previous.status === "checking") {
      clearTimeout(previous.check.timeout);
      previous.check.controller.abort();
    }
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", checkIfVisible);
    window.removeEventListener("focus", checkIfVisible);
    window.removeEventListener("online", checkIfVisible);
    window.removeEventListener("pageshow", checkIfVisible);
  };
}
