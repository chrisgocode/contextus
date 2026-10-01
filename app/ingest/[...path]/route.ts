import type { NextRequest } from "next/server";

// First-party proxy for PostHog, like the Sentry /monitoring tunnel, so ad
// blockers don't drop events. A plain rewrite would forward every request
// header, including the Convex Auth session cookies, so only the headers
// PostHog needs are passed on.
const API_HOST = "https://us.i.posthog.com";
const ASSET_HOST = "https://us-assets.i.posthog.com";
const REQUEST_HEADERS = [
  "accept",
  "content-encoding",
  "content-type",
  "user-agent",
  "x-forwarded-for",
];
const RESPONSE_HEADERS = ["cache-control", "content-type"];

async function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/").slice(2);
  const host = segments[0] === "static" ? ASSET_HOST : API_HOST;
  // Re-encode each segment so the path can't reach the upstream URL's host,
  // query, or fragment. Next has already rejected undecodable segments with a
  // 400, so decoding can't throw.
  const path = segments
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
  const query = request.nextUrl.search.slice(1);
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Prefix the host rather than resolving against it: `new URL("//evil.test",
  // host)` would swap the host out.
  const upstream = await fetch(
    new URL(`${host}/${path}${query ? `?${query}` : ""}`),
    {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
    },
  );
  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
