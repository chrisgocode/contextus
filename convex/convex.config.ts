import presence from "@convex-dev/presence/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    E2E_TEST: v.optional(v.string()),
  },
});
app.use(presence);
export default app;
