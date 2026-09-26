// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sentryEnabled, sentryEnvironment } from "@/lib/sentry";

Sentry.init({
  dsn: "https://85ede5126abf32a201118c5f021bb7e9@o4511398152437760.ingest.us.sentry.io/4511405904297984",
  enabled: sentryEnabled,
  environment: sentryEnvironment,

  // Replay is added after page load (see below) so rrweb stays out of the
  // main client bundle.
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

// Fetch Replay from the Sentry CDN once the page has loaded, instead of
// bundling it for every visitor. The sample rates above apply once it's added.
// Errors thrown before then are still captured, just without a replay.
function loadReplay() {
  Sentry.lazyLoadIntegration("replayIntegration")
    .then((replayIntegration) => Sentry.addIntegration(replayIntegration()))
    .catch(() => {
      // Replay is best-effort; ad blockers may block the CDN script.
    });
}

if (!sentryEnabled) {
  // Nothing reports outside Vercel, so skip the CDN fetch too.
} else if (document.readyState === "complete") {
  loadReplay();
} else {
  window.addEventListener("load", loadReplay, { once: true });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
