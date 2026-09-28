import { type NextFetchEvent, NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  middleware: vi.fn(),
  cookieToken: vi.fn(),
}));

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsMiddleware: () => auth.middleware,
  convexAuthNextjsToken: auth.cookieToken,
}));

const { default: proxy } = await import("@/proxy");

const event = {} as NextFetchEvent;

function accessToken(userId: string, sessionId: string) {
  const payload = btoa(JSON.stringify({ sub: `${userId}|${sessionId}` }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

function staleSignOut(sessionId: unknown) {
  return proxy(
    new NextRequest("https://contextus.test/api/auth/stale", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
    event,
  );
}

beforeEach(() => {
  auth.middleware.mockResolvedValue(Response.json(null));
});

describe("POST /api/auth/stale", () => {
  it("signs out when the cookie still holds the page's session", async () => {
    auth.cookieToken.mockResolvedValue(accessToken("guest", "s1"));

    const response = await staleSignOut("s1");

    expect(response?.status).toBe(200);
    const [forwarded] = auth.middleware.mock.calls[0];
    expect(forwarded.nextUrl.pathname).toBe("/api/auth");
    await expect(forwarded.json()).resolves.toEqual({
      action: "auth:signOut",
    });
  });

  it("leaves another session in the cookie alone", async () => {
    auth.cookieToken.mockResolvedValue(accessToken("account", "s2"));

    const response = await staleSignOut("s1");

    expect(response?.status).toBe(204);
    expect(auth.middleware).not.toHaveBeenCalled();
  });

  it.each([
    ["no cookie", undefined, "s1"],
    ["a malformed cookie", "garbage", "s1"],
    ["no session", accessToken("guest", "s1"), undefined],
  ])("does nothing with %s", async (_, cookieToken, sessionId) => {
    auth.cookieToken.mockResolvedValue(cookieToken);

    const response = await staleSignOut(sessionId);

    expect(response?.status).toBe(204);
    expect(auth.middleware).not.toHaveBeenCalled();
  });

  it("does nothing with a body that isn't an object", async () => {
    auth.cookieToken.mockResolvedValue(accessToken("guest", "s1"));

    const response = await proxy(
      new NextRequest("https://contextus.test/api/auth/stale", {
        method: "POST",
        body: "null",
      }),
      event,
    );

    expect(response?.status).toBe(204);
    expect(auth.middleware).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    const response = await proxy(
      new NextRequest("https://contextus.test/api/auth/stale"),
      event,
    );

    expect(response?.status).toBe(405);
  });

  it("passes every other request to Convex Auth", async () => {
    const request = new NextRequest("https://contextus.test/r/ABC123");

    await proxy(request, event);

    expect(auth.middleware).toHaveBeenCalledWith(request, event);
  });
});
