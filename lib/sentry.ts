// Set from VERCEL_ENV at build time in next.config.ts. Empty outside Vercel
// (local dev, local production builds, e2e), where Sentry stays off.
export const sentryEnvironment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined;

export const sentryEnabled = sentryEnvironment !== undefined;

// Also checked by the /monitoring tunnel (app/monitoring/route.ts), which only
// forwards envelopes addressed to this project.
export const sentryDsn =
  "https://85ede5126abf32a201118c5f021bb7e9@o4511398152437760.ingest.us.sentry.io/4511405904297984";
