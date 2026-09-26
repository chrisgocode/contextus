import type { NextRequest } from "next/server";

// First-party proxy for PostHog, like Sentry's /monitoring tunnel, so ad
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
  const path = request.nextUrl.pathname.replace(/^\/ingest/, "");
  const host = path.startsWith("/static/") ? ASSET_HOST : API_HOST;
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const upstream = await fetch(new URL(path + request.nextUrl.search, host), {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
  });
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
