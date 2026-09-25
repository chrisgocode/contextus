# Contextus

Multiplayer rooms that play [Contexto](https://contexto.me) together.

## Glossary

- **Room**: a group of members with one **Host**. Plays one Game at a time.
- **Host**: the room member who can give hints, give up, and approve or deny Pending requests.
- **Game**: one round in a Room against one Contexto puzzle (`contextoGameId`). It is `in_progress`, `won`, or `given_up`.
- **Guess**: a lemma and its distance recorded in a Game. Its `source` is `guess` (a member typed it) or `hint` (the Host revealed it).
- **Pending request**: a non-Host member asking the Host for a hint or a give-up. The Host approves or denies it.
- **Game turn**: any change to a Game's state: a Guess, a Host hint, a Host give-up, or approving a Pending request. All of them go through `performTurn` in `convex/turns.ts`. The turn kind decides who may perform it: any member for a Guess, the Host for everything else. The `_apply` mutation checks this again, together with the Pending request, in the same transaction that changes the Game.
- **Word oracle**: answers questions about a Contexto puzzle: the distance for a word, a tip at a distance, and the answer. `convex/contexto.ts` is the production adapter. `convex/wordOracle.ts` puts the `wordDistances` cache in front of it. Tests fake it with `fakeWordOracle`.
- **Lemma**: Contexto's canonical form of a word (`"dogs"` → `"dog"`). Guesses are recorded and deduplicated by lemma.
- **Solve day**: a calendar day, in the player's own time zone (`users.timeZone`, UTC if unknown), on which the player was credited with a solve. Every active guesser in a won Game is credited. Streak achievements count consecutive Solve days. See `docs/adr/0001-player-local-time-for-achievements.md`.
