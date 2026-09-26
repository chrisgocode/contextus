import { expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
vi.mock("posthog-js", () => ({ default: { init } }));
vi.mock("@/lib/sentry", () => ({ sentryEnabled: false }));

it("waits until idle and captures pageviews without interaction telemetry", async () => {
  vi.resetModules();
  init.mockClear();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", "preview");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "test-token");
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");

  await import("@/instrumentation-client");
  expect(init).not.toHaveBeenCalled();
  expect(idle).toHaveBeenCalledOnce();

  idle.mock.calls[0][0]();
  await vi.waitFor(() => expect(init).toHaveBeenCalledOnce());
  expect(init).toHaveBeenCalledWith(
    "test-token",
    expect.objectContaining({
      capture_pageview: "history_change",
      autocapture: false,
      capture_dead_clicks: false,
      rageclick: false,
      disable_session_recording: true,
      capture_exceptions: false,
    }),
  );
});

it("does not load PostHog outside production and preview", async () => {
  vi.resetModules();
  init.mockClear();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "test-token");
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);

  await import("@/instrumentation-client");
  expect(idle).not.toHaveBeenCalled();
  expect(init).not.toHaveBeenCalled();
});
