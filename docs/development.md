# Development

See the [README](../README.md#quick-start) for first-time setup.

## Local setup details

`bun run dev` first runs `predev`, which does two things:

1. `convex init` links the project to a Convex deployment. On first run it prompts you to log in.
2. `setup.mjs --once` runs `npx @convex-dev/auth` a single time to generate the Convex Auth signing keys (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`). It then writes `SETUP_SCRIPT_RAN=1` to `.env.local` so it doesn't run again.

After that, `convex dev` watches `convex/` and pushes functions to your dev deployment, and `next dev` serves the app.

To enable Google sign-in locally, create an OAuth client in Google Cloud Console. Use `<your CONVEX_SITE_URL>/api/auth/callback/google` as the redirect URI, then set the credentials:

```bash
npx convex env set AUTH_GOOGLE_ID <client-id>
npx convex env set AUTH_GOOGLE_SECRET <client-secret>
```

Guest play works without Google credentials.

## Testing

### Unit and Convex tests

```bash
bun run test          # one shot, with coverage
bun run test:watch    # watch mode
```

Tests use [Vitest](https://vitest.dev) with [`convex-test`](https://docs.convex.dev/testing/convex-test), which runs Convex functions against an in-memory backend in the `@edge-runtime/vm` environment. Pure logic in `convex/lib/` gets plain unit tests.

The Contexto API is never called in tests. Use `mockContextoFetch` from `convex/testHelpers.test.ts` to stub guess, tip, and give-up responses.

Changes to the Convex API surface (new or changed queries, mutations, and actions) should be written test-first.

### End-to-end tests

Playwright tests live in `e2e/`. They run against a real Convex dev deployment and a Next.js server on port 3100.

One-time setup:

```bash
npx convex env set E2E_TEST 1   # enables password auth + E2E account cleanup
bunx playwright install chromium
```

Then add these to `.env.local`:

```bash
E2E_BASE_URL=http://localhost:3100
E2E_ACCOUNT_NAMESPACE=local
E2E_PASSWORD=<any password>
```

Run:

```bash
bun run test:e2e       # headless
bun run test:e2e:ui    # Playwright UI mode
```

Playwright starts `bun run dev:e2e` if nothing is already running on the base URL (in CI it serves a production build with `bun run start:e2e`). Global setup and teardown purge the test accounts through `e2eCleanup.purgeAccount`. Spec files are named `*.guest.spec.ts` or `*.registered.spec.ts` depending on which kind of user they test.

With `E2E_TEST=1`, the backend scores words with `convex/e2eWordOracle.ts` instead of calling Contexto, and skips the `wordDistances` cache so fake and real scores never mix: `wordN` is at distance N, `word0` is the answer, hints return `wordN`, and other plain words get a stable distance of 1000 or more. Any deployment with `E2E_TEST=1`, including your dev deployment, plays with fake distances.

> **Do not set `E2E_TEST` on a production deployment.** It enables password sign-in, shortens guest lifetimes to one hour, and replaces Contexto with the fake word oracle.

#### In CI

The `e2e` job in `.github/workflows/ci.yml` needs no secrets. It starts a throwaway local Convex backend with `CONVEX_AGENT_MODE=anonymous npx convex dev`, then runs `scripts/setup-e2e-convex-env.mjs` to set `E2E_TEST`, `SITE_URL`, and a fresh Convex Auth signing key. Convex starts in the background while the app builds, since the build only needs the backend's fixed local URL. The build reuses a cached `.next/cache` and skips its type check (`SKIP_BUILD_TYPECHECK=1`), because the `check` job already runs `tsc`. Playwright's headless Chromium uses the runner's preinstalled system libraries, so the job has no apt step. When the job fails, the Playwright report, traces, and Convex log are uploaded as the `playwright-report` artifact.

## Code quality

| Check      | Command                | Runs in        |
| ---------- | ---------------------- | -------------- |
| Lint       | `bun run lint`         | pre-commit, CI |
| Formatting | `bun run format:check` | pre-commit, CI |
| Types      | `bun run typecheck`    | CI             |
| Tests      | `bun run test`         | CI             |

Linting uses [oxlint](https://oxc.rs/docs/guide/usage/linter) (`.oxlintrc.json`) and formatting uses [oxfmt](https://oxc.rs/docs/guide/usage/formatter) (`.oxfmtrc.json`). Run `bun run format` to fix formatting. oxlint loads `@convex-dev/eslint-plugin` as a JS plugin for files under `convex/`. Before changing Convex code, read `convex/_generated/ai/guidelines.md`.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. It installs dependencies with Bun and runs lint, format check, typecheck, and tests.

## Deployment

**Convex:** `.github/workflows/deploy-convex.yml` runs `convex deploy` on every push to `main`. It needs a production deploy key stored as the `CONVEX_DEPLOY_KEY` repository secret. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and the Convex Auth keys on the production deployment in the Convex dashboard.

**Frontend:** Vercel. Set `NEXT_PUBLIC_CONVEX_URL` to the production Convex URL in Vercel's environment variables, then push. Each Vercel deployment ID becomes the app version, and open tabs are prompted to refresh when a new one goes live.

**Sentry:** source maps upload during `next build` when a Sentry auth token is available in the build environment.

**PostHog:** set `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` in Vercel's environment variables for production and preview.

## Contributing

- **Issues:** use [GitHub Issues](https://github.com/chrisgocode/contextus/issues). Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- **Commits:** follow [Conventional Commits](https://www.conventionalcommits.org) (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, …). Subjects can be at most 88 characters. The Husky `commit-msg` hook enforces both.
- **Pull requests:** fill in the [PR template](../.github/pull_request_template.md). Include test commands you ran, screenshots for UI changes, and notes on any schema or env var changes.
- **Schema changes:** Convex validates existing data against the new schema on deploy. Breaking changes need a migration.
- **Domain docs:** architecture decisions go in `docs/adr/`.
