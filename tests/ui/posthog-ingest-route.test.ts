import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { GET, POST } from "@/app/ingest/[...path]/route";

function upstream() {
  const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("forwards events to PostHog without the session's cookies or auth", async () => {
  const fetch = upstream();
  const response = await POST(
    new NextRequest("https://contextus.test/ingest/e/?compression=gzip-js", {
      method: "POST",
      body: "payload",
      headers: {
        cookie: "__convexAuthJWT=secret; __convexAuthRefreshToken=secret",
        authorization: "Bearer secret",
        "content-type": "text/plain",
        "user-agent": "test-browser",
        "x-forwarded-for": "203.0.113.7",
      },
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
  const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(url)).toBe("https://us.i.posthog.com/e/?compression=gzip-js");
  const headers = new Headers(init.headers);
  expect(headers.get("cookie")).toBeNull();
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("content-type")).toBe("text/plain");
  expect(headers.get("user-agent")).toBe("test-browser");
  expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe("payload");
});

it("serves SDK assets from PostHog's asset host", async () => {
  const fetch = upstream();
  await GET(
    new NextRequest("https://contextus.test/ingest/static/array.js", {
      headers: { cookie: "__convexAuthJWT=secret" },
    }),
  );

  const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(url)).toBe("https://us-assets.i.posthog.com/static/array.js");
  expect(new Headers(init.headers).get("cookie")).toBeNull();
});

it("keeps protocol-relative paths on PostHog's host", async () => {
  const fetch = upstream();
  await GET(new NextRequest("https://contextus.test/ingest//evil.test/x"));

  const [url] = fetch.mock.calls[0] as unknown as [URL];
  expect(new URL(url).host).toBe("us.i.posthog.com");
});

it("keeps encoded separators inside the forwarded path", async () => {
  const fetch = upstream();
  await GET(
    new NextRequest("https://contextus.test/ingest/a%2F%3F%23%40b/?ip=0"),
  );

  const [url] = fetch.mock.calls[0] as unknown as [URL];
  expect(String(url)).toBe("https://us.i.posthog.com/a%2F%3F%23%40b/?ip=0");
});
