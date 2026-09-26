import presence from "@convex-dev/presence/convex.config.js";
import posthog from "@posthog/convex/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    E2E_TEST: v.optional(v.string()),
    POSTHOG_PROJECT_TOKEN: v.string(),
    POSTHOG_ENVIRONMENT: v.optional(v.string()),
  },
});
app.use(presence);
app.use(posthog, {
  env: { POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN },
});
export default app;
