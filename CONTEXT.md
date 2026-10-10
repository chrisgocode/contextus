# Contextus

Multiplayer rooms that play [Contexto](https://contexto.me) together.

## Glossary

- **Guest**: an anonymous user (`users.isAnonymous`). When a Guest signs in, their rows are merged into the account. A Guest who never signs in expires after 30 days and is anonymized to "Former Guest". What happens to each table is declared in `convex/lib/accountLifecycle.ts`. See `docs/adr/0002-expired-guest-retention.md`.
- **Room**: a group of members with one **Host**. Plays one Game at a time.
- **Live membership**: a membership that is not marked inactive, in a Room that is active. Ending a Room marks every membership inactive, and reopening it with play again restores them. Only a live member can take a Game turn or make a Pending request, which freezes the unfinished Game an ended Room keeps. Other members of an ended Room can still read it. `convex/lib/roomMembership.ts` owns memberships, the Host, and Room status and activity.
- **Host**: the room member who can give hints, give up, and approve or deny Pending requests. The Host is always a live member, or the Room is ended. When the Host leaves, expires as a Guest, or is offline while another member is online, the longest-standing live member who is online becomes Host. If nobody is online, a Host who is still a member stays, and otherwise the longest-standing live member takes over. The Room ends if nobody is left, or if nobody has been online for 30 minutes without activity. A Guest Host who signs in stays Host as their account.
- **Game**: one round in a Room against one Contexto puzzle (`contextoGameId`). It is `in_progress`, `won`, or `given_up`.
- **Guess**: a lemma and its distance recorded in a Game. Its `source` is `guess` (a member typed it) or `hint` (the Host revealed it).
- **Pending request**: a non-Host member asking the Host for a hint or a give-up. A Game has at most one pending request of each type, whoever asked. The Host approves or denies it, the requester takes it back (which deletes it), or it expires unanswered after a minute. An approved hint request keeps the Hint it produced so the requester sees it land.
- **Game turn**: any change to a Game's state: a Guess, a Host hint, a Host give-up, or approving a Pending request. All of them go through `performTurn` in `convex/turns.ts`. The turn kind decides who may perform it: any member for a Guess, the Host for everything else. The `_apply` mutation checks this again, together with the Pending request, in the same transaction that changes the Game.
- **Word oracle**: answers questions about a Contexto puzzle: the distance for a word, a tip at a distance, and the answer. `convex/contexto.ts` is the production adapter. `convex/wordOracle.ts` puts the `wordDistances` cache in front of it. Tests fake it with `fakeWordOracle`.
- **Lemma**: Contexto's canonical form of a word (`"dogs"` → `"dog"`). Guesses are recorded and deduplicated by lemma.
- **Solve day**: a calendar day, in the player's own time zone (`users.timeZone`, UTC if unknown), on which the player was credited with a solve. Every active guesser in a won Game is credited. Streak achievements count consecutive Solve days. See `docs/adr/0001-player-local-time-for-achievements.md`.
