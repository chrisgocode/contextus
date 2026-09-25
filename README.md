# Contextus

Co-op multiplayer [Contexto](https://contexto.me). Create a room, share the six-letter code, and solve the daily word puzzle together.

**[Play at contextus.sh →](https://www.contextus.sh)** · [How to play](https://www.contextus.sh/how-to-play)

![Two players in the same room guessing together until one finds the answer](https://25ka9rbhbh.ufs.sh/f/QXdPbNz3CXbYb16kXfmND4OLEXiV7ZAqBHh1oKRMxuly9wFm)

## Features

- **Play instantly as a guest.** No account needed. Guests can create or join up to three active rooms at once and keep their progress for 30 days.
- **Keep your progress with Google.** Signing in merges your guest history, stats, and achievements into a permanent account.
- **Shared guess list in real time.** Everyone in the room sees each guess and its rank as soon as it lands. A word counts once per game, no matter who guesses it.
- **Any puzzle in the archive.** The host picks from every Contexto puzzle since launch, then can start another after the round ends.
- **Hints and give-ups by request.** The host can use them directly. Other players send a request that the host approves or denies.
- **Host handoff.** If the host goes offline, the next player online becomes host. Rooms with no one online end after 30 minutes of inactivity.
- **Profiles and achievements.** Each player gets a public profile with a year-long activity graph and 33 achievements across bronze, silver, gold, diamond, and hidden tiers.

## Quick start

Requires [Bun](https://bun.sh) and a free [Convex](https://convex.dev) account.

```bash
bun install
bun run dev
```

`bun run dev` runs `convex dev` and `next dev` together. On first run it asks you to log into Convex, provisions a dev deployment, writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local`, and sets up the Convex Auth keys.

### Environment variables

| Variable                 | Where                                        | Required for       | Notes                                                                                         |
| ------------------------ | -------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local`                                 | Everything         | Written automatically by `convex dev`                                                         |
| `AUTH_GOOGLE_ID`         | Convex dashboard env vars                    | Google sign-in     | OAuth client ID. Guest play works without it                                                  |
| `AUTH_GOOGLE_SECRET`     | Convex dashboard env vars                    | Google sign-in     | OAuth client secret                                                                           |
| `E2E_TEST`               | Convex env (`npx convex env set E2E_TEST 1`) | E2E tests          | Enables password auth, short guest lifetimes, and a fake word oracle. Never set in production |
| `E2E_PASSWORD`           | `.env.local`                                 | E2E tests          | Password for the generated test accounts                                                      |
| `CONVEX_DEPLOY_KEY`      | Vercel / GitHub secrets                      | Production deploys | See [development guide](docs/development.md#deployment)                                       |

See [`.env.example`](.env.example) for the full list.

## Scripts

| Command                | What it does                                 |
| ---------------------- | -------------------------------------------- |
| `bun run dev`          | Convex + Next.js dev servers                 |
| `bun run test`         | Unit and Convex tests (Vitest) with coverage |
| `bun run test:watch`   | Vitest in watch mode                         |
| `bun run test:e2e`     | Playwright end-to-end tests                  |
| `bun run test:e2e:ui`  | Playwright UI mode                           |
| `bun run lint`         | ESLint                                       |
| `bun run typecheck`    | Next.js route types + `tsc --noEmit`         |
| `bun run format:check` | Prettier check                               |
| `bun run build`        | Production build                             |

## Tech stack

[Next.js](https://nextjs.org) (App Router) · [Convex](https://convex.dev) for the database, server functions, and realtime sync · [Convex Auth](https://labs.convex.dev/auth) (anonymous + Google) · [`@convex-dev/presence`](https://www.convex.dev/components/presence) · [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) · [Sentry](https://sentry.io) · Vitest + [`convex-test`](https://docs.convex.dev/testing/convex-test) · Playwright

## Documentation

- [Architecture](docs/architecture.md): data model, guess pipeline, rooms, auth, and background jobs
- [Development](docs/development.md): testing, CI, deployment, and contributing

## Contributing

Bug reports and ideas go in [GitHub Issues](https://github.com/chrisgocode/contextus/issues). For code changes:

- Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org). A Husky hook enforces this.
- The pre-commit hook runs lint and a Prettier check. CI also runs typecheck and tests.
- Changes to Convex functions should come with tests. See [Testing](docs/development.md#testing).

More detail is in the [development guide](docs/development.md#contributing).

## Acknowledgements

Contextus is a fan project and is not affiliated with Contexto. Puzzles, word rankings, and answers come from the public [Contexto](https://contexto.me) API.
