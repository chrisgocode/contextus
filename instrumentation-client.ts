// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// The SDK itself is loaded once the page is idle (see lib/sentry-client.ts),
// so it never competes with hydration. Uncaught errors from before then are
// buffered here and reported once it's ready.

import type * as SentrySdk from "@sentry/nextjs";
import { sentryEnabled } from "@/lib/sentry";
import { loadSentry } from "@/lib/sentry-client";

let sentry: typeof SentrySdk | undefined;

if (sentryEnabled) {
  const early: unknown[] = [];
  const onError = (event: ErrorEvent) => early.push(event.error ?? event);
  const onRejection = (event: PromiseRejectionEvent) =>
    early.push(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  const start = () => {
    loadSentry()
      .then((Sentry) => {
        sentry = Sentry;
        // Sentry's own global handlers take over from here.
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        for (const error of early.splice(0)) Sentry.captureException(error);
      })
      .catch(() => {
        // Blocked or offline: the page works without Sentry.
      });
  };
  const startWhenIdle = () =>
    "requestIdleCallback" in window
      ? requestIdleCallback(start, { timeout: 3000 })
      : setTimeout(start, 0);

  if (document.readyState === "complete") startWhenIdle();
  else window.addEventListener("load", startWhenIdle, { once: true });
}

export function onRouterTransitionStart(
  ...args: Parameters<typeof SentrySdk.captureRouterTransitionStart>
) {
  sentry?.captureRouterTransitionStart(...args);
}
