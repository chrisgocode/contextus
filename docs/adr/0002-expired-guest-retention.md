# What an expired Guest leaves behind

A Guest who never signs in expires after `GUEST_LIFETIME_MS` (30 days). We anonymize the Guest instead of deleting them: the `users` row is kept but renamed "Former Guest", and its email, image, username, and guest counters are cleared. Their private rows are deleted: auth accounts and sessions, Room memberships, game history, achievements, achievement progress and stats, Solve days, and per-Game player stats.

Rows that belong to a shared Room are kept, still pointing at the anonymized user:

- **Guesses** (`gameGuesses`), so the other members' Games still show every Guess, attributed to "Former Guest".
- **Pending requests** (`pendingRequests`), as part of the same Game record.
- **Game winner** (`games.winnerUserId`), so a won Game still has a winner.
- **Hosted Rooms** (`rooms.hostUserId`). Room cleanup moves an offline Host's Room to an online member or ends it, so after 30 days the Room is almost always ended. An ended Room keeps the old Host id so group history still loads.

Every table that references `users` declares its merge, expire, and purge policy in `convex/lib/accountLifecycle.ts`. `convex/tests/accountLifecycle.test.ts` fails if a schema field referencing `users` has no policy.

## Consequences

Kept rows hold no personal data other than the words the Guest typed. A future "delete my account" feature cannot reuse the expire policy unchanged: a registered user who asks to be deleted may expect their Guesses to go too.
