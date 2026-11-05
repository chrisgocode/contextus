import { beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  failNextImport: false,
  imported: vi.fn(),
  init: vi.fn(),
  captureException: vi.fn(),
  lazyLoadIntegration: vi.fn(() => new Promise<() => object>(() => {})),
  addIntegration: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => {
  sdk.imported();
  if (sdk.failNextImport) {
    sdk.failNextImport = false;
    throw new Error("chunk load failed");
  }
  return {
    init: sdk.init,
    captureException: sdk.captureException,
    lazyLoadIntegration: sdk.lazyLoadIntegration,
    addIntegration: sdk.addIntegration,
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.failNextImport = false;
  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "preview");
});

it("retries loading the SDK after a failed import", async () => {
  sdk.failNextImport = true;
  const { loadSentry } = await import("@/lib/sentry-client");
  await expect(loadSentry()).rejects.toThrow();
  await expect(loadSentry()).resolves.toMatchObject({ init: sdk.init });
  expect(sdk.init).toHaveBeenCalledOnce();
});

it("shares in-flight initialization and the initialized SDK across callers", async () => {
  const { loadSentry, captureException } = await import("@/lib/sentry-client");
  const first = loadSentry();
  const second = loadSentry();
  const error = new Error("reported while loading");
  captureException(error, { tags: { source: "test" } });
  expect(second).toBe(first);
  await first;
  await vi.waitFor(() =>
    expect(sdk.captureException).toHaveBeenCalledWith(error, {
      tags: { source: "test" },
    }),
  );
  await loadSentry();
  expect(sdk.init).toHaveBeenCalledOnce();
  expect(sdk.lazyLoadIntegration).toHaveBeenCalledOnce();
});

it("keeps error reporting available if optional Replay fails synchronously", async () => {
  sdk.lazyLoadIntegration.mockImplementationOnce(() => {
    throw new Error("CDN blocked");
  });
  const { loadSentry } = await import("@/lib/sentry-client");
  await expect(loadSentry()).resolves.toMatchObject({ init: sdk.init });
  expect(sdk.init).toHaveBeenCalledOnce();
});

it("does not download Sentry for disabled error reporting", async () => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "");
  const { captureException } = await import("@/lib/sentry-client");
  captureException(new Error("local error"));
  await Promise.resolve();
  expect(sdk.imported).not.toHaveBeenCalled();
});
