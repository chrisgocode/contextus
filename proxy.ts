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
  // The following matcher runs middleware on all routes except static assets
  // and content-only pages. Those pages don't use auth and aren't OAuth
  // landing pages, so skipping them lets the CDN serve them without a
  // middleware hop.
  matcher: ["/((?!.*\\..*|_next|how-to-play).*)", "/", "/(api|trpc)(.*)"],
};
