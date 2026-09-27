import {
  convexAuthNextjsMiddleware,
  convexAuthNextjsToken,
} from "@convex-dev/auth/nextjs/server";
import { type NextFetchEvent, NextRequest } from "next/server";

const authMiddleware = convexAuthNextjsMiddleware(undefined, {
  cookieConfig: { maxAge: 60 * 60 * 24 * 30 },
});

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (request.nextUrl.pathname === "/api/auth/stale") {
    return signOutStaleSession(request, event);
  }
  return authMiddleware(request, event);
}

// A page whose session is gone asks to sign it out. Convex Auth's sign-out
// uses the auth cookie, which every tab shares, so once another tab has signed
// in it holds a different session. Sign out only when the cookie still holds
// the page's session; otherwise leave the cookie alone and let the page reload
// to pick it up.
async function signOutStaleSession(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (request.method !== "POST") {
    return new Response("Invalid method", { status: 405 });
  }
  const body: { sessionId?: unknown } = await request.json().catch(() => ({}));
  const cookieToken = await convexAuthNextjsToken();
  if (
    typeof body.sessionId !== "string" ||
    cookieToken === undefined ||
    sessionOf(cookieToken) !== body.sessionId
  ) {
    return new Response(null, { status: 204 });
  }
  return authMiddleware(
    new NextRequest(new URL("/api/auth", request.url), {
      method: "POST",
      body: JSON.stringify({ action: "auth:signOut" }),
    }),
    event,
  );
}

// Convex Auth access tokens carry `userId|sessionId` as their subject.
function sessionOf(token: string) {
  try {
    const payload: { sub?: unknown } = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload.sub !== "string") return null;
    return payload.sub.split("|")[1] ?? null;
  } catch {
    return null;
  }
}

export const config = {
  // The following matcher runs middleware on all routes except static assets,
  // content-only pages, the version check every open tab polls, and the
  // Sentry and PostHog tunnels. None of those use auth or are OAuth landing pages, so
  // skipping them saves a middleware hop.
  matcher: [
    "/((?!.*\\..*|_next|how-to-play|privacy|monitoring|ingest|api/version).*)",
    "/",
    "/api/((?!version$).*)",
  ],
};
