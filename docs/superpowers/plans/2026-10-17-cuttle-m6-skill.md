# Cuttle M6: Claude Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude skill (`skill/cuttle/SKILL.md` with a `cuttle.json` reference) that lets Claude Code record a demo with the user, cut it with `cuttle suggest`, hide private data, polish the look and render it, installed by `pnpm skill:install`. Two CLI additions the workflow needs: `cuttle frame <source second> --grid` (a source frame with a numbered pixel grid, to read the rects of masks and zooms) and the source second of each still in `cuttle preview --json`.

**Architecture:** `skill/` becomes a workspace package (`@cuttle/skill`) holding the skill's Markdown, its installer and its tests. The tests keep the skill honest: every `cuttle` command and option it shows must exist in the CLI's own help, the reference's example must be a valid project, and every value the schema accepts must be listed. The installer copies the Markdown into Claude Code's personal skills folder with the repository's path filled in, and never touches a `cuttle` skill it did not write.

**Tech Stack:** TypeScript 5, Node 22, commander 15 (the CLI's help as the source of truth), ffmpeg 9 (`drawgrid`, `drawtext`), vitest 5.

Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md` (section "Skill"). Roadmap: `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`. M5 (done): `2026-10-17-cuttle-m5-cli.md`. Spike notes: `docs/superpowers/spikes/2026-10-17-m6-skill-spike.md` (written against the prototype; where they differ, this plan wins).

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `m6-skill`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- The CLI tests need ffmpeg and ffprobe on PATH. The task steps run only the tests they touch; the full `pnpm test` runs in Task 5.
- Tests delete the temp folders they create. Nothing here writes into the real `~/.claude`: the installer's tests and Task 5 use a temp `CLAUDE_CONFIG_DIR`.

## Decisions made while planning

A spike and a full prototype (the machine of the M4 and M5 spikes) settled these points. Every code block below ran: the plan was replayed mechanically, twice, on fresh clones of `main` (885c719), applying every file block and edit from this text and running every command, 4 commits; the result is byte-identical to the prototype. `pnpm test` passes 364 tests in 41 files and skips 5 (the real-capture test and the Electron checks), twice in a row, `pnpm typecheck` is clean, `pnpm cli:check` passes its 4 checks, `pnpm skill:install` and `skill:uninstall` work in a temp `CLAUDE_CONFIG_DIR`, and the workflow was walked through with the `test` backend (Task 5).

- **The skill format** (Claude Code's docs, October 2026): personal skills live in `~/.claude/skills/<name>/SKILL.md`, and `CLAUDE_CONFIG_DIR` moves them with every other `~/.claude` path. The frontmatter has `name` (lowercase, matching the folder) and `description`, which decides when Claude loads the skill (the Agent Skills spec allows 1024 characters). Supporting files are not loaded automatically: SKILL.md links them and says when to read them. SKILL.md stays under 500 lines. The description is in the third person, says what the skill does first and then when to use it. A personal skill is also the slash command `/cuttle`. A `skills/` folder created while a session runs needs `/reload-skills` there.
- **Two files.** `SKILL.md` holds the workflow: check the tools, agree the plan, record, edit, render, and what to do when something fails. It carries the treg lessons from the spec. `project.md` is the reference SKILL.md links before any edit of `cuttle.json`: times and pixels, a complete example, every field with its values and defaults, and how to find source seconds and rects.
- **What the workflow asks of Claude.**
  - `--json` for every command except `record`, with an absolute `-C "<project>"`.
  - `record` runs in the background (Bash `run_in_background`), without `--json`, so its status lines show. Claude waits for `recording takes/<n>` before telling the user to start.
  - The stop is `--until-claude "<demo folder>"` for agent demos, or `--until-file` (Claude creates the file when the user says they are done), always with `--max`.
  - Claude never starts Claude Code and never changes its settings. The user starts it in the demo folder, with `--setting-sources "project,local" --strict-mcp-config` suggested.
  - The edit loop is `suggest`, then `preview` (look at the sheet), privacy, story, focus, look, pages, and `preview` again.
  - `render` runs in the background for long takes. The file stays local; nothing is uploaded.
- **Masks need source pixels and source seconds.** Claude sees output stills (framed and scaled) and, when it reads a PNG, a scaled-down picture.
  - `cuttle preview --json` names, for each still, the `source` second it shows (`spanAt` and `sourceTimeAt` from `@cuttle/timeline`; none on a still or card scene).
  - `cuttle frame <source second> [--grid] [-o file]` writes that frame of the screen track at full size, by default as `frames/<t>s.png` or `frames/<t>s-grid.png`.
  - With `--grid`, ffmpeg draws a line every 100 px (stronger every 500 px) and the pixel number of each line (`drawtext`). drawtext needs a font file, and the engine's Inter ships only as woff2, so the numbers use a system font: Arial on Windows and macOS, DejaVu Sans on Linux. Without one, the grid has lines only, with a warning.
  - The frame's size and the track's length come from a copy pass (0.12 s for the 153 s treg take). Times past the end are refused.
- **`skill/` is a workspace package** (`@cuttle/skill`, private) so its tests can import `runCli` from `@cuttle/cli` (which gains `exports: { ".": "./src/main.ts" }`) and the schema's value lists from `@cuttle/project`. `pnpm typecheck` covers `skill/tsconfig.json`, and `pnpm test` runs `skill/test`.
- **The tests read the skill as Claude will.**
  - The frontmatter: exactly `name` and `description`, the name `cuttle`, a description of 200–1024 characters that starts with what the skill does.
  - Links point to files that exist, and SKILL.md has fewer than 500 lines.
  - Every `cuttle … <command> --option` in code blocks and inline code is checked against the CLI's own `--help` output. The program's `--json`, `--project`, `--help` and `--version` are allowed anywhere. The commands must cover the workflow.
  - `project.md`'s example parses as a project, and every value of the schema's lists (backgrounds, frames, cursors, click effects, webcam shapes and corners, still motions, eases, mask and text styles, positions) appears in it.
- **The installer** (`node skill/install.mjs`, scripts `skill:install` and `skill:uninstall`):
  - It copies `skill/cuttle/*.md` to `<CLAUDE_CONFIG_DIR or ~/.claude>/skills/cuttle/` and replaces `{{REPO}}` in them with this repository's path (forward slashes), so the skill can say where to run `pnpm cli:install`.
  - A file `.cuttle-skill.json` (the repo and the files written) marks the folder as ours. Without it, a `cuttle` skill belongs to someone else: install refuses (exit 1) and uninstall leaves it alone.
  - Reinstalling replaces our files. Uninstalling removes them and the folder when it is empty.
  - The real install into `~/.claude` is the user's to run.
- **A flaky recorder test.** With the larger suite, `stops once the screen stood still and the input rested for untilIdleSeconds` failed twice in five runs (once seen: `expected 2.1 to be greater than 2.2`). The input's rest is timed from `record()`, the take's length from the screen's first frame, and a screen that starts late on a loaded machine shifts the rest earlier in its seconds. The rule is 1 s of movement plus 1 s of rest, so the bounds become 1.95–5 s.
- **The done criterion.** `pnpm skill:install` writes the skill (checked into a temp `CLAUDE_CONFIG_DIR`). The workflow was walked through command by command with the `test` backend (Task 5). Whether a fresh Claude Code session follows it end to end needs the user, because Claude must not start Claude Code.

## File structure

```
cuttle/
├── package.json                  typecheck covers skill/; scripts skill:install, skill:uninstall
├── pnpm-workspace.yaml           + skill
├── vitest.config.ts              the node project also runs skill/test
├── README.md, docs/…             the skill and cuttle frame in the README, roadmap and spec
├── packages/recorder/test/record.test.ts   the idle test's bounds
├── apps/cli/
│   ├── package.json              exports src/main.ts (runCli) for the skill's tests
│   ├── src/commands/frame.ts     cuttle frame (new)
│   ├── src/commands/preview.ts   the source second of each still
│   ├── src/suggest/media.ts      probeScreen: size and length from a copy pass
│   ├── src/main.ts               the frame command
│   └── test/cli.test.ts, test/electron.check.test.ts
└── skill/
    ├── package.json, tsconfig.json   @cuttle/skill
    ├── cuttle/SKILL.md           the workflow
    ├── cuttle/project.md         the cuttle.json reference
    ├── install.mjs               into <Claude config>/skills/cuttle/
    └── test/skill.test.ts        the skill against the CLI and the schema; the installer
```

---

### Task 1: The idle test on a loaded machine

**Files:**
- Modify: `packages/recorder/test/record.test.ts`

- [ ] **Step 1: Widen the bounds to the rule**

The plan was committed on the branch `m6-skill`; work there:

```bash
git switch m6-skill
```

In `packages/recorder/test/record.test.ts`, replace:

```ts
    expect(take.stopReason).toBe('idle');
    expect(take.seconds).toBeGreaterThan(2.2);
    expect(take.seconds).toBeLessThan(3.5);
```

with:

```ts
    expect(take.stopReason).toBe('idle');
    // At least 1 s of movement and 1 s of rest. The input is timed from record(), the screen from its
    // first frame: on a loaded machine the screen starts later, so the rest begins earlier in its seconds.
    expect(take.seconds).toBeGreaterThan(1.95);
    expect(take.seconds).toBeLessThan(5);
```

- [ ] **Step 2: Run the recorder's record tests**

Run: `pnpm exec vitest run packages/recorder/test/record.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/recorder/test/record.test.ts
git commit -m "recorder: the idle test allows a screen that starts late on a loaded machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `cuttle frame` and the source second of each still

**Files:**
- Create: `apps/cli/src/commands/frame.ts`
- Modify: `apps/cli/src/suggest/media.ts`, `apps/cli/src/main.ts`, `apps/cli/src/commands/preview.ts`
- Test: `apps/cli/test/cli.test.ts`, `apps/cli/test/electron.check.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/cli/test/cli.test.ts` (the new describe block is at the end):

```ts
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scene } from '@cuttle/project';
import { sourceSecond } from '../src/commands/preview';
import { VERSION, runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-cli-'));
  dirs.push(dir);
  return dir;
};

/** Runs the CLI in-process; `json` is stdout parsed when it is JSON. */
async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text) });
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { code, stdout, stderr, json };
}

/** The project folder's path in a result as `<project>`, with forward slashes, so a snapshot holds on every platform. */
const stable = (value: unknown, dir: string) =>
  JSON.parse(JSON.stringify(value).split(JSON.stringify(dir).slice(1, -1)).join('<project>').replaceAll('\\\\', '/'));

describe('cuttle init and errors', () => {
  it('creates a project and refuses to overwrite one', async () => {
    const dir = join(temp(), 'demo');
    const first = await cli('--json', 'init', dir);
    expect(first.code).toBe(0);
    expect(stable(first.json, dir)).toMatchInlineSnapshot(`
      {
        "project": "<project>/cuttle.json",
      }
    `);
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'))).toEqual({ version: 1, sources: { screen: 'takes/1/screen.mp4' } });
    const again = await cli('--json', 'init', dir);
    expect(again.code).toBe(1);
    expect(stable(again.json, dir)).toMatchInlineSnapshot(`
      {
        "error": {
          "code": "usage",
          "message": "<project> already has a cuttle.json",
        },
      }
    `);
  });

  it('maps usage and project errors to exit code 1, with one JSON error on stdout', async () => {
    const dir = temp();
    expect((await cli('nonsense')).code).toBe(1);
    // commander's own usage errors (explained on stderr) still give one JSON document with --json
    for (const argv of [['--json', 'nonsense'], ['--json', 'record', '--monitor', 'x'], ['recover', '--json'], ['--json']]) {
      const usage = await cli(...argv);
      expect(usage.code, argv.join(' ')).toBe(1);
      expect((usage.json as { error: { code: string } }).error.code, argv.join(' ')).toBe('usage');
    }
    expect((await cli('--json')).json).toEqual({ error: { code: 'usage', message: 'no command given ("cuttle --help" lists them)' } });
    // --version and --help answer in JSON too
    expect((await cli('--json', '--version')).json).toEqual({ version: VERSION });
    const help = await cli('--json', 'render', '--help');
    expect(help.code).toBe(0);
    expect((help.json as { help: string }).help).toMatch(/^Usage: cuttle render/);
    const missing = await cli('--json', '-C', dir, 'suggest');
    expect(missing.code).toBe(1);
    expect((missing.json as { error: { code: string } }).error.code).toBe('invalid-project');
    await cli('init', join(dir, 'p'));
    const noScenes = await cli('--json', '-C', join(dir, 'p'), 'preview');
    expect(noScenes.code).toBe(1);
    expect((noScenes.json as { error: { message: string } }).error.message).toMatch(/has no scenes yet/);
    const region = await cli('--json', '-C', join(dir, 'p'), 'record', '--backend', 'test', '--region', '1,2');
    expect(region.code).toBe(1);
    expect((region.json as { error: { message: string } }).error.message).toMatch(/--region needs x,y,w,h/);
  });
});

describe('cuttle devices and record (test backend)', () => {
  it('lists the test devices', async () => {
    const { code, json } = await cli('--json', 'devices', '--backend', 'test');
    expect(code).toBe(0);
    expect(json).toMatchInlineSnapshot(`
      {
        "cameras": [
          "Test Camera",
          "Failing Test Camera",
        ],
        "mics": [
          "Test Microphone",
          "Silent Test Microphone",
        ],
        "monitors": [
          {
            "bounds": {
              "height": 720,
              "width": 1280,
              "x": 0,
              "y": 0,
            },
            "index": 0,
            "name": "Test Monitor",
            "primary": true,
            "scale": 1,
          },
          {
            "bounds": {
              "height": 360,
              "width": 640,
              "x": 1280,
              "y": 0,
            },
            "index": 1,
            "name": "Still Test Monitor",
            "primary": false,
            "scale": 1,
          },
        ],
        "windows": [
          {
            "bounds": {
              "height": 360,
              "width": 640,
              "x": 100,
              "y": 60,
            },
            "monitor": 0,
            "title": "Test Window",
          },
        ],
      }
    `);
  });

  it('records a take into a new project and points the project at it', async () => {
    const dir = join(temp(), 'demo');
    const { code, json, stderr } = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--mic', '--max', '2', '--countdown', '0');
    expect(code).toBe(0);
    expect(stderr).toBe(''); // --json: no status lines
    const result = json as { project: string; take: { dir: string; seconds: number; stopReason: string; mic?: string } };
    expect(result.take).toMatchObject({ dir: 'takes/1', mic: 'takes/1/mic.m4a', stopReason: 'max-seconds' });
    const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    expect(project.sources).toEqual({
      screen: 'takes/1/screen.mp4',
      mic: 'takes/1/mic.m4a',
      events: 'takes/1/events.jsonl',
      markers: 'takes/1/markers.json',
    });
    expect(project.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.take.seconds * 1000) / 1000 }]);
  }, 20_000);

  it('takes a region split at its commas (as PowerShell passes it) and hides the drawn cursor with --draw-mouse', async () => {
    const dir = join(temp(), 'demo');
    const { code, json } = await cli('--json', '-C', dir, 'record', '--backend', 'test', '--region', '0', '0', '640', '360', '--draw-mouse', '--max', '1', '--countdown', '0');
    expect(code).toBe(0);
    expect((json as { take: { screenSize: unknown } }).take.screenSize).toEqual({ width: 640, height: 360 });
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).look).toEqual({ cursor: { enabled: false } });
  }, 20_000);

  it('stops the recording on Ctrl+C, keeps the take and removes its handlers', async () => {
    const dir = join(temp(), 'demo');
    const listeners = process.listenerCount('SIGBREAK');
    const running = cli('--json', '-C', dir, 'record', '--backend', 'test', '--max', '20', '--countdown', '0');
    // take.json appears once every track runs; SIGBREAK is Ctrl+Break, handled like Ctrl+C.
    while (!existsSync(join(dir, 'takes', '1', 'take.json'))) await new Promise((done) => setTimeout(done, 50));
    process.emit('SIGBREAK');
    const { code, json } = await running;
    expect(code).toBe(0);
    expect((json as { take: { stopReason: string; seconds: number } }).take).toMatchObject({ stopReason: 'stop' });
    expect((json as { take: { seconds: number } }).take.seconds).toBeLessThan(10);
    expect(process.listenerCount('SIGBREAK')).toBe(listeners);
  }, 30_000);
});

/**
 * A 20 s screen recording where only a white box moves, from 3 to 17 s; typing at 3.2–3.8 s, a
 * prompt marker at 3.8 s and Claude's answer at 16 s.
 */
function takeFixture(projectDir: string, take = 'takes/1'): void {
  const dir = join(projectDir, take);
  mkdirSync(dir, { recursive: true });
  const graph = "color=c=0x202020:s=1280x720:r=30:d=20[bg];color=c=white:s=80x80:r=30:d=20[box];[bg][box]overlay=x='100+mod(t*200,300)':y=500:enable='between(t,3,17)'[out0]";
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', graph, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', join(dir, 'screen.mp4')]);
  if (result.status !== 0) throw new Error(String(result.stderr));
  writeFileSync(join(dir, 'events.jsonl'), [3.2, 3.5, 3.8].map((t) => `${JSON.stringify({ t, type: 'keys', count: 1 })}\n`).join(''));
  writeFileSync(join(dir, 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 3.8, kind: 'prompt' }, { t: 16, kind: 'answer' }] }));
  writeFileSync(join(dir, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
  writeFileSync(
    join(projectDir, 'cuttle.json'),
    JSON.stringify({ version: 1, sources: { screen: `${take}/screen.mp4`, events: `${take}/events.jsonl`, markers: `${take}/markers.json` } }),
  );
}

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
    fixture = temp();
    takeFixture(fixture);
  });

  it('trims, speeds up the wait and zooms on the answer', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const { code, json } = await cli('--json', '-C', dir, 'suggest');
    expect(code).toBe(0);
    expect(stable(json, dir)).toMatchInlineSnapshot(`
      {
        "backup": "<project>/cuttle.json.bak",
        "markers": {
          "count": 2,
          "from": "take",
        },
        "notes": [
          "trimmed the quiet start (0.0–1.8 s)",
          "trimmed the quiet end (18.5–20.0 s)",
          "sped up 9.4 s without input 3× (5.1–14.5 s)",
          "zoom on Claude's answer at 15.5 s (145, 422, 448, 236)",
        ],
        "project": "<project>/cuttle.json",
        "scenes": [
          {
            "from": 1.8,
            "to": 5.1,
            "type": "clip",
          },
          {
            "from": 5.1,
            "speed": 3,
            "to": 14.5,
            "type": "clip",
          },
          {
            "from": 14.5,
            "to": 18.5,
            "type": "clip",
          },
        ],
        "written": true,
        "zooms": [
          {
            "at": 15.5,
            "duration": 3,
            "rect": [
              145,
              422,
              448,
              236,
            ],
          },
        ],
      }
    `);
    const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    expect(project.scenes).toEqual((json as { scenes: unknown }).scenes);
    expect(existsSync(join(dir, 'cuttle.json.bak'))).toBe(true);
  }, 30_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const before = readFileSync(join(dir, 'cuttle.json'), 'utf8');
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-zoom');
    expect(code).toBe(0);
    expect(json).toMatchObject({ written: false, zooms: [] });
    expect(readFileSync(join(dir, 'cuttle.json'), 'utf8')).toBe(before);
  }, 30_000);

  it('keeps still and card scenes, and older versions of cuttle.json as rotating backups', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const path = join(dir, 'cuttle.json');
    const original = readFileSync(path, 'utf8');
    const title = { type: 'card', title: 'A demo', duration: 2 };
    const card = { type: 'card', title: 'The end', duration: 2 };
    writeFileSync(path, JSON.stringify({ ...JSON.parse(original), scenes: [title, { type: 'clip', from: 0, to: 5 }, card] }));
    const edited = readFileSync(path, 'utf8');
    const first = await cli('--json', '-C', dir, 'suggest', '--no-zoom');
    const scenes = (first.json as { scenes: unknown[] }).scenes;
    expect([scenes[0], scenes.at(-1)]).toEqual([title, card]); // a title card stays first, an end card last
    expect((first.json as { notes: string[] }).notes).toContain('kept 2 still or card scene(s), 1 before the clips');
    const suggested = readFileSync(path, 'utf8');
    await cli('--json', '-C', dir, 'suggest', '--no-zoom'); // the same suggestion again
    // .bak holds the version before the last run; the one before it moved to .bak.1
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe(suggested);
    expect(readFileSync(`${path}.bak.1`, 'utf8')).toBe(edited);
    expect(existsSync(`${path}.bak.2`)).toBe(false);
  }, 30_000);

  it('repairs a crashed take and uses it', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const take = join(dir, 'takes', '1');
    rmSync(join(take, 'take.json'));
    rmSync(join(take, 'markers.json'));
    writeFileSync(join(take, 'events.jsonl'), '{"t":1,"type":"keys","count":1}\n{"t":2,"type":"ke'); // cut off by the crash
    const { code, json } = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect(code).toBe(0);
    expect(stable(json, dir)).toMatchInlineSnapshot(`
      {
        "keptEdit": false,
        "project": "<project>/cuttle.json",
        "repaired": [
          "events.jsonl: kept 1 events, dropped 1 broken or cut-off line(s) (old file: events.jsonl.bak)",
          "markers.json was missing: written empty",
          "take.json was missing: written with the tracks starting together at an unknown time",
        ],
        "seconds": 20,
        "take": "takes/1",
        "tracks": [
          "screen",
        ],
      }
    `);
    expect(readFileSync(join(take, 'events.jsonl'), 'utf8')).toBe('{"t":1,"type":"keys","count":1}\n');
    expect(JSON.parse(readFileSync(join(take, 'take.json'), 'utf8'))).toEqual({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 0 } } });
    // Recovering the take the project uses keeps the edit.
    const path = join(dir, 'cuttle.json');
    const text = { at: 2, duration: 2, text: 'hello' };
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), texts: [text] }));
    const recovered = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect(recovered.json).toMatchObject({ repaired: [], keptEdit: true }); // nothing left to repair
    expect(JSON.parse(readFileSync(path, 'utf8')).texts).toEqual([text]);
  }, 30_000);

  it('keeps readable start times of a broken take.json, and touches nothing when cuttle.json is broken', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    const take = join(dir, 'takes', '1');
    const broken = JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1792189686.2 } }, note: 'unknown key' });
    writeFileSync(join(take, 'take.json'), broken);
    const { code, json } = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect(code).toBe(0);
    expect((json as { repaired: string[] }).repaired).toEqual(["take.json was broken (old file: take.json.bak): rewritten with the screen's start time"]);
    expect(JSON.parse(readFileSync(join(take, 'take.json'), 'utf8')).tracks.screen.start).toBe(1792189686.2);
    expect(readFileSync(join(take, 'take.json.bak'), 'utf8')).toBe(broken);

    writeFileSync(join(dir, 'cuttle.json'), '{ "version": 1 }');
    rmSync(join(take, 'markers.json'));
    const refused = await cli('--json', '-C', dir, 'recover', 'takes/1');
    expect((refused.json as { error: { code: string } }).error.code).toBe('invalid-project');
    expect(existsSync(join(take, 'markers.json'))).toBe(false);
  }, 30_000);

  it('refuses a take outside the project and one without video', async () => {
    const dir = temp();
    const outside = await cli('--json', '-C', dir, 'recover', '..');
    expect(outside.code).toBe(1);
    expect((outside.json as { error: { code: string } }).error.code).toBe('usage');
    mkdirSync(join(dir, 'takes', '9'), { recursive: true });
    const empty = await cli('--json', '-C', dir, 'recover', 'takes/9');
    expect(empty.code).toBe(1);
    expect((empty.json as { error: { code: string } }).error.code).toBe('invalid-media');
  });
});

/** Width and height of a PNG, from its IHDR chunk. */
const pngSize = (file: string) => {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe('cuttle frame and the source seconds of stills', () => {
  it('writes a source frame at full size, with a numbered grid on request', async () => {
    const dir = temp();
    takeFixture(dir);
    const plain = await cli('--json', '-C', dir, 'frame', '10');
    expect(stable(plain.json, dir)).toEqual({ t: 10, file: '<project>/frames/10.00s.png', width: 1280, height: 720, grid: false, labels: false });
    expect(pngSize(join(dir, 'frames', '10.00s.png'))).toEqual([1280, 720]);
    const grid = await cli('--json', '-C', dir, 'frame', '10', '--grid', '-o', join(dir, 'grid.png'));
    expect(grid.json).toMatchObject({ grid: true, labels: process.platform === 'win32' }); // Windows always has Arial
    expect(pngSize(join(dir, 'grid.png'))).toEqual([1280, 720]);
    const past = await cli('--json', '-C', dir, 'frame', '25');
    expect((past.json as { error: { code: string; message: string } }).error).toEqual({ code: 'usage', message: 'the screen track is 20.00 s long; 25 s is past its end' });
  });

  it('maps an output second to the source second a clip shows', () => {
    const scenes = [
      { type: 'clip', from: 0, to: 2, speed: 1 },
      { type: 'clip', from: 10, to: 18, speed: 4 },
      { type: 'card', title: 'The end', duration: 2 },
    ] as const satisfies readonly Scene[];
    expect([sourceSecond(scenes, 1), sourceSecond(scenes, 3), sourceSecond(scenes, 5)]).toEqual([1, 14, undefined]);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm exec vitest run apps/cli/test/cli.test.ts`
Expected: FAIL, the two new tests fail: `frame` is an unknown command (the JSON is a usage error), and `TypeError: sourceSecond is not a function`.

- [ ] **Step 3: A quick probe of the screen track**

In `apps/cli/src/suggest/media.ts`, replace:

```ts
  if (open !== undefined) still.push({ from: open, to: duration });
  return { duration, width: Number(size?.[1] ?? 0), height: Number(size?.[2] ?? 0), still };
}
```

with:

```ts
  if (open !== undefined) still.push({ from: open, to: duration });
  return { duration, width: Number(size?.[1] ?? 0), height: Number(size?.[2] ?? 0), still };
}

/** Size and length of the screen track from a pass that copies its packets (fast: nothing is decoded). */
export async function probeScreen(path: string): Promise<{ duration: number; width: number; height: number }> {
  const { stderr } = await runFfmpeg(['-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  const { duration, width, height } = parseAnalysis(stderr);
  return { duration, width, height };
}
```

- [ ] **Step 4: The frame command**

`apps/cli/src/commands/frame.ts`:

```ts
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CliError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';
import { probeScreen } from '../suggest/media';

export interface FrameArgs {
  /** A pixel grid with numbers over the frame, for reading the rects of masks and zooms. */
  grid?: boolean;
  /** PNG to write (default frames/<t>s.png, or frames/<t>s-grid.png, in the project). */
  out?: string;
}

export interface FrameResult {
  /** Source seconds of the frame. */
  t: number;
  file: string;
  /** The screen track's size: the PNG's size, and the pixels rects are given in. */
  width: number;
  height: number;
  grid: boolean;
  /** Whether the grid lines carry their pixel numbers (they need a system font). */
  labels: boolean;
}

/** Grid lines every this many source pixels, stronger every `GRID_MAJOR`. */
export const GRID_STEP = 100;
const GRID_MAJOR = 500;

/** Fonts ffmpeg's drawtext can use for the grid numbers, by platform (drawtext needs a font file). */
const FONTS: Record<string, string[]> = {
  win32: ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf'],
  darwin: ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'],
  linux: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'],
};

function labelFont(): string | undefined {
  return (FONTS[process.platform] ?? []).find((font) => existsSync(font));
}

/** The grid as an ffmpeg filter chain: lines every GRID_STEP px (stronger every GRID_MAJOR), numbered when there is a font. */
export function gridFilter(width: number, height: number, font: string | undefined): string {
  const lines = [`drawgrid=w=${GRID_STEP}:h=${GRID_STEP}:t=1:c=0xFF00FF@0.35`, `drawgrid=w=${GRID_MAJOR}:h=${GRID_MAJOR}:t=3:c=0xFF00FF@0.7`];
  if (font === undefined) return lines.join(',');
  // drawtext's options are `:`-separated: escape the drive letter's colon.
  const fontfile = font.replace(/\\/g, '/').replace(/:/g, '\\:');
  const size = Math.max(12, Math.round(height / 80));
  const label = (value: number, x: number, y: number) =>
    `drawtext=fontfile='${fontfile}':text=${value}:x=${x}:y=${y}:fontsize=${size}:fontcolor=white:box=1:boxcolor=0xFF00FF@0.7:boxborderw=2`;
  const labels: string[] = [];
  for (let x = 0; x < width; x += GRID_STEP) labels.push(label(x, x + 3, 3));
  for (let y = GRID_STEP; y < height; y += GRID_STEP) labels.push(label(y, 3, y + 3));
  return [...lines, ...labels].join(',');
}

/**
 * `cuttle frame <source-seconds>`: the screen track's frame at that time as a PNG at full size, in
 * the pixels masks and zooms use; with `--grid` a numbered pixel grid to read rects from.
 */
export async function frameCommand(projectDir: string, at: number, args: FrameArgs, output: Output): Promise<FrameResult> {
  const file = await readProjectFile(projectDir);
  const screen = resolve(file.dir, file.project.sources.screen);
  const { width, height, duration } = await probeScreen(screen);
  if (at >= duration) throw new CliError('usage', `the screen track is ${duration.toFixed(2)} s long; ${at} s is past its end`);
  const out = args.out ? resolve(args.out) : join(file.dir, 'frames', `${at.toFixed(2)}s${args.grid ? '-grid' : ''}.png`);
  await mkdir(dirname(out), { recursive: true });
  const font = args.grid ? labelFont() : undefined;
  if (args.grid && font === undefined) output.warn('no font for the grid numbers was found: the grid has lines only (every 100 px, stronger every 500 px)');
  await runFfmpeg(['-ss', at.toFixed(3), '-i', screen, '-frames:v', '1', ...(args.grid ? ['-vf', gridFilter(width, height, font)] : []), '-y', out]);
  const result: FrameResult = { t: at, file: out, width, height, grid: args.grid ?? false, labels: font !== undefined };
  output.result(result, () => `${out} (${width}×${height} source pixels${args.grid ? `, a grid every ${GRID_STEP} px` : ''})`);
  return result;
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { devices } from './commands/devices';
```

with:

```ts
import { devices } from './commands/devices';
import { frameCommand } from './commands/frame';
```

In the same file, replace:

```ts
  program
    .command('render')
    .description('export the project as an MP4')
```

with:

```ts
  program
    .command('frame')
    .description('a frame of the screen track at full size (the pixels masks and zooms use), optionally with a numbered grid')
    .argument('<seconds>', 'source seconds of the frame', seconds)
    .option('--grid', 'a pixel grid with numbers, every 100 px')
    .option('-o, --out <file>', 'PNG to write (default: frames/<seconds>s.png in the project)')
    .action(action((output, project, at: number, options: { grid?: boolean; out?: string }) => frameCommand(project, at, options, output)));

  program
    .command('render')
    .description('export the project as an MP4')
```

- [ ] **Step 5: The source second of each still**

`apps/cli/src/commands/preview.ts`:

```ts
import { join, resolve } from 'node:path';
import type { Scene } from '@cuttle/project';
import { sceneSpans, sourceTimeAt, spanAt, totalDuration } from '@cuttle/timeline';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';

export interface PreviewArgs {
  /** Output seconds; without them, a sheet of `SHEET_STILLS` evenly spaced stills. */
  at?: number[];
  sheet?: boolean;
  format?: string;
  /** Folder for the PNGs (default preview/ in the project). */
  out?: string;
}

/** What @cuttle/export's renderStills returns, with the source second of each still. */
export interface PreviewResult {
  /** `source`: the source second shown (clip scenes only), for placing masks, zooms and texts. */
  stills: { t: number; file: string; source?: number }[];
  sheet?: string;
  width: number;
  height: number;
  stats: { gpu: string; totalMs: number };
}

/** Stills of a default contact sheet. */
export const SHEET_STILLS = 12;

/** `cuttle preview`: PNG stills of the output, and a contact sheet, for checking a project. */
export async function previewCommand(projectDir: string, args: PreviewArgs, output: Output, signal: AbortSignal): Promise<PreviewResult> {
  const file = await readProjectFile(projectDir);
  const duration = totalDuration(sceneSpans(file.project.scenes));
  if (duration <= 0) throw new CliError('invalid-project', `${file.path} has no scenes yet; run "cuttle suggest" or add scenes`);
  const times = args.at && args.at.length > 0 ? args.at : Array.from({ length: SHEET_STILLS }, (_, i) => Math.round(((i + 0.5) * duration * 1000) / SHEET_STILLS) / 1000);
  const bad = times.find((t) => !Number.isFinite(t) || t < 0);
  if (bad !== undefined) throw new CliError('usage', `--at takes output seconds of 0 or more (got ${bad})`);
  const sheet = args.sheet ?? !(args.at && args.at.length > 0);
  const outDir = args.out ? resolve(args.out) : join(file.dir, 'preview');
  output.info(`rendering ${times.length} still(s) into ${outDir} …`);
  const rendered = await runInElectron<PreviewResult>(
    { command: 'preview', projectDir: file.dir, outDir, times, quiet: output.json, clean: args.out === undefined, ...(args.format !== undefined && { format: args.format }), ...(sheet && { sheet: {} }) },
    signal,
  );
  // Masks, zooms and texts are placed in source seconds: each still says which one it shows.
  const stills = rendered.stills.map((still) => {
    const source = sourceSecond(file.project.scenes, still.t);
    return { ...still, ...(source !== undefined && { source }) };
  });
  const result: PreviewResult = { ...rendered, stills };
  output.result(result, () =>
    [
      ...stills.map((still) => `${still.t.toFixed(2)} s${still.source !== undefined ? ` (source ${still.source.toFixed(2)} s)` : ''}  ${still.file}`),
      ...(result.sheet ? [`sheet  ${result.sheet}`] : []),
    ].join('\n'),
  );
  return result;
}

/** The source second a clip scene shows at output time `t`; undefined on a still or card scene. */
export function sourceSecond(scenes: readonly Scene[], t: number): number | undefined {
  const span = spanAt(sceneSpans(scenes), t);
  if (span?.scene.type !== 'clip') return undefined;
  return Math.round(sourceTimeAt(span.scene, t - span.start) * 1000) / 1000;
}
```

Run: `pnpm exec vitest run apps/cli/test/cli.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: The source seconds through Electron**

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
    const stills = some.json.stills as { t: number; file: string }[];
    expect(stills.map((still) => still.t)).toEqual([0.5, 2]);
```

with:

```ts
    const stills = some.json.stills as { t: number; file: string; source?: number }[];
    // one clip over the whole take: each still shows the same source second
    expect(stills.map((still) => [still.t, still.source])).toEqual([[0.5, 0.5], [2, 2]]);
```

Run: `pnpm cli:check`
Expected: PASS, 4 tests.

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 7: Commit**

```bash
git add apps/cli
git commit -m "cli: cuttle frame (a source frame with a numbered pixel grid) and the source second of each preview still

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The skill

**Files:**
- Create: `skill/package.json`, `skill/tsconfig.json`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`, `skill/install.mjs`
- Modify: `apps/cli/package.json`, `pnpm-workspace.yaml`, `package.json`, `vitest.config.ts`, `pnpm-lock.yaml`
- Test: `skill/test/skill.test.ts`

- [ ] **Step 1: The package**

`skill/package.json`:

```json
{
  "name": "@cuttle/skill",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@cuttle/cli": "workspace:*",
    "@cuttle/project": "workspace:*"
  }
}
```

`skill/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  // The skill's tests (they read the skill's Markdown and run the CLI in-process).
  "include": ["test"]
}
```

`apps/cli/package.json` (it exports `runCli` for the skill's tests):

```json
{
  "name": "@cuttle/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/main.ts"
  },
  "dependencies": {
    "@cuttle/export": "workspace:*",
    "@cuttle/project": "workspace:*",
    "@cuttle/recorder": "workspace:*",
    "@cuttle/timeline": "workspace:*",
    "commander": "15.0.0",
    "koffi": "3.3.2",
    "uiohook-napi": "1.5.5"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - apps/*
  - skill
allowBuilds:
  koffi: false
  uiohook-napi: false
```

In `package.json`, replace:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p apps/cli/tsconfig.json",
```

with:

```json
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json && tsc -p packages/engine/tsconfig.json && tsc -p packages/export/tsconfig.json && tsc -p packages/export/tsconfig.node.json && tsc -p packages/recorder/tsconfig.json && tsc -p apps/cli/tsconfig.json && tsc -p skill/tsconfig.json",
```

In the same file, replace:

```json
    "cuttle": "node apps/cli/dist/cuttle.mjs"
```

with:

```json
    "cuttle": "node apps/cli/dist/cuttle.mjs",
    "skill:install": "node skill/install.mjs",
    "skill:uninstall": "node skill/install.mjs --uninstall"
```

In `vitest.config.ts`, replace:

```ts
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
```

with:

```ts
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
```

Run: `pnpm install`
Expected: exits with code 0; `pnpm-lock.yaml` gains the importer `skill`.

- [ ] **Step 2: Write the failing test**

`skill/test/skill.test.ts`:

````ts
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runCli } from '@cuttle/cli';
import {
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  MASK_STYLES,
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  parseProject,
} from '@cuttle/project';

const SKILL_DIR = fileURLToPath(new URL('../cuttle/', import.meta.url));
const INSTALL = fileURLToPath(new URL('../install.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(SKILL_DIR, 'project.md'), 'utf8');
const docs = [skill, reference];

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-skill-'));
  dirs.push(dir);
  return dir;
};

describe('SKILL.md', () => {
  it('has the frontmatter Claude Code reads: its name and a description that says when to use it', () => {
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
    const fields = Object.fromEntries(frontmatter.split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
    expect(Object.keys(fields)).toEqual(['name', 'description']);
    expect(fields.name).toBe('cuttle');
    expect(fields.description!.length).toBeGreaterThan(200);
    expect(fields.description!.length).toBeLessThanOrEqual(1024); // the Agent Skills limit
    expect(fields.description).toMatch(/^Records the screen/); // third person, what it does first
    expect(fields.description).toMatch(/Use when .*demo.*screencast.*screen recording/);
  });

  it('stays short and links only files that exist', () => {
    expect(skill.split('\n').length).toBeLessThan(500);
    const links = [...docs.join('\n').matchAll(/\]\(([^)#]+)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(existsSync(join(SKILL_DIR, link)), link).toBe(true);
  });
});

/** The program's own options, which may also follow the command. */
const GLOBAL = ['--json', '--project', '--help', '--version'];

/** The help text of a command, from the CLI itself. */
async function help(command: string): Promise<string> {
  let out = '';
  await runCli([command, '--help'], { stdout: (text) => void (out += text), stderr: () => {} });
  return out;
}

describe('the cuttle commands in the skill', () => {
  // `cuttle [-C dir] [--json] <command> … --flags` in code blocks and inline code: what Claude runs.
  const code = docs.flatMap((text) => [...text.matchAll(/```[a-z]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map((match) => match[1] ?? match[2]!));
  const uses = code.flatMap((snippet) =>
    [...snippet.matchAll(/(?:^|\s)cuttle((?: (?:-C "[^"]*"|-C \S+|--json))*) ([a-z][a-z-]*)([^\n]*)/g)].map(([, , command, rest]) => ({
      command: command!,
      flags: [...rest!.matchAll(/(?:^|\s)(--[a-z-]+)/g)].map((flag) => flag[1]!).filter((flag) => !GLOBAL.includes(flag)),
    })),
  );

  it('covers the workflow', () => {
    expect(new Set(uses.map((use) => use.command))).toEqual(new Set(['devices', 'record', 'suggest', 'preview', 'frame', 'capture-page', 'render', 'recover']));
  });

  it('uses only commands and options the CLI has', async () => {
    for (const { command, flags } of uses) {
      const text = await help(command);
      expect(text, `cuttle ${command}`).toContain(`Usage: cuttle ${command}`);
      for (const flag of flags) expect(text, `cuttle ${command} ${flag}`).toMatch(new RegExp(`${flag}\\b`));
    }
  });
});

describe('project.md', () => {
  it('has a complete example that is a valid project', () => {
    const example = /```json\n([\s\S]*?)\n```/.exec(reference)?.[1] ?? '';
    const parsed = parseProject(JSON.parse(example));
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
  });

  it('lists every value the schema accepts', () => {
    const lists = { BACKGROUND_PRESETS, FRAME_STYLES, CURSOR_STYLES, CLICK_EFFECTS, WEBCAM_SHAPES, WEBCAM_CORNERS, STILL_MOTIONS, EASES, MASK_STYLES, TEXT_STYLES, TEXT_POSITIONS };
    for (const [name, values] of Object.entries(lists)) {
      for (const value of values) expect(reference, `${name}: ${value}`).toContain(`\`${value}\``);
    }
  });
});

describe('skill/install.mjs', () => {
  const install = (config: string, ...args: string[]) =>
    spawnSync('node', [INSTALL, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config } });

  it('installs into the Claude config folder with this repository in SKILL.md, again over itself, and uninstalls', () => {
    const config = temp();
    expect(install(config).status).toBe(0);
    const target = join(config, 'skills', 'cuttle');
    expect(readdirSync(target).sort()).toEqual(['.cuttle-skill.json', 'SKILL.md', 'project.md']);
    const installed = readFileSync(join(target, 'SKILL.md'), 'utf8');
    expect(installed).not.toContain('{{REPO}}');
    expect(installed).toContain(`(\`${REPO}\`)`);
    expect(readFileSync(join(target, 'project.md'), 'utf8')).toBe(reference);
    expect(install(config).status).toBe(0);
    expect(install(config, '--uninstall').status).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it('never touches a cuttle skill it did not install', () => {
    const config = temp();
    const target = join(config, 'skills', 'cuttle');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), 'mine');
    const refused = install(config);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/was not installed by this script/);
    expect(install(config, '--uninstall').status).toBe(0);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('mine');
  });
});
````

Run: `pnpm exec vitest run skill`
Expected: FAIL, the suite cannot load: `ENOENT: no such file or directory, open '…/skill/cuttle/SKILL.md'`.

- [ ] **Step 3: SKILL.md and the reference**

`skill/cuttle/SKILL.md`:

````markdown
---
name: cuttle
description: Records the screen and turns the take into a polished demo video with the cuttle CLI (cuts, speed-ups, zooms, masks over private data, a framed window on a designed background, captions, an end card; MP4 in 16:9, 1:1 or 9:16). Use when the user wants to record a demo, a screencast or screen recording, a launch or product video, a video of what Claude Code built, or to edit or re-render a cuttle project (cuttle.json).
---

# Cuttle: screen recordings that edit themselves

You drive the `cuttle` command line. A project is a folder with `cuttle.json` and one take
(`takes/<n>/`: the screen, optional webcam and mic, input events, markers). You record, let
`cuttle suggest` cut the take, refine `cuttle.json`, check stills, and render.

Before you edit `cuttle.json`, read [project.md](project.md): the format, source seconds and
source pixels, and how to find them.

## 0. Check the tools

```bash
cuttle --version
```

If the command is missing, ask the user to run `pnpm cli:install` in the cuttle repository
(`{{REPO}}`) and to open a new terminal. Recording and rendering also need ffmpeg on PATH
(Windows: `winget install Gyan.FFmpeg`). Recording works on Windows for now.

Pass the project folder as an absolute path with `-C "<project>"` and use `--json` for every
command except `record` (below): stdout is then one JSON document, the result or
`{ "error": { "code", "message" } }`. Exit codes: 0 ok, 1 usage or invalid project, 2 device or
permission, 3 render, 130 cancelled.

## 1. Agree the plan with the user (briefly)

- What the demo shows, and how it ends (Claude's answer, a page, a result on screen).
- Which screen: run `cuttle --json devices` and name the monitors (index, size, primary) and
  matching windows. A window (`--window`) or a region keeps the video small and private.
- The format: 16:9 for X, YouTube and LinkedIn; 9:16 for Shorts, Reels and TikTok; 1:1 for feeds.
  X takes H.264 up to 1920×1200; keep demos under 60 s.
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows and notifications, and to use a clean folder or browser profile.
- The project folder: a new one per demo, e.g. `~/cuttle-demos/<name>` (`record` creates it).

## 2. Record

Never start Claude Code yourself, and never change Claude's settings to trust a folder. For an
agent demo, ask the user to start Claude Code in the demo folder in their own terminal and to
accept the trust dialog. Suggest `claude --setting-sources "project,local" --strict-mcp-config`,
which keeps their global hooks and plugins out of the video (in PowerShell keep the quotes: it
reads `a,b` as an array).

`cuttle record` runs until a stop trigger. Start it **in the background** (Bash
`run_in_background`) **before** the user acts, and without `--json`, so its status lines show:

```bash
cuttle -C "<project>" record --monitor 0 --until-claude "<demo folder>" --max 600
```

- `--until-claude "<folder>"`: stops 2 s after the first Claude Code session in that folder that
  prompts after the start finishes its turn. Its prompt, tool calls and answer become markers.
- `--until-file "<project>/stop"`: stops when the file appears. When the user says they are done,
  create it (`touch "<project>/stop"`). It must not exist at the start.
- `--until-idle 5`: stops once the screen and the input have rested 5 s.
- Always add `--max <seconds>` as a safety net. The user can also stop with Ctrl+Shift+Alt+S and
  add a marker with Ctrl+Shift+Alt+M.
- Other sources: `--window "<part of the title>"`, `--region x,y,w,h` (pixels of `--monitor`).
  `--countdown 3` is the default.

Read the command's output until it shows `recording takes/<n>`. Then tell the user to start (for
an agent demo: to send the prompt in their Claude Code session). Do not rely on the user's "done"
for timing: `suggest` trims the quiet start and end anyway. When the command ends, it prints the
take (`recorded takes/1: 42.0 s …`), and `cuttle.json` uses it as one clip over the whole take. A
new take replaces the previous take's scenes and overlays; older versions stay as
`cuttle.json.bak`, `.bak.1` and so on.

## 3. Edit

```bash
cuttle -C "<project>" --json suggest
cuttle -C "<project>" --json preview
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work)
and zooms on Claude's answer. Its `notes` say what it did, in source seconds. For a take recorded
without `--until-claude`, add `--claude "<demo folder>"` to read the markers from Claude Code's
transcript.

`preview` writes 12 stills and `preview/sheet.png`. **Look at the sheet** (Read the PNG). Each
still in the JSON has its output second `t` and the `source` second it shows. For details, run
`cuttle -C "<project>" --json preview --at 3.5 --at 12` (output seconds).

Then refine `cuttle.json` ([project.md](project.md)) and preview again:

- **Privacy first.** Look at every still for names, email addresses, tokens and API keys, file
  paths with user names, hook or plugin errors, and notifications. To place a mask, take the
  still's `source` second and run `cuttle -C "<project>" --json frame <source second> --grid`.
  Read that PNG: a numbered grid every 100 source pixels. Then add a `masks` entry: from and to in
  source seconds, a generous rect, and `fill` for secrets. Or cut the stretch out.
- **Story.** Trim what does not help. Keep the prompt readable (1.5 s or more) and the answer on
  screen for 2–3 s. A speed-up shows a "12× speed" badge.
- **Focus.** Add or fix `zooms` on what matters: 2–4 s on the answer or a result, with the rect
  read off a `frame --grid`.
- **Look.** Set `look.frame.title` (e.g. `claude · ~/demo`) and a background preset, add a `card`
  scene at the end with the product name and URL, and add a `texts` caption where a step is not
  obvious.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built). Add `--wait 2500` for slow maps or
  fonts.

## 4. Render

```bash
cuttle -C "<project>" --json render --format 16:9
```

Run it in the background for takes longer than a minute; the Bash tool stops long commands. It
writes `out/16x9.mp4` (or `-o <file>`) and prints the frames, the seconds and the encoder. Render
each format the user wants. Tell the user the file's path and length. Do not upload it anywhere.

## When something fails

- `device-not-found`: run `cuttle --json devices`. Names must match exactly (`--mic "<name>"`).
- `invalid-project`: the message names the field (`scenes.2.to: …`); fix `cuttle.json`, or go back
  to `cuttle.json.bak`.
- A crash during recording: `cuttle -C "<project>" --json recover takes/<n>` makes the take usable.
- `suggest` found no Claude markers: pass `--claude "<demo folder>"`.
- A render fails with `render`: try `--encoder software`.
````

`skill/cuttle/project.md`:

````markdown
# cuttle.json reference

`cuttle.json` is the only file to edit. `cuttle record` and `cuttle suggest` write it, you refine
it by hand, check it with `cuttle preview` and export it with `cuttle render`. Unknown fields are
errors, and every command names the path of a problem (`scenes.2.to: "to" must be greater than
"from"`).

## Times and pixels

- **Source seconds** are seconds of the take's screen track (`takes/<n>/screen.mp4`). Scenes cut
  and speed them up. `zooms`, `masks` and `texts` use source seconds too, so they stay on their
  content; they show only while a clip scene covers that source time.
- **Output seconds** are seconds of the rendered video. `cuttle preview --at` and the times on the
  contact sheet are output seconds; each still in `preview`'s JSON also has the `source` second it
  shows.
- **Rects** are `[x, y, width, height]` in pixels of the screen track (the recorded monitor, region
  or window, e.g. 2560×1440), not of the output.

## A complete example

```json
{
  "version": 1,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "sources": {
    "screen": "takes/1/screen.mp4",
    "mic": "takes/1/mic.m4a",
    "events": "takes/1/events.jsonl",
    "markers": "takes/1/markers.json"
  },
  "look": {
    "background": { "preset": "sunset-sky" },
    "frame": { "style": "mac-dark", "title": "claude · ~/demo" },
    "cursor": { "style": "system" }
  },
  "scenes": [
    { "type": "clip", "from": 1.2, "to": 7.5 },
    { "type": "clip", "from": 7.5, "to": 120.4, "speed": 12 },
    { "type": "clip", "from": 120.4, "to": 128 },
    { "type": "still", "image": "stills/example-com.png", "duration": 5, "motion": "scroll", "frame": "browser-light" },
    { "type": "card", "title": "Built with Claude Code", "subtitle": "example.com", "duration": 2.5 }
  ],
  "zooms": [{ "at": 121, "duration": 4, "rect": [0, 600, 1400, 788] }],
  "masks": [{ "from": 0, "to": 128, "rect": [2200, 0, 360, 40], "style": "fill" }],
  "texts": [{ "at": 2, "duration": 3, "text": "One prompt", "style": "pill", "position": "top" }]
}
```

## Fields

`output`: `width` and `height` (even, at most 4096; default 1920×1080) and `fps` (default 30).
`cuttle render --format` overrides the size: `16:9` is 1920×1080, `1:1` is 1080×1080, `9:16` is
1080×1920.

`sources`: paths relative to the project folder. `cuttle record` sets them.

`look` (every field is optional):

| Field | Values (default first) |
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |

`frame.enabled: false` shows the screen alone, filling the output. A take recorded with
`--draw-mouse` has the real pointer in the video; `record` then sets `cursor.enabled` to `false`, so
there are not two cursors.

`scenes` play in order:

| Type | Fields |
|---|---|
| `clip` | `from`, `to` (source seconds, `to` > `from`), `speed` (`1`, up to 64; above 1 a badge like "12× speed" shows), `badge` (custom badge text, `""` for none) |
| `still` | `image` (a path, e.g. from `cuttle capture-page`), `duration` (output seconds), `motion` (`none`, `kenburns`, `scroll`: top to bottom of a tall image), `frame` (`none`, `mac-dark`, `mac-light`, `browser-light`) |
| `card` | `title`, `subtitle` (optional), `duration` (output seconds): a title or end card on the background |

`zooms`: `at` and `duration` (source seconds), `rect`, `ease` (`smooth`, `linear`) and `enabled`
(`true`). The rect is widened to the screen's aspect and kept inside the screen. The zoom eases in
and out (0.6 s each), so give it 2 s or more.

`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
few pixels too small leaves letters readable.

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
`position` (`top`, `center`, `bottom`) and `enabled` (`true`).

## Finding source seconds and rects

- `cuttle --json preview` lists each still's `source` second next to its output second `t`.
- `cuttle --json frame <source second> --grid` writes that frame of the screen track at full size
  with a numbered grid every 100 pixels (stronger lines every 500). Read the PNG and take rects off
  the grid; `frames/<t>s-grid.png` is the default file.
- `takes/<n>/markers.json` lists the prompt, each tool call and Claude's answer in source seconds.
- `cuttle --json suggest` prints notes with source seconds (`sped up 112.9 s without input 12×
  (7.5–120.4 s)`).
- To get from output to source seconds by hand, walk the scenes. A clip lasts
  `(to − from) / speed` output seconds and a still or card its `duration`; the video is their sum
  (a crossfade is centred on the boundary and does not shorten it). Inside a clip,
  source = `from + (output − scene start) × speed`.
````

Run: `pnpm exec vitest run skill`
Expected: FAIL, 2 tests fail: the installer's (`skill/install.mjs` does not exist yet); 6 pass.

- [ ] **Step 4: The installer**

`skill/install.mjs`:

```js
// Installs the Claude skill: copies skill/cuttle/ to <Claude's config folder>/skills/cuttle/
// (CLAUDE_CONFIG_DIR, default ~/.claude), with {{REPO}} in SKILL.md replaced by this repository's
// path. A file .cuttle-skill.json in the installed folder marks it as ours; a cuttle skill without
// it belongs to someone else and is never touched. `--uninstall` removes our files.
//   node skill/install.mjs [--uninstall]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = '.cuttle-skill.json';
const source = fileURLToPath(new URL('./cuttle/', import.meta.url));
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const target = join(configDir, 'skills', 'cuttle');
const marker = join(target, MARK);

/** What a previous install wrote, or undefined when the folder is not ours (or does not exist). */
function installed() {
  if (!existsSync(marker)) return undefined;
  try {
    return JSON.parse(readFileSync(marker, 'utf8'));
  } catch {
    return undefined;
  }
}

function removeOurs() {
  const previous = installed();
  if (!previous) return false;
  for (const name of previous.files ?? []) rmSync(join(target, name), { force: true });
  rmSync(marker, { force: true });
  if (readdirSync(target).length === 0) rmSync(target, { recursive: true });
  return true;
}

if (process.argv.includes('--uninstall')) {
  console.log(removeOurs() ? `removed the cuttle skill from ${target}` : `no cuttle skill installed by this script in ${target}`);
  process.exit(0);
}

if (existsSync(target) && !installed()) {
  console.error(`${target} exists and was not installed by this script; move it away first`);
  process.exit(1);
}
removeOurs(); // files of an older version
mkdirSync(target, { recursive: true });
const files = readdirSync(source).filter((name) => name.endsWith('.md'));
for (const name of files) {
  const text = readFileSync(join(source, name), 'utf8').replaceAll('{{REPO}}', repo.replace(/\\/g, '/'));
  writeFileSync(join(target, name), text);
}
writeFileSync(marker, `${JSON.stringify({ repo, files }, null, 2)}\n`);
console.log(`installed the cuttle skill in ${target} (${files.join(', ')})`);
console.log('Claude Code uses it when you ask for a demo or type /cuttle (a session that was already running may need /reload-skills); it needs the cuttle command: pnpm cli:install');
```

Run: `pnpm exec vitest run skill`
Expected: PASS, 8 tests.

Run: `pnpm exec tsc -p skill/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 5: Commit**

```bash
git add skill apps/cli/package.json pnpm-workspace.yaml package.json vitest.config.ts pnpm-lock.yaml
git commit -m "skill: SKILL.md, the cuttle.json reference, the installer, and tests that hold them to the CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, `docs/superpowers/specs/2026-10-16-cuttle-design.md`

- [ ] **Step 1: README**

In `README.md`, replace:

```markdown
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, capture-page, render, recover; `--json` for Claude |
```

with:

```markdown
| `apps/cli` | The `cuttle` command: init, devices, record, suggest, preview, frame, capture-page, render, recover; `--json` for Claude |
| `skill/` | The Claude skill: `SKILL.md` (the workflow) and `project.md` (the `cuttle.json` reference), installed by `pnpm skill:install` |
```

In the same file, replace:

```markdown
cuttle preview                       # 12 stills and a contact sheet in preview/
```

with:

```markdown
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
```

In the same file, replace:

```markdown
Engine golden images live in `packages/engine/test/__golden__/`, one PNG per platform. A new
```

with:

```markdown
## The Claude skill

`pnpm skill:install` copies the skill into Claude Code's personal skills
(`~/.claude/skills/cuttle/`, or under `CLAUDE_CONFIG_DIR`) with this repository's path filled in.
`pnpm skill:uninstall` removes it; a `cuttle` skill it did not install is never touched. The skill
needs `cuttle` on PATH (`pnpm cli:install`). Then ask Claude Code for a demo video, or type
`/cuttle`.

Engine golden images live in `packages/engine/test/__golden__/`, one PNG per platform. A new
```

- [ ] **Step 2: Roadmap**

In `docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md`, replace:

```markdown
| M6 | `skill/` + installer | write before starting |
```

with:

```markdown
| M6 | `skill/` + installer | `2026-10-17-cuttle-m6-skill.md` |
```

In the same file, replace:

```markdown
- **M6:** current Claude skill frontmatter (`name`, `description`) and the user-level skill folder.
  From M5: the skill drives `cuttle … --json` and reads one JSON document per command (exit codes
  0/1/2/3/130). `cuttle record` blocks until a stop trigger, and Claude cannot press Ctrl+C or the
  hotkey: start it in the background and stop it with `--until-claude` or `--until-file` (Claude
  creates the file), with `--max` as a safety net. Run `render` in the background too (Claude
  Code's Bash tool kills long commands at its timeout). Check the edit with `cuttle preview` and
  look at `sheet.png`. The skill should check `cuttle --version` and point to `pnpm cli:install`
  when it is missing; the shims run the repo's build, so the repo must stay where it was built.
```

with:

```markdown
- **M6:** done; see "Decisions made while planning" in `2026-10-17-cuttle-m6-skill.md`.
```

- [ ] **Step 3: Spec**

In `docs/superpowers/specs/2026-10-16-cuttle-design.md`, replace:

```markdown
| PNG stills of the output; without `--at` 12 evenly spaced stills and a contact sheet with timestamps, for checking. A run that fails or is cancelled writes nothing; in the default folder (`preview/`) stills of earlier runs are replaced |
```

with:

```markdown
| PNG stills of the output; without `--at` 12 evenly spaced stills and a contact sheet with timestamps, for checking. The JSON names the source second each still shows. A run that fails or is cancelled writes nothing; in the default folder (`preview/`) stills of earlier runs are replaced |
| `cuttle frame <seconds> [--grid] [-o file]` | A frame of the screen track at a source second, at full size (the pixels masks and zooms use); `--grid` draws a line every 100 px with its pixel number, to read rects from |
```

In the same file, replace:

```markdown
`SKILL.md` triggers on requests to record, demo, screencast or edit a screen recording. Workflow:

1. Agree the scenario and the output format with the user.
2. `cuttle devices`, pick the monitor; check font size and fullscreen with a short test take
   (`cuttle record --max 3`) and a `preview` still.
3. Start `cuttle record` before the user acts; prefer `--until-claude` for agent demos.
4. `cuttle suggest`, then `cuttle preview --sheet` and look at it.
5. Scan stills for private data (names, emails, tokens, file paths with user names, hook errors) and
   add masks.
6. `cuttle render`, check a sheet of the result, send the file.
```

with:

```markdown
`SKILL.md` (frontmatter `name: cuttle` and a description of when to use it: requests to record a
demo, a screencast or screen recording, a launch or product video, or to edit a cuttle project)
and `project.md` (the `cuttle.json` reference it links) are copied into Claude Code's personal
skills by `pnpm skill:install`, with the repository's path filled in. It also works as `/cuttle`.
Workflow:

1. `cuttle --version` (when it is missing, ask the user for `pnpm cli:install`). Agree the
   scenario, the screen, the output format and a project folder with the user; ask for large text
   and a clean screen.
2. `cuttle devices`, pick the monitor or window.
3. Start `cuttle record` in the background before the user acts, stopped by `--until-claude` for
   agent demos or `--until-file` (Claude creates the file when the user is done), with `--max` as a
   safety net; tell the user to start once it prints `recording takes/<n>`.
4. `cuttle suggest`, then `cuttle preview` and look at the sheet.
5. Scan stills for private data (names, emails, tokens, file paths with user names, hook errors)
   and add masks, reading their rects off `cuttle frame <source second> --grid`; refine zooms, the
   look, cards and captions.
6. `cuttle render` (in the background for long takes) and tell the user the file's path.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/2026-10-16-cuttle-phase1-roadmap.md docs/superpowers/specs/2026-10-16-cuttle-design.md
git commit -m "docs: the skill and cuttle frame in the README, roadmap and spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

- [ ] **Step 1: All tests, twice**

Run: `pnpm test`
Expected: PASS, `Test Files  41 passed | 2 skipped (43)` and `Tests  364 passed | 5 skipped (369)` (skipped: the real-capture test and the four Electron checks, which run with `pnpm cli:check`).

Run: `pnpm test`
Expected: the same again.

- [ ] **Step 2: Typecheck and the Electron check**

Run: `pnpm typecheck`
Expected: exits with code 0 and prints the eight `tsc` commands.

Run: `pnpm cli:check`
Expected: PASS, 4 tests.

- [ ] **Step 3: Install the skill into a temp Claude folder**

```bash
CONFIG=$(cygpath -m "$(mktemp -d)")
CLAUDE_CONFIG_DIR="$CONFIG" pnpm skill:install
head -3 "$CONFIG/skills/cuttle/SKILL.md"
grep -c "{{REPO}}" "$CONFIG/skills/cuttle/SKILL.md"
CLAUDE_CONFIG_DIR="$CONFIG" pnpm skill:uninstall
ls "$CONFIG/skills"
rm -r "$CONFIG"
```

Expected: `installed the cuttle skill in …/skills/cuttle (…)` naming SKILL.md and project.md, the frontmatter's first lines (`---`, `name: cuttle`, `description: Records the screen …`), `0`, `removed the cuttle skill from …`, and an empty `skills` folder.

- [ ] **Step 4: Walk through the workflow with the test backend**

With the CLI built by Step 2, in a temp folder (as SKILL.md describes, with the hidden `--backend test`):

```text
cuttle --version
cuttle -C "<project>" record --backend test --monitor 0 --mic --until-file "<project>/stop" --max 60   (in the background)
   → wait for "recording takes/1", then create <project>/stop
cuttle -C "<project>" --json suggest
cuttle -C "<project>" --json preview                       → stills with t and source
cuttle -C "<project>" --json frame 3 --grid                → frames/3.00s-grid.png, labels: true
   (edit cuttle.json: a mask over the test pattern's timecode, a frame title, an end card)
cuttle -C "<project>" --json preview --at 3                → the mask hides the timecode
cuttle -C "<project>" --json render --format 16:9
```

Expected: the take stops by its file (`stopping (file)`), the grid frame has numbered lines, the masked still shows no timecode, and the render writes `out/16x9.mp4` with the take plus the 2 s card. (Done while planning: a 6.7 s take, 262 frames, 8.73 s.)

- [ ] **Step 5: By hand: a fresh Claude Code session**

For the user (Claude must not start Claude Code): run `pnpm cli:install` and `pnpm skill:install`, open a new Claude Code session in an empty folder and ask it to record a short demo of something on screen. It should check `cuttle --version`, agree the plan, start `cuttle record` in the background before asking you to act, cut with `suggest`, look at the sheet, mask what is private, and render.

- [ ] **Step 6: Nothing left behind**

```bash
git status --short
ls "$TEMP" | grep -E '^cuttle-(skill|cli|check)-' || echo "no temp folders left"
```

Expected: `git status` prints nothing, then `no temp folders left`.

---

## Spec coverage (M6 scope)

| Spec or roadmap item | Task |
|---|---|
| `skill/` → `~/.claude/skills/cuttle/` (`pnpm skill:install`) | 3, 5 |
| Current skill frontmatter (`name`, `description`) and the user-level folder (roadmap: verify first) | 3 (tested) |
| Workflow: scenario and format, devices, record before the user acts (`--until-claude`), suggest and preview, masks for private data, render | 3 |
| The treg lessons (no Claude Code started by Claude, record first, PowerShell commas, setting sources, X limits) | 3 |
| From M5: `--json`, background `record` and `render`, stop triggers Claude can use, `cuttle --version` and `pnpm cli:install` | 3 |
| Masks need source seconds and pixels: `preview`'s source seconds, `cuttle frame --grid` | 2 |
| Done criterion: the skill is written by `pnpm skill:install`; a fresh session follows it | 5 (the session by hand) |

## Open points for later phases

- **The fresh-session check** is the user's (Task 5, Step 5). Findings go into the skill as it is used.
- **macOS:** the grid's font paths are guessed for macOS and Linux (not tried there); without a font the grid has lines only.
- **The skill installs from the repo:** it points to the repo for `pnpm cli:install`, so moving the repo means installing both again. A packaged CLI and skill (an npm package or the desktop app) is phase 2.

## Changes during execution

The code blocks above are the original plan. Its tasks were executed by replaying the plan
mechanically (twice, on fresh clones; byte-identical to the prototype) and bringing those commits
in. Two reviews followed: one of the code, and one that read the skill as a fresh session would
and followed it with the `test` backend (devices, a background `record`, `suggest`, `preview`,
`frame --grid`, masks, cards, renders in 16:9 and 9:16, `capture-page`, `recover`). They found the
problems below. The repo is the source of truth.

- **The source second of a still (Task 2, code review).** `preview` computed it from the raw
  output second, but the page renders the frame that time falls in and holds a clip's last frame
  at its end. In a sped-up clip that is up to `speed / fps` source seconds off: 13.0 s instead of
  12.8 s at 12×, and 2.1 s off at 64×. A mask placed by it would sit on the wrong frame. The page
  now returns, for each still, the source second of the frame it rendered. Two new pure helpers in
  `@cuttle/export` do the work:
  - `stillFrames` snaps a time to its frame.
  - `shownSourceTime` takes the most visible layer, the front one in a crossfade's middle, with a
    tolerance for `0.15 / 0.3` being 0.4999….

  The CLI's own `sourceSecond` is gone. `frame-plan.test.ts` covers 12×, the crossfade and a card.
  The Electron check also checks a still on the page scene, which has no source second.
- **`frame` (Task 2, code review):**
  - A time inside the last frame (19.99 s of a 20 s take) made ffmpeg write nothing. The command
    reported success, and an older file at the same path passed for the new frame. Now the target
    is removed first, and a missing result is an error: `no frame starts at or after …`.
  - It writes with `-update 1`, so a `%d` in the path is not read as a frame-number pattern.
  - The font is looked up under `WINDIR`.
  - An ffmpeg without `drawtext` falls back to a grid with lines only.
  - A missing screen track is `missing-file`.
- **`record` (skill review):** after a stop by `--until-file`, the stop file is removed. Left in
  place, it made the next `record` fail, because the file must not exist at the start.
- **The installer (code review):**
  - It writes its marker before the files, so an install cut short can still be reinstalled or
    removed.
  - `{{REPO}}` is replaced through a function, so a `$&` in the path stays as it is.
  - Uninstall removes only plain `*.md` names from its own folder, whatever the marker lists.
- **The skill's tests (code review):**
  - Options standing alone in inline code (`` `--until-file …` ``) are checked against the help of
    every command.
  - A flag must match a whole option (`--until` no longer passes for `--until-file`).
  - A command's options end at `&&`, `;`, `|` or the next `cuttle`.
  - Each field's values are checked where that field is described, not anywhere in the file.
- **The idle test (code review):** besides the 1.95–5 s bounds, it checks the input's rest in
  screen seconds from events.jsonl: the take ends at least a second after the last input.
- **SKILL.md (skill review):**
  - Every recording has a stop file, and stopping means creating it, never killing the task. A
    killed take is cut off, and `cuttle.json` still points at the previous one; `recover` comes
    first then.
  - It gives a recipe for waiting until `recording takes/<n>` appears (`until grep …`, about 40 s).
  - It warns that `--until-claude` on one's own folder ends at one's own next turn.
  - The privacy pass is thorough: step through sped-up stretches, find a secret's first and last
    second with `frame` and pad 0.5 s, mask each position of scrolling text, check each mask at
    its start, middle and end, and look at captured pages yourself (masks cover clips only).
  - Durations over sped-up clips are in source seconds.
  - `suggest` replaces clips and zooms, so run it before hand edits.
  - The project path is absolute (`"$HOME/…"`; a quoted `~` stays literal).
  - 9:16 needs a narrow source or tight zooms; preview it first.
  - Capture pages before adding the end card.
  - Each `preview` run replaces `preview/` (use `-o` to keep a set).
  - Errors name fields from 0 (`scenes[1].to`).
- **project.md (skill review):**
  - Durations over sped-up clips: a 3 s caption over 12× needs `"duration": 36`.
  - The zoom's ramp is in output seconds.
  - Masks cover clips only.
  - The example's caption moved to the bottom, because a `top` pill covered the frame title.
  - It notes that a clip must end inside the take.
