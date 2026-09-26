import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/server"]);

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/signin");
    }
  },
  { cookieConfig: { maxAge: 60 * 60 * 24 * 30 } },
);

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
