import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Auth config is evaluated outside the function runtime, so read the
      // platform-provided variable directly.
      // eslint-disable-next-line @convex-dev/no-process-env
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
