import { beforeEach, expect, it, vi } from "vitest";

const { init, register } = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: { init, register } }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", "preview");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "test-token");
});

it("waits until idle and captures pageviews without interaction telemetry", async () => {
  vi.resetModules();
  init.mockClear();
  register.mockClear();
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
      api_host: "/ingest",
      capture_pageview: "history_change",
      capture_pageleave: false,
      autocapture: false,
      capture_dead_clicks: false,
      rageclick: false,
      disable_session_recording: true,
      capture_exceptions: false,
    }),
  );
  expect(register).toHaveBeenCalledWith({
    deployment_environment: "preview",
  });
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

it("shares initialization and releases readiness only after registration", async () => {
  const { loadPosthog, posthogReady } = await import("@/lib/posthog-client");
  const ready = vi.fn();
  void posthogReady.then(ready);
  expect(ready).not.toHaveBeenCalled();
  const first = loadPosthog();
  expect(loadPosthog()).toBe(first);
  await first;
  await posthogReady;
  expect(init).toHaveBeenCalledOnce();
  expect(register).toHaveBeenCalledBefore(ready);
  await loadPosthog();
  expect(init).toHaveBeenCalledOnce();
});

it("keeps readiness pending after initialization fails and permits a retry", async () => {
  init.mockImplementationOnce(() => {
    throw new Error("SDK unavailable");
  });
  const { loadPosthog, posthogReady } = await import("@/lib/posthog-client");
  const ready = vi.fn();
  void posthogReady.then(ready);
  await expect(loadPosthog()).rejects.toThrow("SDK unavailable");
  expect(ready).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  await loadPosthog();
  await posthogReady;
  expect(ready).toHaveBeenCalledOnce();
  expect(register).toHaveBeenCalledWith({ deployment_environment: "preview" });
});

it("absorbs initialization failures in idle instrumentation", async () => {
  init.mockImplementationOnce(() => {
    throw new Error("SDK unavailable");
  });
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  await import("@/instrumentation-client");
  idle.mock.calls[0][0]();
  await vi.dynamicImportSettled();
  expect(init).toHaveBeenCalledOnce();
  expect(register).not.toHaveBeenCalled();
});

it("does not import PostHog without a project token", async () => {
  const imported = vi.fn();
  vi.doMock("posthog-js", () => {
    imported();
    return { default: { init, register } };
  });
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
  const { loadPosthog } = await import("@/lib/posthog-client");
  await loadPosthog();
  expect(imported).not.toHaveBeenCalled();
});
