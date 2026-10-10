import presence from "@convex-dev/presence/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import posthog from "@posthog/convex/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    E2E_TEST: v.optional(v.string()),
    E2E_GOOGLE_ISSUER: v.optional(v.string()),
    POSTHOG_PROJECT_TOKEN: v.string(),
    POSTHOG_ENVIRONMENT: v.optional(v.string()),
    // Google sign-in on PR previews, forwarded through production. The secret
    // is set on production only, the other two on previews only.
    PREVIEW_OAUTH_STATE_SECRET: v.optional(v.string()),
    PREVIEW_OAUTH_CALLBACK_URL: v.optional(v.string()),
    PREVIEW_OAUTH_STATE: v.optional(v.string()),
  },
});
app.use(presence);
app.use(posthog, {
  env: { POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN },
});
app.use(rateLimiter);

export default app;
