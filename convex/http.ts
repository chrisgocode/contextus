import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { auth } from "./auth";
import { previewOriginFromState } from "./lib/previewOAuth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Forwards Google's OAuth redirect to the preview deployment named in the
// signed state (see lib/previewOAuth.ts). Only production holds the secret, so
// this answers 400 everywhere else. A route of its own, so it never wraps
// Convex Auth's callback.
http.route({
  path: "/api/preview-oauth/callback/google",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const origin = await previewOriginFromState(
      env.PREVIEW_OAUTH_STATE_SECRET,
      url.searchParams.get("state"),
    );
    if (origin === null) return new Response("Invalid state", { status: 400 });
    // Query unchanged, so the preview sees exactly what Google sent.
    return Response.redirect(
      `${origin}/api/auth/callback/google${url.search}`,
      302,
    );
  }),
});

export default http;
