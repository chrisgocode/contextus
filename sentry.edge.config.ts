// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sentryDsn, sentryEnabled, sentryEnvironment } from "@/lib/sentry";

Sentry.init({
  dsn: sentryDsn,
  enabled: sentryEnabled,
  environment: sentryEnvironment,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Send user PII (IP address, request headers, and so on) like
  // `sendDefaultPii: true`, except cookies: those are the Convex Auth session
  // tokens, and Sentry doesn't need them.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/
  dataCollection: { cookies: false },
});
