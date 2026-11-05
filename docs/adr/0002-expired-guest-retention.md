# What an expired Guest leaves behind

A Guest who never signs in expires after `GUEST_LIFETIME_MS` (30 days). We anonymize the Guest instead of deleting them: the `users` row is kept but renamed "Former Guest", and its email, image, username, and guest counters are cleared. Their private rows are deleted: auth accounts and sessions, Room memberships, game history, achievements, achievement progress and stats, Solve days, and per-Game player stats.

Rows that belong to a shared Room are kept, still pointing at the anonymized user:

- **Guesses** (`gameGuesses`), so the other members' Games still show every Guess, attributed to "Former Guest".
- **Pending requests** (`pendingRequests`), as part of the same Game record. A request that is still pending is withdrawn instead, as when any member leaves a Room.
- **Game winner** (`games.winnerUserId`), so a won Game still has a winner.
- **Hosted Rooms** (`rooms.hostUserId`). Deleting the Guest's membership hands a Room they hosted to another member, or ends it when nobody else is in it. An ended Room keeps the old Host id so group history still loads.

Every table that references `users` declares its merge, expire, and purge policy in `convex/lib/accountLifecycle.ts`. `convex/tests/accountLifecycle.test.ts` fails if a schema field referencing `users` has no policy.

## Consequences

Kept rows hold no personal data other than the words the Guest typed. A future "delete my account" feature cannot reuse the expire policy unchanged: a registered user who asks to be deleted may expect their Guesses to go too.

## Guest lifecycle ownership

`convex/lib/guestLifecycle.ts` derives ownership from the existing user fields
and `guestMerges` job. An active Guest becomes expired when its expiry passes.
Either may start merging while its auth session is live; starting merge postpones
expiry by the existing Guest lifetime. The persisted job owns that Guest until
completion, including if the worker is interrupted beyond that postponed expiry.
Cleanup claims an expired Guest by setting `guestCleanupStarted` in the first
cleanup transaction. Cleaning cannot transition to merging. Cleaning finishes by
anonymizing the user; merging finishes by deleting the Guest and job together.
Anonymized users are outside the Guest lifecycle, like registered users: there is
no new persisted state or name-based tombstone detection.

Table phases drain their Guest index in bounded batches: full batches repeat,
short batches advance. The streak phase resumes after its last scanned Solve day.
Finalization re-sweeps table phases for stale Guest writes before removing auth
rows in bounded batches and committing totals and deletion. Cleanup similarly
resumes from the remaining indexed rows, retaining its ownership mark between
batches. Its sweep advances past merge-owned Guests with a cursor; a partial page
is retried before advancing. Room cleanup keeps its existing boundary: each page
of active Room ids schedules the next cursor, while each Room's idle decision
reads and writes current membership and activity in its own transaction.
