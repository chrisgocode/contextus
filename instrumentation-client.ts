// This file configures the initialization of Sentry and PostHog on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// The SDK itself is loaded once the page is idle (see lib/sentry-client.ts),
// so it never competes with hydration. Uncaught errors from before then are
// buffered here and reported once it's ready.

import type * as SentrySdk from "@sentry/nextjs";
import { sentryEnabled } from "@/lib/sentry";
import { loadSentry } from "@/lib/sentry-client";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogEnvironment = process.env.NEXT_PUBLIC_POSTHOG_ENVIRONMENT;
if (posthogEnvironment && posthogToken) {
  // Pageviews only: interaction capture, replay, and errors (Sentry's job)
  // stay off. Loaded on idle like Sentry below.
  const start = () => {
    void import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(posthogToken, {
          api_host:
            process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
          defaults: "2026-01-30",
          capture_pageview: "history_change",
          autocapture: false,
          capture_dead_clicks: false,
          rageclick: false,
          disable_session_recording: true,
          capture_exceptions: false,
        });
        // Tag browser events like server events so previews can be filtered.
        posthog.register({ deployment_environment: posthogEnvironment });
      })
      // Analytics is best-effort and must never break the page.
      .catch(() => {});
  };
  const startWhenIdle = () =>
    "requestIdleCallback" in window
      ? requestIdleCallback(start, { timeout: 3000 })
      : setTimeout(start, 0);

  if (document.readyState === "complete") startWhenIdle();
  else window.addEventListener("load", startWhenIdle, { once: true });
}

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
        // Blocked or offline: the page works without Sentry. Stop buffering
        // so the queue can't grow for the rest of the session.
        // captureException still retries the import on the next reported
        // error.
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        early.length = 0;
      });
  };
  const startWhenIdle = () =>
    "requestIdleCallback" in window
      ? requestIdleCallback(start, { timeout: 3000 })
      : setTimeout(start, 0);

  if (document.readyState === "complete") startWhenIdle();
  else window.addEventListener("load", startWhenIdle, { once: true });
}

// Transitions before the SDK loads aren't replayed: Sentry would start their
// navigation spans at replay time, not when they happened. The pageload span
// starts at timeOrigin, so it covers that window instead.
export function onRouterTransitionStart(
  ...args: Parameters<typeof SentrySdk.captureRouterTransitionStart>
) {
  sentry?.captureRouterTransitionStart(...args);
}
