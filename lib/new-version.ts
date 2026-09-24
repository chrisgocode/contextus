const DEFAULT_POLL_INTERVAL_MS = 60_000;
// A hung request would block every later check, so give up well before the
// next poll.
const FETCH_TIMEOUT_MS = 10_000;

type WatchOptions = {
  /** Resolves to the currently deployed version, or null if unknown. */
  fetchLatestVersion?: () => Promise<string | null>;
  pollIntervalMs?: number;
};

async function fetchDeployedVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetch("/api/version", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    body = await response.json();
  } finally {
    clearTimeout(timeout);
  }
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
    fetchLatestVersion = fetchDeployedVersion,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  }: WatchOptions = {},
): () => void {
  let stopped = false;
  let checking = false;
  let lastNotified: string | null = null;

  async function check() {
    if (stopped || checking) return;
    checking = true;
    try {
      const latest = await fetchLatestVersion();
      if (stopped || !latest) return;
      if (latest === currentVersion || latest === lastNotified) return;
      lastNotified = latest;
      onNewVersion(latest);
    } catch {
      // Offline or mid-deploy: try again on the next trigger.
    } finally {
      checking = false;
    }
  }

  function checkIfVisible() {
    if (document.visibilityState === "visible") void check();
  }

  const interval = window.setInterval(checkIfVisible, pollIntervalMs);
  document.addEventListener("visibilitychange", checkIfVisible);
  window.addEventListener("focus", checkIfVisible);
  window.addEventListener("online", checkIfVisible);
  window.addEventListener("pageshow", checkIfVisible);

  return () => {
    stopped = true;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", checkIfVisible);
    window.removeEventListener("focus", checkIfVisible);
    window.removeEventListener("online", checkIfVisible);
    window.removeEventListener("pageshow", checkIfVisible);
  };
}
