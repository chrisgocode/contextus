import { expect, it, vi } from "vitest";
import { POST } from "@/app/monitoring/route";

const DSN =
  "https://85ede5126abf32a201118c5f021bb7e9@o4511398152437760.ingest.us.sentry.io/4511405904297984";

function upstream() {
  const fetch = vi.fn(
    async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-sentry-rate-limits": "60:error:organization",
          "set-cookie": "sentry=secret",
        },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function envelope(dsn: string) {
  return [
    JSON.stringify({ event_id: "abc", dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({ message: "boom" }),
  ].join("\n");
}

it("forwards envelopes to Sentry without the session's cookies or auth", async () => {
  const fetch = upstream();
  const body = envelope(DSN);
  const response = await POST(
    new Request("https://contextus.test/monitoring", {
      method: "POST",
      body,
      headers: {
        cookie: "__convexAuthJWT=secret; __convexAuthRefreshToken=secret",
        authorization: "Bearer secret",
        "content-type": "text/plain;charset=UTF-8",
        "x-forwarded-for": "203.0.113.7",
      },
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("x-sentry-rate-limits")).toBe(
    "60:error:organization",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(
    "https://o4511398152437760.ingest.us.sentry.io/api/4511405904297984/envelope/",
  );
  const headers = new Headers(init.headers);
  expect(headers.get("cookie")).toBeNull();
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("content-type")).toBe("text/plain;charset=UTF-8");
  expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body);
});

it.each([
  [
    "another host",
    envelope(
      "https://85ede5126abf32a201118c5f021bb7e9@o1.ingest.us.sentry.io/4511405904297984",
    ),
  ],
  [
    "another project",
    envelope(
      "https://85ede5126abf32a201118c5f021bb7e9@o4511398152437760.ingest.us.sentry.io/1",
    ),
  ],
  ["no DSN", JSON.stringify({ event_id: "abc" })],
  ["a malformed header", "not json\n{}"],
])("rejects envelopes with %s", async (_, body) => {
  const fetch = upstream();
  const response = await POST(
    new Request("https://contextus.test/monitoring", { method: "POST", body }),
  );

  expect(response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
