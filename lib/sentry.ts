// Set from VERCEL_ENV at build time in next.config.ts. Empty outside Vercel
// (local dev, local production builds, e2e), where Sentry stays off.
export const sentryEnvironment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined;

export const sentryEnabled = sentryEnvironment !== undefined;
