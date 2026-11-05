import { beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  failNextImport: false,
  init: vi.fn(),
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.failNextImport = false;
  vi.doMock("@sentry/nextjs", () => {
    if (sdk.failNextImport) {
      sdk.failNextImport = false;
      throw new Error("offline");
    }
    return {
      init: sdk.init,
      captureException: sdk.captureException,
      captureRouterTransitionStart: sdk.captureRouterTransitionStart,
      lazyLoadIntegration: () => new Promise(() => {}),
    };
  });

  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "preview");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENVIRONMENT", "");
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
});

function dispatchError(error: Error) {
  const event = new ErrorEvent("error", { error, cancelable: true });
  event.preventDefault();
  window.dispatchEvent(event);
}

function dispatchRejection(reason: Error) {
  window.dispatchEvent(
    Object.assign(new Event("unhandledrejection"), { reason }),
  );
}

it("flushes early errors once and forwards only router transitions after readiness", async () => {
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  const removeListener = vi.spyOn(window, "removeEventListener");
  const { onRouterTransitionStart } = await import("@/instrumentation-client");
  const error = new Error("before idle");
  dispatchError(error);
  onRouterTransitionStart("/early", "push");
  expect(sdk.init).not.toHaveBeenCalled();
  idle.mock.calls[0][0]();
  await vi.dynamicImportSettled();
  expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(error);
  expect(removeListener).toHaveBeenCalledWith("error", expect.any(Function));
  expect(removeListener).toHaveBeenCalledWith(
    "unhandledrejection",
    expect.any(Function),
  );
  dispatchRejection(new Error("SDK owns errors now"));
  onRouterTransitionStart("/ready", "push");
  expect(sdk.captureException).toHaveBeenCalledOnce();
  expect(sdk.captureRouterTransitionStart).toHaveBeenCalledExactlyOnceWith(
    "/ready",
    "push",
  );
});

it("discards the early buffer after import failure, removes listeners, and allows an explicit retry", async () => {
  sdk.failNextImport = true;
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  const removeListener = vi.spyOn(window, "removeEventListener");
  await import("@/instrumentation-client");
  dispatchError(new Error("buffered while offline"));
  idle.mock.calls[0][0]();
  await vi.dynamicImportSettled();
  expect(removeListener).toHaveBeenCalledWith("error", expect.any(Function));
  expect(removeListener).toHaveBeenCalledWith(
    "unhandledrejection",
    expect.any(Function),
  );
  dispatchRejection(new Error("after discard"));
  const { captureException } = await import("@/lib/sentry-client");
  const retry = new Error("explicit report retries");
  captureException(retry);
  await vi.dynamicImportSettled();
  expect(sdk.init).toHaveBeenCalledOnce();
  expect(sdk.captureException).toHaveBeenCalledExactlyOnceWith(
    retry,
    undefined,
  );
});

it("does not schedule or download Sentry in disabled environments", async () => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "");
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  const addListener = vi.spyOn(window, "addEventListener");
  await import("@/instrumentation-client");
  expect(idle).not.toHaveBeenCalled();
  expect(addListener).not.toHaveBeenCalledWith("error", expect.any(Function));
  expect(sdk.init).not.toHaveBeenCalled();
});
