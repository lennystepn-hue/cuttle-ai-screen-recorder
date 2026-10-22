## What and why

<!-- What this changes, and why. Link the issue it closes: "Closes #123". -->

## How it was checked

<!-- Tick what you ran, and say on which system. CI runs the typecheck and the tests on Windows and
     macOS, but no real capture: say so when you changed the other platform's code without running it. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm app:check` (a change to the app), on: <!-- macOS / Windows -->
- [ ] `pnpm cli:check` or `pnpm recorder:real` (a change to the CLI, the export or the recorder), on: <!-- macOS / Windows -->
- [ ] Screenshots before and after (a change people see)

## Windows and macOS

<!-- Does it keep working on both (CLAUDE.md has the rules)? What could not be run on the other one? -->

## Also

- [ ] The skill's references (`skill/cuttle/`) say what changed in `cuttle.json` or the CLI
- [ ] Nothing private in what is attached (recordings, stills, `cuttle.json`)
