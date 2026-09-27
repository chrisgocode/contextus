// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
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
