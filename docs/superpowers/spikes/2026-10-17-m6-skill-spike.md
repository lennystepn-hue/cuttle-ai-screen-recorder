# M6 spike: the Claude skill

Date: 2026-10-17. Machine as in the M4 and M5 spikes. Prototype in a clone of `main` at 885c719
(`scratchpad/m6`; nothing committed, nothing pushed).

**Status: the prototype meets the M6 done criterion as far as it can be checked here.** `pnpm
skill:install` writes `<Claude config>/skills/cuttle/SKILL.md` (and `project.md`); the workflow the
skill describes was walked through command by command with the `test` backend (section 4). Whether
a fresh Claude Code session follows it end to end needs the user: Claude must not start Claude Code
itself.

## 1. The skill format (Claude Code docs, 2026-10)

Sources: code.claude.com/docs/en/skills, /claude-directory, the Agent Skills specification,
platform.claude.com's skill best practices.
- Personal skills live in `~/.claude/skills/<name>/SKILL.md`; `CLAUDE_CONFIG_DIR` moves every
  `~/.claude` path, so they are in `$CLAUDE_CONFIG_DIR/skills/<name>/`.
- Frontmatter: `name` (defaults to the folder; the spec asks for lowercase letters, digits and
  hyphens, matching the folder) and `description` (what decides automatic loading, with the
  optional `when_to_use`; the spec allows 1024 characters, Claude Code's listing cuts `description`
  plus `when_to_use` at 1536). Many optional fields exist (`allowed-tools`,
  `disable-model-invocation`, `argument-hint`, …); none is needed here.
- Supporting files are not loaded automatically: SKILL.md links them (relative paths, one level
  deep) and says when to read them. `${CLAUDE_SKILL_DIR}` is substituted in SKILL.md's text.
- Keep SKILL.md under 500 lines; write the description in the third person, what it does first,
  then when to use it.
- A personal skill is also a slash command (`/cuttle`). Changes under an existing `skills/` folder
  apply without a restart; a `skills/` folder created after a session started needs
  `/reload-skills`.

## 2. Where masks go: a numbered pixel grid

Masks and zooms are rects in source pixels, but Claude sees output stills (framed, scaled) and,
when it reads a PNG, a scaled-down picture. A source frame with a grid fixes both: ffmpeg's
`drawgrid` (every 100 px, stronger every 500 px) plus one `drawtext` per line with its pixel number.
drawtext needs a font file on Windows (lesson from the treg demo); the engine's Inter ships only as
woff2, so the grid uses a system font (Arial on Windows and macOS, DejaVu Sans on Linux) and falls
back to lines only. On the treg take (2560×1440) one frame with 40 labels took 0.26 s, and the
hook error the original demo had to mask could be read off as about `[0, 0, 700, 60]`.

The size and length come from a pass that copies the packets (0.12 s for the 153 s treg take);
`suggest`'s freezedetect pass would decode the whole take.

`preview` already knows each still's output second; the source second follows from the scenes
(`spanAt` + `sourceTimeAt` from `@cuttle/timeline`), so its JSON names it per still.

## 3. A flaky recorder test

With M6's extra tests the full suite failed twice in five runs, both times on `stops once the
screen stood still and the input rested for untilIdleSeconds` (once seen: `expected 2.1 to be
greater than 2.2`). The input's
rest is timed from `record()`, the take's length from the screen's first frame; on a loaded machine
the screen's ffmpeg starts later, so the rest begins earlier in screen seconds. The rule itself is
1 s of movement plus 1 s of rest: at least 2 s. The bounds become 1.95–5 s.

## 4. The workflow, walked through

With the built CLI and the `test` backend, following SKILL.md: `cuttle --version`; `record` in the
background without `--json`, the output polled until `recording takes/1`, stopped by creating the
`--until-file` (6.7 s take); `suggest --json`; `preview --json` (stills with `source`); `frame 3
--grid` (1280×720 with numbers); a mask `[0, 0, 110, 45]` over the test pattern's timecode, a frame
title and an end card edited into cuttle.json; `preview --at 3` showed the mask; `render --format
16:9` wrote 262 frames, 8.73 s.
