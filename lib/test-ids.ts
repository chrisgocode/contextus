// Every `data-testid` in the app, shared by components and e2e specs so that
// removing or renaming one fails the type check. Ids are for structural
// containers and repeated rows only; interactive and announced elements are
// found by role or label. Repeated rows are keyed on a stable domain value,
// never an array index. See "End-to-end tests" in docs/development.md.
//
// Keep this module free of imports: Playwright loads it directly.
export const testIds = {
  // The list of all guesses in a Game, closest first.
  guessList: "guess-list",
  // One Guess row in the list of all guesses, keyed by its Lemma. Only that
  // list sets it, so it is unique on the page.
  guessRow: (lemma: string) => `guess-row-${lemma}`,
  // The Room's member list in the sidebar.
  roomMembers: "room-members",
  // Home's content, made inert while a Room is opening.
  homeContent: "home-content",
} as const;
