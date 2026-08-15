# Contextus

Co-op multiplayer [Contexto](https://contexto.me) using the public Contexto API. Guests can create or join up to three active rooms without an account, then convert with Google to keep their progress. Built with Next.js, Convex, Convex Auth, and shadcn.

## Run locally

```bash
bun install
bun run dev
```

`bun run dev` starts both `convex dev` and `next dev`. First run will prompt you to log into Convex and provision a deployment.

Google OAuth credentials are required for sign-in. Add to your Convex dashboard env vars:

- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`

And to `.env.local`:

- `NEXT_PUBLIC_CONVEX_URL` (auto-populated by `convex dev`)

## Tests

```bash
bun run test          # one shot
bun run test:watch    # interactive
```

Tests use `convex-test` + `vitest` + `@edge-runtime/vm`. The Contexto API is mocked via `mockContextoFetch` (see `tests/helpers.ts`).

## Architecture

- `convex/schema.ts` — tables: `rooms`, `roomMembers`, `games`, `gameGuesses`, `wordDistances` (global cache), `pendingRequests`, `userGameHistory`
- `convex/contexto.ts` — internal actions wrapping `https://api.contexto.me/machado/en/{game,tip,giveup}/...`
- `convex/guesses.ts` `submit` — cache lookup → external API → record (deduped by lemma per game) → win detection
- `convex/hints.ts` — request/approve flow; algorithm in `lib/hint.ts`
- `convex/giveup.ts` — request/approve flow
- `convex/presence.ts` — wraps `@convex-dev/presence`; UI uses `usePresence` hook
- `convex/cleanup.ts` + `convex/crons.ts` — migrate offline hosts, end idle rooms, and anonymize expired guest accounts
- `app/r/[code]/page.tsx` — state machine: lobby → in-progress → ended

## Deploy

Vercel-ready. Add `NEXT_PUBLIC_CONVEX_URL` to Vercel env, then push.
