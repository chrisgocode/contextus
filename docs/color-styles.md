# UI color styles

Six dark palettes are available from **Appearance → Color style** in the home,
room, and profile headers. Classic preserves the original black/red defaults.
Preview cards show the background, surface, and primary action color. Native
radio controls support keyboard selection and expose the selected option to
assistive technology.

Appearance belongs alongside personal navigation, separate from room setup and
host actions: guests and members can both change it, and the choice affects only
their browser. The room header gives it its own row to avoid crowding phone-sized
host controls. Existing typography and game-result/error colors stay intact.

## Project comparisons

- [T3 Code’s theme-system discussion](https://github.com/pingdotgg/t3code/discussions/6973)
  describes six built-in themes, preview cards under Settings → Appearance,
  and browser-local persistence. We adopt the preset-card and immediate-selection
  pattern, without a theme editor or import/export.
- [Slack’s theme documentation](https://slack.com/help/articles/205166337-Change-your-Slack-theme)
  puts themes in personal Preferences and distinguishes them from shared workspace
  changes. Slack syncs across devices; this implementation explicitly labels the
  choice as saved in this browser.

## Behavior and validation

The root document restores a validated preset before rendering page content.
CSS variables recolor existing components without new dependencies or backend
changes. A failed storage write still applies the choice for the current page and
shows that it could not be saved. Clearing site data restores Classic.

Playwright coverage in `e2e/appearance.guest.spec.ts` checks all six options,
visible page/button colors, navigation, reloads, keyboard selection, resetting to
Classic, and storage-write failure. Both desktop and Pixel 7 runs passed (four
tests). Typecheck, lint, and changed-file formatting passed.

## Screenshots and demo

Captured from the running app at 1280×800 and 390×844. The video cycles through
presets, reloads to demonstrate persistence, and restores Classic.

- [Classic](https://utfs.io/f/QXdPbNz3CXbY5V14Wsn2NmAZUE7arkTFClp6KW5wOctiPGen)
- [Midnight](https://utfs.io/f/QXdPbNz3CXbY3qbSAGBWeEtINV0v4grAwi52upPQkLYza7cl)
- [Forest](https://utfs.io/f/QXdPbNz3CXbYPBaJBTFV0o6lbKNxuEynIpcAkjRFt32f4imG)
- [Plum](https://utfs.io/f/QXdPbNz3CXbYdYOG6VXMNBrEz5RXiPucA7fHLjDYaG4l83os)
- [Espresso](https://utfs.io/f/QXdPbNz3CXbYZ4bTCAETu4HNcpbrWLfCSUFJhAqVK0ioaXy3)
- [Slate](https://utfs.io/f/QXdPbNz3CXbY3JknJtVBWeEtINV0v4grAwi52upPQkLYza7c)
- [Mobile](https://utfs.io/f/QXdPbNz3CXbYjtlOV2aIRNC92BoOmpY1lena8S4u65jQPk7x)
- [Color Styles](https://utfs.io/f/QXdPbNz3CXbY7huliXdPxpnIZCBEzmjXAhg9TKQ5kVNbFL0r)
