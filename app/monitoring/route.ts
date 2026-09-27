import { sentryDsn } from "@/lib/sentry";

// First-party tunnel for browser Sentry events, so ad blockers don't drop
// them. Sentry's `tunnelRoute` rewrite would forward every request header,
// including the Convex Auth session cookies, so this sends only the envelope
// and the headers Sentry needs.
// https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
const dsn = new URL(sentryDsn);
const ENVELOPE_URL = `https://${dsn.host}/api${dsn.pathname}/envelope/`;
// x-forwarded-for keeps Sentry's IP-based user and location data pointing at
// the player rather than the server.
const REQUEST_HEADERS = ["content-type", "x-forwarded-for"];
const RESPONSE_HEADERS = [
  "content-type",
  "retry-after",
  "x-sentry-rate-limits",
];

export async function POST(request: Request) {
  const envelope = await request.arrayBuffer();
  if (!isForOurProject(envelope)) {
    return new Response(null, { status: 400 });
  }
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const upstream = await fetch(ENVELOPE_URL, {
    method: "POST",
    headers,
    body: envelope,
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

// The envelope's first line is a JSON header naming the DSN it's meant for.
// Items after it may be binary (compressed replays), so only that line is
// decoded.
function isForOurProject(envelope: ArrayBuffer) {
  const bytes = new Uint8Array(envelope);
  const end = bytes.indexOf(0x0a);
  const line = new TextDecoder().decode(
    end === -1 ? bytes : bytes.subarray(0, end),
  );
  try {
    const header: { dsn?: unknown } = JSON.parse(line);
    if (typeof header.dsn !== "string") return false;
    const target = new URL(header.dsn);
    return target.host === dsn.host && target.pathname === dsn.pathname;
  } catch {
    return false;
  }
}
