type PostHog = (typeof import("posthog-js"))["default"];

let ready: (client: PostHog) => void = () => {};
export const posthogReady = new Promise<PostHog>((resolve) => {
  ready = resolve;
});

export function markPosthogReady(client: PostHog) {
  initialization = { status: "ready" };
  ready(client);
}

// Readiness remains pending on failure so identity work can wait for a retry.
type Initialization =
  | { status: "idle" }
  | { status: "loading"; promise: Promise<void> }
  | { status: "ready" };
let initialization: Initialization = { status: "idle" };

/** Called on idle by instrumentation; importing this module never loads the SDK. */
export function loadPosthog(): Promise<void> {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const environment = process.env.NEXT_PUBLIC_POSTHOG_ENVIRONMENT;
  if (!token || !environment || initialization.status === "ready") {
    return Promise.resolve();
  }
  if (initialization.status === "loading") return initialization.promise;
  const promise = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(token, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_pageview: "history_change",
        capture_pageleave: false,
        autocapture: false,
        capture_dead_clicks: false,
        rageclick: false,
        disable_session_recording: true,
        capture_exceptions: false,
      });
      posthog.register({ deployment_environment: environment });
      markPosthogReady(posthog);
    })
    .catch((error: unknown) => {
      initialization = { status: "idle" };
      throw error;
    });
  initialization = { status: "loading", promise };
  return promise;
}
