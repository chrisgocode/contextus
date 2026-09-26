import { expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  failNextImport: true,
  init: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => {
  if (sdk.failNextImport) {
    sdk.failNextImport = false;
    throw new Error("chunk load failed");
  }
  return {
    init: sdk.init,
    lazyLoadIntegration: () => new Promise(() => {}),
  };
});

it("retries loading the SDK after a failed import", async () => {
  const { loadSentry } = await import("@/lib/sentry-client");

  await expect(loadSentry()).rejects.toThrow();
  await expect(loadSentry()).resolves.toMatchObject({ init: sdk.init });
  expect(sdk.init).toHaveBeenCalledOnce();
});
