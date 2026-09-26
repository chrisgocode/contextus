import type * as SentrySdk from "@sentry/nextjs";
import { sentryEnabled, sentryEnvironment } from "./sentry";

type Sentry = typeof SentrySdk;

let sdk: Promise<Sentry> | undefined;

/**
 * Imports and initializes the Sentry browser SDK once, on first use.
 *
 * The SDK is ~80 KB compressed, so it stays out of the initial bundle:
 * instrumentation-client.ts calls this once the page is idle, and
 * captureException calls it if an error comes first.
 */
export function loadSentry(): Promise<Sentry> {
  sdk ??= importAndInit().catch((error: unknown) => {
    // Let the next call retry, e.g. once the network is back.
    sdk = undefined;
    throw error;
  });
  return sdk;
}

function importAndInit(): Promise<Sentry> {
  return import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: "https://85ede5126abf32a201118c5f021bb7e9@o4511398152437760.ingest.us.sentry.io/4511405904297984",
      enabled: sentryEnabled,
      environment: sentryEnvironment,

      // Replay is added after init (see below) so rrweb stays out of the
      // bundle.
      integrations: [],

      // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
      tracesSampleRate: 0.1,
      // Enable logs to be sent to Sentry
      enableLogs: true,

      // Define how likely Replay events are sampled.
      // This sets the sample rate to be 10%. You may want this to be 100% while
      // in development and sample at a lower rate in production
      replaysSessionSampleRate: 0.1,

      // Define how likely Replay events are sampled when an error occurs.
      replaysOnErrorSampleRate: 1.0,

      // Enable sending user PII (Personally Identifiable Information)
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
      sendDefaultPii: true,
    });

    // Fetch Replay from the Sentry CDN instead of bundling it for every
    // visitor. The sample rates above apply once it's added.
    Sentry.lazyLoadIntegration("replayIntegration")
      .then((replayIntegration) => Sentry.addIntegration(replayIntegration()))
      .catch(() => {
        // Replay is best-effort; ad blockers may block the CDN script.
      });

    return Sentry;
  });
}

export function captureException(
  error: unknown,
  hint?: Parameters<Sentry["captureException"]>[1],
): void {
  // Nothing reports outside Vercel, so don't download the SDK either.
  if (!sentryEnabled) return;
  loadSentry()
    .then((Sentry) => Sentry.captureException(error, hint))
    .catch(() => {
      // The SDK chunk failed to load (offline, blocked); nothing to report to.
    });
}
