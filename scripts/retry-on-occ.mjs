// `convex env set` reads the system tables that `convex dev`'s push writes, so
// the backend fails it with a 503 OCC when the two overlap, and neither the
// backend nor the CLI retries a POST. Setting the same values again is safe.
const OCC = "OptimisticConcurrencyControlFailure";

/**
 * Calls `run` until it succeeds, fails with something other than an OCC, or
 * runs out of attempts, and returns its last exit status.
 *
 * @param {() => { status: number | null, output: string }} run
 * @param {{ attempts?: number, delayMs?: number, sleep?: (ms: number) => void }} [options]
 */
export function retryOnOcc(
  run,
  { attempts = 5, delayMs = 500, sleep = sleepSync } = {},
) {
  for (let attempt = 1; ; attempt++) {
    const { status, output } = run();
    if (status === 0) return 0;
    if (attempt === attempts || !output.includes(OCC)) return status ?? 1;
    sleep(delayMs * attempt);
  }
}

/** @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
