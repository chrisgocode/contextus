# Player local time for achievements

Streak, Night Owl, and Early Bird achievements are judged in the player's own time zone, not UTC. Each client reports its IANA time zone through `users.setTimeZone`, and the server stores it on `users.timeZone`. It has to be stored rather than sent with each guess, because teammates are credited with a solve when someone else submits the winning guess.

- **Day boundaries** come from `Intl.DateTimeFormat` with the stored zone (`convex/lib/localTime.ts`), so DST is handled. Unknown zones are rejected when stored, and users without a zone fall back to UTC.
- **Puzzle release** is the player's local midnight on the puzzle's date. This matches contexto.me, which picks today's puzzle from the browser's local date. Early Bird only counts today's puzzle.
- **Streaks** are derived from `userSolveDays` (one row per user per local day) rather than a running counter. A guest's and an account's days can interleave, so guest merge unions the days and recomputes the longest run.

## Consequences

The time zone is client-reported and can be spoofed. We accept this because these achievements are cosmetic. A player who travels or changes zones may gain or lose a day at the boundary. Solves from before this change have no Solve days, so streaks start fresh.
