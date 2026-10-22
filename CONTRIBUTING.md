# Contributing to Cuttle

Thank you for helping. Bug reports, ideas, fixes, templates for motion and music, and better words
are all welcome. Taking part means following the [Code of Conduct](CODE_OF_CONDUCT.md); a security
flaw goes privately through the [security policy](SECURITY.md), never into an issue.

## Report a bug or ask for something

Open an [issue](https://github.com/lennystepn-hue/cuttle-ai-screen-recorder/issues/new/choose) with
its template. For a bug, say the Cuttle version (Settings > General, or `cuttle --version`), the
system and what you did. **Leave private data out:** a recording, a still or a `cuttle.json` can show
names, keys or messages. Cut what you attach down to what shows the problem, or make a take of a
test screen.

## Set up

The README's [From this repository](README.md#from-this-repository) lists what each platform needs
(Node 22, pnpm 11, ffmpeg, and on a Mac the permissions). Then:

```bash
git clone https://github.com/lennystepn-hue/cuttle-ai-screen-recorder.git
cd cuttle-ai-screen-recorder
pnpm install
pnpm app          # the app from the checkout
pnpm cli:install  # the cuttle command, built from the checkout
```

[How it is built](README.md#how-it-is-built) says which package does what.

## Make a change

1. Fork the repository and make a branch from `main`.
2. Keep a pull request to one change. A larger one (a new feature, a new dependency, a change to
   `cuttle.json`'s schema) is easier as an issue first, so we can agree on the way.
3. Write code that reads like the code around it: its naming, its comments (whole sentences that
   say why), its words for people (plain and specific, both platforms named: `winget install
   Gyan.FFmpeg` and `brew install ffmpeg`, Windows' Settings and macOS's System Settings).
4. A change to what people see comes with screenshots, before and after.
5. A change to `cuttle.json` or the CLI updates the skill's references (`skill/cuttle/`) in the same
   pull request, so Claude knows it too.

## Windows and macOS

Cuttle runs on both, and a change made on one has to keep working on the other.
[CLAUDE.md](CLAUDE.md) has the rules: where platform code lives, desktop pixels, keys (every Ctrl
shortcut also takes ⌘), input, files and paths, whisper, the screen's text, icons. Please read it
before touching the recorder or the app's windows.

## Checks

On every platform:

```bash
pnpm typecheck
pnpm test
```

On the machine itself, for what you changed:

| Changed | Run |
|---|---|
| The app (`apps/desktop`) | `pnpm app:check` |
| The CLI or the export | `pnpm cli:check` |
| The recorder (`packages/recorder`) | `pnpm recorder:real` (records for real: allow the permissions on a Mac) |
| The packaging | `pnpm app:build` |
| The icons | `pnpm icons` (one generator for both platforms; never edit one platform's files) |

The engine's golden images are kept per platform (`*.win32.png`, `*.darwin.png`). CI runs the
typecheck and the tests on `windows-latest` and `macos-latest` for every pull request, but not a
real capture: if you changed the other platform's code and could not run it there, say so in the
pull request.

## Pull requests

The template asks what changed, why, and what you ran on which system. A maintainer reviews it;
small follow-ups may be pushed to your branch. Pull requests are squashed into one commit on `main`.

## Working with Claude Code

Cuttle is made with Claude Code, and you are welcome to use it too. `CLAUDE.md` is written for it;
keep it up to date when a platform rule changes. You are responsible for what you submit, whoever
wrote it: read the diff, and run the checks.

## Releases

Releases are made by the maintainer: the README's [Releases](README.md#releases) section has the
steps.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE),
as Cuttle is.
