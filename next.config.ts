import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// Identifies this build to clients so they can tell when a newer deployment
// is live (see lib/new-version.ts). On Vercel every deployment gets its own ID,
// so redeploys with changed env vars also prompt a refresh; elsewhere each
// build gets a unique timestamp.
const appVersion =
  process.env.VERCEL_DEPLOYMENT_ID ?? `build-${Date.now().toString(36)}`;

// Sentry reports only from Vercel deployments, tagged "production" or
// "preview". Local builds and e2e runs (which talk to the dev Convex
// deployment) leave this empty, so they never report (see lib/sentry.ts).
// `vercel dev` and `vercel env pull` set VERCEL_ENV=development locally,
// so match the deployed values explicitly.
const vercelEnv = process.env.VERCEL_ENV;
const sentryEnvironment =
  vercelEnv === "production" || vercelEnv === "preview" ? vercelEnv : "";

const nextConfig: NextConfig = {
  experimental: {
    // Tailwind's CSS is small (~12 KB compressed), so shipping it inside the
    // HTML beats a render-blocking stylesheet request on first load.
    inlineCss: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentryEnvironment,
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "contextus-2w",

  project: "contextus",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,
  },
});
