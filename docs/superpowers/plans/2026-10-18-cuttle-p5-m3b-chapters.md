# Cuttle P5-M3b: Chapters from the Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each step of the script becomes a chapter of the video:
- **In the MP4 itself**, which players list (VLC, QuickTime, `ffprobe -show_chapters`).
- **As lines for a YouTube description** (`0:00 Open the settings`), from `cuttle chapters` and from the export sheet's Copy button, with a note when YouTube would not show them.

**Architecture:**
- **`@cuttle/timeline`:** `stepChapters` turns the take's `step` markers into chapters in output seconds, named by the steps' titles. `youtubeChapters` writes the lines and says what YouTube would object to.
- **`@cuttle/export`:** the export writes the chapters as an ffmetadata file, which the last ffmpeg step (the one that adds the sound) maps into the MP4. `ExportResult.chapters` lists them.
- **The CLI:** `cuttle chapters` gives the chapters and their YouTube lines; `cuttle render` says how many it wrote.
- **The app:** the export sheet says how many chapters the video gets, and after the export lists them with "Copy for YouTube".

**Tech Stack:** TypeScript strict, ffmpeg (ffmetadata, `-map_chapters`), React 19, Electron 44.7.2.

Spec: `docs/superpowers/specs/2026-10-17-cuttle-roadmap-p4-p6.md` (P5-M3: "Each step becomes a chapter, a caption and a zoom point; a step may name a motion template for its title"). This milestone makes the chapters; P5-M3c the captions, zoom points and motion titles. Previous milestone: `docs/superpowers/plans/2026-10-18-cuttle-p5-m3a-script-prompter.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p5-m3b`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The full `pnpm test` and the typecheck run in Task 5.

## Decisions made while planning

A prototype of the milestone, checked against the roadmap, settled these points. The finished prototype passed `pnpm test` (925 tests, 77 skipped, in two full runs), the typecheck, `app:check` (56 tests) and `cli:check` (15). Every screenshot was looked at.

- **The chapters are not stored,** but come from the take's `step` markers and the script each time:
  - A title fixed in the script renames its chapter, and an edit of the scenes moves them.
  - A step no longer in the script makes none.
- **Where a chapter starts:**
  - At the first output second at which a clip shows the moment the take reached its step.
  - A moment the video leaves out (trimmed at the start, or cut) starts the chapter where the video goes on: the clip that shows the take's next moment. Of several steps reached in such a stretch, the last is the one the video shows from there.
  - The first chapter starts at 0, with whatever comes before the first clip (an intro card, a motion title).
  - Each ends where the next begins, the last at the end of the scenes.
- **Slips are left out:**
  - A move that the next one undoes within 2 s (the step key pressed too early, then back) makes no chapter. The step begins where the take moved on again.
  - A step reached again later on purpose starts a chapter again.
  - A step shown before the chapter in front of it (clips put in another order) makes none, as chapters must follow each other.
- **YouTube's rules are told, not enforced:**
  - YouTube reads chapters from a description: the first at 0:00, at least three, each 10 s or longer.
  - `youtubeChapters` writes the lines in whole seconds (`0:12`, `1:02:05`), and lists what YouTube would object to. The chapters stay as they are: the video file keeps every one.
- **The MP4's chapters come from ffmpeg:**
  - The export writes them as an ffmetadata file (milliseconds; `=`, `;`, `#`, `\` and line breaks escaped).
  - The ffmpeg step that adds the sound maps it in (`-map_chapters`, the last input), so nothing is encoded again.
  - A project without a script, or a take that reached none of its steps, gets none.
- **The export sheet** says before the export how many chapters the video gets ("3 from the script, in the video file"). After it, it lists them as YouTube's lines with "Copy for YouTube" and the note.
  - In the check, Copy never touches this computer's clipboard: the main process keeps the text for the check to read, as the login item does.

## File structure

| File | Responsibility |
|---|---|
| `packages/timeline/src/{chapters,index}.ts` | the chapters, YouTube's lines |
| `packages/export/src/{chapters,audio}.ts`, `packages/export/src/main/export.ts` | the chapters in the MP4 |
| `apps/cli/src/commands/{chapters,render}.ts`, `apps/cli/src/main.ts` | `cuttle chapters`, `render`'s line |
| `apps/desktop/src/shared/{ipc,channels}.ts`, `apps/desktop/src/main/{export-service,windows}.ts`, `apps/desktop/src/renderer/editor/ExportSheet.tsx`, `apps/desktop/src/renderer/editor/editor.css` | the export sheet's chapters, Copy |
| `README.md`, `skill/cuttle/{SKILL,project}.md`, `skill/test/skill.test.ts` | the guides |

---

### Task 1: The chapters from the step markers

**Files:**
- Create: `packages/timeline/src/chapters.ts`, `packages/timeline/test/chapters.test.ts`
- Modify: `packages/timeline/src/index.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p5-m3b`; work there:

```bash
git switch p5-m3b
```

- [ ] **Step 2: Write the failing tests**

`packages/timeline/test/chapters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProject, type CuttleProjectInput, type Marker } from '@cuttle/project';
import { chapterTime, stepChapters, youtubeChapters } from '../src/chapters';
import { sceneSpans } from '../src/time';

const script = [
  { id: 'step1', title: 'Open the settings' },
  { id: 'step2', title: 'Turn on dark mode' },
  { id: 'step3', title: 'Export the video' },
];
const project = (rest: Partial<CuttleProjectInput>) => {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, script, ...rest });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
};
const at = (...moves: [number, string][]): Marker[] => moves.map(([t, label]) => ({ t, kind: 'step', label }));
const chaptersOf = (rest: Partial<CuttleProjectInput>, markers: Marker[]) => {
  const p = project(rest);
  return stepChapters(p.script, markers, sceneSpans(p.scenes, p.cuts));
};

describe('stepChapters', () => {
  it('starts a chapter where the take reached each step, in output seconds, the first at 0 and the last to the end', () => {
    // an intro card, the take trimmed at the start and sped up in the middle
    const scenes = [
      { type: 'card' as const, title: 'Hi', duration: 2 },
      { type: 'clip' as const, from: 1, to: 20 },
      { type: 'clip' as const, from: 20, to: 50, speed: 3 },
    ];
    expect(chaptersOf({ scenes }, at([0, 'step1'], [12, 'step2'], [35, 'step3']))).toEqual([
      { at: 0, end: 13, title: 'Open the settings', step: 'step1' },
      { at: 13, end: 26, title: 'Turn on dark mode', step: 'step2' },
      { at: 26, end: 31, title: 'Export the video', step: 'step3' },
    ]);
  });

  it('leaves out a move undone right away, and starts a chapter again for a step reached again later', () => {
    const scenes = [{ type: 'clip' as const, from: 0, to: 60 }];
    // the key pressed too early at 20 and undone at 21 (step 3 begins at 22), and back to step 2 on purpose at 40
    const markers = at([0, 'step1'], [10, 'step2'], [20, 'step3'], [21, 'step2'], [22, 'step3'], [40, 'step2'], [50, 'step3']);
    expect(chaptersOf({ scenes }, markers).map((chapter) => [chapter.at, chapter.step])).toEqual([
      [0, 'step1'],
      [10, 'step2'],
      [22, 'step3'],
      [40, 'step2'],
      [50, 'step3'],
    ]);
  });

  it('starts a step the video leaves out where it goes on, the last of several there; a step the script lost makes none', () => {
    const scenes = [{ type: 'clip' as const, from: 0, to: 60 }];
    // 8 to 30 is cut: steps 2 and 3 both begin there, and the video shows step 3 from 8 on
    expect(chaptersOf({ scenes, cuts: [{ from: 8, to: 30 }] }, at([0, 'step1'], [10, 'step2'], [20, 'step3'], [45, 'step9'])).map((chapter) => [chapter.at, chapter.step])).toEqual([
      [0, 'step1'],
      [8, 'step3'],
    ]);
    expect(chaptersOf({ scenes }, [])).toEqual([]);
    // a script without the take's steps: no chapters
    expect(chaptersOf({ scenes, script: [] }, at([0, 'step1']))).toEqual([]);
  });
});

describe('youtubeChapters', () => {
  it('writes a line per chapter, and says when YouTube would not show them', () => {
    const chapters = [
      { at: 0, end: 12.5, title: 'Open the settings', step: 'step1' },
      { at: 12.5, end: 19, title: 'Turn on dark mode', step: 'step2' },
      { at: 19, end: 3725, title: 'Export the video', step: 'step3' },
    ];
    expect(youtubeChapters(chapters)).toEqual({
      text: '0:00 Open the settings\n0:12 Turn on dark mode\n0:19 Export the video',
      problems: ['YouTube needs each chapter to last 10 s or more; shorter: “Turn on dark mode” (6.5 s).'],
    });
    expect(youtubeChapters(chapters.slice(0, 1)).problems[0]).toBe('YouTube shows chapters from 3 on; this video has 1.');
    expect([chapterTime(0), chapterTime(65.9), chapterTime(3725)]).toEqual(['0:00', '1:05', '1:02:05']);
  });
});
```

Run: `pnpm exec vitest run --project node packages/timeline/test/chapters.test.ts`
Expected: FAIL: there is no `../src/chapters`.

- [ ] **Step 3: The chapters, YouTube's lines**

`packages/timeline/src/chapters.ts`:

```ts
// The video's chapters from the script: where the take reached each step (its `step` markers), in
// output seconds, named by the step's title. Pure: the export writes them into the video file, the
// CLI and the editor list them as YouTube reads them in a description.
import type { Marker, ScriptStep } from '@cuttle/project';
import { totalDuration, type SceneSpan } from './time';

/** A chapter: from `at` to `end` (output seconds), named after a step of the script (`step`, its id). */
export interface Chapter {
  at: number;
  end: number;
  title: string;
  step: string;
}

/** A move to a step undone within this many seconds (the step key pressed by mistake, then back) is no chapter. */
export const CHAPTER_SLIP_SECONDS = 2;

/**
 * What YouTube asks of a description's chapters: the first at 0:00 (the chapters here always start
 * there), at least three, each this long or longer.
 */
export const YOUTUBE_CHAPTERS = { least: 3, seconds: 10 } as const;

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * The first output second at which a clip shows source second `t`; for a moment the video leaves
 * out (trimmed or cut), where it goes on: the start of the clip that shows the take's next moment.
 */
function shownAt(spans: readonly SceneSpan[], t: number): number | undefined {
  let next: { from: number; start: number } | undefined;
  for (const span of spans) {
    if (span.scene.type !== 'clip') continue;
    const { from, to, speed } = span.scene;
    if (t >= from && t < to) return span.start + (t - from) / speed;
    if (from > t && (!next || from < next.from)) next = { from, start: span.start };
  }
  return next?.start;
}

/**
 * The chapters of a video from the take's `step` markers: one where the take reached each step,
 * named by the step's title. A move undone right away is left out; a step reached again later (after
 * another) starts a chapter again. The first chapter starts at 0, with what comes before the first
 * clip; each ends where the next begins, the last at the video's end. A step no longer in the
 * script makes none, nor does one shown no earlier than the chapter before it.
 */
export function stepChapters(script: readonly ScriptStep[], markers: readonly Marker[], spans: readonly SceneSpan[]): Chapter[] {
  const moves = markers.filter((marker) => marker.kind === 'step' && marker.label !== undefined).sort((a, b) => a.t - b.t);
  // a slip: a move that the next one undoes (back to the step before it) within the slip time
  for (let i = 1; i + 1 < moves.length; ) {
    if (moves[i + 1]!.label === moves[i - 1]!.label && moves[i + 1]!.t - moves[i]!.t < CHAPTER_SLIP_SECONDS) moves.splice(i, 2);
    else i++;
  }
  const starts: Omit<Chapter, 'end'>[] = [];
  for (const move of moves) {
    const step = script.find((item) => item.id === move.label);
    const at = step && shownAt(spans, move.t);
    if (!step || at === undefined) continue;
    const last = starts.at(-1);
    if (last?.step === step.id) continue;
    // steps reached in a stretch the video leaves out start where it goes on: the last of them is what it shows
    if (last && round(at) === last.at) starts.pop();
    else if (last && at < last.at) continue;
    starts.push({ at: starts.length === 0 ? 0 : round(at), title: step.title, step: step.id });
  }
  const duration = totalDuration(spans);
  return starts.map((start, i) => ({ ...start, end: starts[i + 1]?.at ?? round(duration) })).filter((chapter) => chapter.end > chapter.at);
}

/** A chapter's start as YouTube writes it: `0:00`, `12:05`, `1:02:03` (whole seconds, rounded down). */
export function chapterTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  const two = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** The chapters as lines for a YouTube description (`0:00 Open the settings`), and why YouTube would not show them. */
export function youtubeChapters(chapters: readonly Chapter[]): { text: string; problems: string[] } {
  const problems: string[] = [];
  if (chapters.length < YOUTUBE_CHAPTERS.least) problems.push(`YouTube shows chapters from ${YOUTUBE_CHAPTERS.least} on; this video has ${chapters.length}.`);
  const short = chapters.filter((chapter) => chapter.end - chapter.at < YOUTUBE_CHAPTERS.seconds);
  if (short.length > 0) {
    problems.push(`YouTube needs each chapter to last ${YOUTUBE_CHAPTERS.seconds} s or more; shorter: ${short.map((chapter) => `“${chapter.title}” (${Math.round((chapter.end - chapter.at) * 10) / 10} s)`).join(', ')}.`);
  }
  return { text: chapters.map((chapter) => `${chapterTime(chapter.at)} ${chapter.title}`).join('\n'), problems };
}
```

In `packages/timeline/src/index.ts`, replace:

```ts
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
```

with:

```ts
  type SceneSpan,
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { CHAPTER_SLIP_SECONDS, YOUTUBE_CHAPTERS, chapterTime, stepChapters, youtubeChapters, type Chapter } from './chapters';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
```

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline
git commit -m "timeline: chapters from the take's step markers, and YouTube's lines for them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The chapters in the MP4

**Files:**
- Create: `packages/export/src/chapters.ts`, `packages/export/test/main/chapters.test.ts`
- Modify: `packages/export/src/audio.ts`, `packages/export/src/main/export.ts`, `packages/export/test/audio.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/export/test/main/chapters.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chapterMetadata } from '../../src/chapters';

const dir = mkdtempSync(join(tmpdir(), 'cuttle-chapters-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const chapters = [
  { at: 0, end: 12.5, title: 'Open the settings', step: 'step1' },
  { at: 12.5, end: 30, title: 'Size = 2; #1 \\ more', step: 'step2' },
];

describe('chapterMetadata', () => {
  it('writes each chapter in milliseconds, its title escaped', () => {
    expect(chapterMetadata(chapters)).toBe(
      [';FFMETADATA1', '[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'END=12500', 'title=Open the settings', '[CHAPTER]', 'TIMEBASE=1/1000', 'START=12500', 'END=30000', 'title=Size \\= 2\\; \\#1 \\\\ more', ''].join('\n'),
    );
  });

  it('is what ffmpeg puts into an MP4 as its chapters', () => {
    const meta = join(dir, 'chapters.txt');
    const out = join(dir, 'video.mp4');
    writeFileSync(meta, chapterMetadata(chapters));
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=30', '-i', meta, '-map', '0:v:0', '-map_chapters', '1', '-c:v', 'libx264', '-preset', 'ultrafast', out], { encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', out], { encoding: 'utf8' });
    const read = (JSON.parse(probe.stdout) as { chapters: { start_time: string; end_time: string; tags: { title: string } }[] }).chapters;
    expect(read.map((chapter) => [Number(chapter.start_time), Number(chapter.end_time), chapter.tags.title])).toEqual([
      [0, 12.5, 'Open the settings'],
      [12.5, 30, 'Size = 2; #1 \\ more'],
    ]);
  });
});
```

In `packages/export/test/audio.test.ts`, replace:

```ts
    expect(muxArgs({ video: 'v.mp4', sound: 's.wav', graph: 'G', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i s.wav -filter_complex G');
  });

  it('reads a long graph from a file (Windows limits a command line to 32 767 characters)', () => {
    const args = muxArgs({ video: 'v.mp4', mic: 'm.m4a', graph: 'G', graphFile: 'audio.graph', out: 'o.mp4' });
    expect(args.join(' ')).toContain('-/filter_complex audio.graph -map 0:v:0');
```

with:

```ts
    expect(muxArgs({ video: 'v.mp4', sound: 's.wav', graph: 'G', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i s.wav -filter_complex G');
  });

  it('takes the chapters from their metadata file, the input after the sound', () => {
    expect(muxArgs({ video: 'v.mp4', mic: 'm.m4a', sound: 's.wav', graph: 'G', chapters: 'c.txt', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i m.m4a -i s.wav -i c.txt -filter_complex G -map 0:v:0 -map [aout] -map_chapters 3 -c:v copy');
    expect(muxArgs({ video: 'v.mp4', graph: 'G', chapters: 'c.txt', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i c.txt -filter_complex G -map 0:v:0 -map [aout] -map_chapters 1 -c:v copy');
  });

  it('reads a long graph from a file (Windows limits a command line to 32 767 characters)', () => {
    const args = muxArgs({ video: 'v.mp4', mic: 'm.m4a', graph: 'G', graphFile: 'audio.graph', out: 'o.mp4' });
    expect(args.join(' ')).toContain('-/filter_complex audio.graph -map 0:v:0');
```

Run: `pnpm exec vitest run --project node packages/export/test/main/chapters.test.ts packages/export/test/audio.test.ts`
Expected: FAIL: there is no `../../src/chapters`, and `muxArgs` takes no chapters.

- [ ] **Step 2: The metadata file, mapped in with the sound**

`packages/export/src/chapters.ts`:

```ts
// The video's chapters in the MP4 itself, as ffmpeg reads them from a metadata file: players list
// them (VLC, QuickTime, `ffprobe -show_chapters`). YouTube reads its chapters from the description.
import type { Chapter } from '@cuttle/timeline';

/** A value in an ffmetadata file: `=`, `;`, `#`, `\` and line breaks escaped with a backslash. */
const escape = (value: string) => value.replace(/[=;#\\\n]/g, (char) => `\\${char}`);

/** The chapters as an ffmetadata file, in milliseconds. */
export function chapterMetadata(chapters: readonly Chapter[]): string {
  const ms = (seconds: number) => Math.round(seconds * 1000);
  return [';FFMETADATA1', ...chapters.flatMap((chapter) => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${ms(chapter.at)}`, `END=${ms(chapter.end)}`, `title=${escape(chapter.title)}`]), ''].join('\n');
}
```

In `packages/export/src/audio.ts`, replace:

```ts
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
  out: string;
}

/** ffmpeg arguments that add the audio to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, typing, sound, graph, graphFile, out }: MuxArgsOptions): string[] {
  return [
    '-hide_banner',
    '-nostdin',
```

with:

```ts
  graph: string;
  /** A file holding `graph`, used instead of the inline graph when given. */
  graphFile?: string;
  /** The chapters as an ffmetadata file (the last input), when the video has any. */
  chapters?: string;
  out: string;
}

/** ffmpeg arguments that add the audio (and the chapters) to the video without re-encoding it: AAC 48 kHz, moov at the front. */
export function muxArgs({ video, mic, typing, sound, graph, graphFile, chapters, out }: MuxArgsOptions): string[] {
  const inputs = 1 + [mic, typing, sound].filter((input) => input !== undefined).length;
  return [
    '-hide_banner',
    '-nostdin',
```

In the same file, replace:

```ts
    ...(mic ? ['-i', mic] : []),
    ...(typing ? ['-i', typing] : []),
    ...(sound ? ['-i', sound] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
```

with:

```ts
    ...(mic ? ['-i', mic] : []),
    ...(typing ? ['-i', typing] : []),
    ...(sound ? ['-i', sound] : []),
    ...(chapters ? ['-i', chapters] : []),
    ...(graphFile ? ['-/filter_complex', graphFile] : ['-filter_complex', graph]),
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    ...(chapters ? ['-map_chapters', String(inputs)] : []),
    '-c:v',
    'copy',
    '-c:a',
```

In `packages/export/src/main/export.ts`, replace:

```ts
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt, typingClicks } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageStillsSuccess, type PageSuccess } from '../job';
```

with:

```ts
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, stepChapters, toSrt, toVtt, typingClicks, type Chapter } from '@cuttle/timeline';
import { app } from 'electron';
import { INLINE_GRAPH_LIMIT, audioFilterGraph, muxArgs, planAudio } from '../audio';
import { chapterMetadata } from '../chapters';
import { ExportError } from '../errors';
import { withFormat, type ExportFormat } from '../formats';
import { CHANNELS, type EncoderPreference, type ExportJob, type PageResult, type PageStillsSuccess, type PageSuccess } from '../job';
```

In the same file, replace:

```ts
  seconds: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  /** The music and sounds, when the project has any: what the page made and said, and sounds that could not play. */
```

with:

```ts
  seconds: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
  /** The chapters in the video file, from the script's steps (`stepChapters`), when it has any. */
  chapters?: Chapter[];
  /** What the motion items' pages said (errors and console), when the project has any. */
  motion?: MotionItemReport[];
  /** The music and sounds, when the project has any: what the page made and said, and sounds that could not play. */
```

In the same file, replace:

```ts
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0, 1, typing ? extra : undefined, sound ? extra : undefined);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, typing, sound, graph, graphFile, out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
```

with:

```ts
    const graph = audioFilterGraph(segments, sources.mic?.offset ?? 0, 1, typing ? extra : undefined, sound ? extra : undefined);
    const graphFile = graph.length > INLINE_GRAPH_LIMIT ? join(work, 'audio.graph') : undefined;
    if (graphFile) await writeFile(graphFile, graph);
    // the script's steps as the video's chapters, where the take reached them
    const chapters = stepChapters(project.script, take.markers, spans);
    const chapterFile = chapters.length > 0 ? join(work, 'chapters.txt') : undefined;
    if (chapterFile) await writeFile(chapterFile, chapterMetadata(chapters));
    await runFfmpeg(muxArgs({ video, mic: usesMic ? sources.mic?.path : undefined, typing, sound, graph, graphFile, ...(chapterFile && { chapters: chapterFile }), out: partial }), signal);
    throwIfCancelled();
    try {
      await rename(partial, out);
```

In the same file, replace:

```ts
      frames: page.frames,
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      ...(said && { motion: said }),
      ...(musicReport && { music: musicReport }),
      stats: {
```

with:

```ts
      frames: page.frames,
      seconds,
      ...(written.length > 0 && { subtitles: written }),
      ...(chapters.length > 0 && { chapters }),
      ...(said && { motion: said }),
      ...(musicReport && { music: musicReport }),
      stats: {
```

Run: `pnpm exec vitest run --project node packages/export`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/export
git commit -m "export: the script's steps as the MP4's chapters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `cuttle chapters`, and `render`'s line

**Files:**
- Create: `apps/cli/src/commands/chapters.ts`
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/commands/render.ts`, `apps/cli/test/cli.test.ts`, `apps/cli/test/electron.check.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/cli/test/cli.test.ts`, replace:

```ts
  });
});

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
```

with:

```ts
  });
});

describe('cuttle chapters', () => {
  it("lists the video's chapters from the script's steps, as a YouTube description has them", async () => {
    const dir = temp();
    takeFixture(dir);
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect((await cli('-C', dir, 'chapters')).stdout).toBe('no chapters: the project has no script ("script" in cuttle.json)\n');
    writeFileSync(join(dir, 'takes', '1', 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 0, kind: 'step', label: 'step1' }, { t: 3.5, kind: 'step', label: 'step2' }, { t: 6, kind: 'step', label: 'step3' }] }));
    writeFileSync(
      path,
      JSON.stringify({
        ...raw,
        sources: { ...raw.sources, markers: 'takes/1/markers.json' },
        script: [{ id: 'step1', title: 'Open the settings' }, { id: 'step2', title: 'Turn on dark mode' }, { id: 'step3', title: 'Export the video' }],
        // the take from 0.5 s on: step 2 shows at 3 s of the video, step 3 at 5.5 s
        scenes: [{ type: 'clip', from: 0.5, to: 8 }],
      }),
    );
    const { code, json } = await cli('--json', '-C', dir, 'chapters');
    expect(code).toBe(0);
    expect(json).toEqual({
      chapters: [
        { at: 0, end: 3, title: 'Open the settings', step: 'step1' },
        { at: 3, end: 5.5, title: 'Turn on dark mode', step: 'step2' },
        { at: 5.5, end: 7.5, title: 'Export the video', step: 'step3' },
      ],
      youtube: '0:00 Open the settings\n0:03 Turn on dark mode\n0:05 Export the video',
      problems: ['YouTube needs each chapter to last 10 s or more; shorter: “Open the settings” (3 s), “Turn on dark mode” (2.5 s), “Export the video” (2 s).'],
    });
    expect((await cli('-C', dir, 'chapters')).stdout).toBe(
      '0:00 Open the settings\n0:03 Turn on dark mode\n0:05 Export the video\nnote: YouTube needs each chapter to last 10 s or more; shorter: “Open the settings” (3 s), “Turn on dark mode” (2.5 s), “Export the video” (2 s).\n',
    );
  });
});

describe('cuttle suggest and recover', () => {
  let fixture: string;
  beforeAll(() => {
```

In `apps/cli/test/electron.check.test.ts`, replace:

```ts
    }
  }, 240_000);

  it('checks a motion page: each way it moves lands on the frame, the same on every run, and it says nothing', () => {
    mkdirSync(join(project, 'motion', 'check'), { recursive: true });
    copyFileSync(MOTION_PAGE, join(project, 'motion', 'check', 'index.html'));
```

with:

```ts
    }
  }, 240_000);

  it("writes the script's steps into the video as its chapters, where the take reached them", () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as { sources: Record<string, string> };
    const markersFile = join(project, raw.sources.markers!);
    const markers = readFileSync(markersFile, 'utf8');
    writeFileSync(markersFile, JSON.stringify({ version: 1, markers: [{ t: 0, kind: 'step', label: 'step1' }, { t: 1.5, kind: 'step', label: 'step2' }] }));
    writeFileSync(file, JSON.stringify({ ...raw, script: [{ id: 'step1', title: 'Open the settings' }, { id: 'step2', title: 'Turn on dark mode' }] }));
    try {
      const out = join(project, 'out', 'chapters.mp4');
      const { code, json } = cuttle('-C', project, 'render', '-o', out);
      expect(code).toBe(0);
      const seconds = json.seconds as number;
      expect(json.chapters).toEqual([
        { at: 0, end: 1.5, title: 'Open the settings', step: 'step1' },
        // to the end of the scenes (the video's own length is whole frames)
        { at: 1.5, end: expect.closeTo(seconds, 1), title: 'Turn on dark mode', step: 'step2' },
      ]);
      const chapters = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', out], { encoding: 'utf8' }).stdout) as { chapters: { start_time: string; tags: { title: string } }[] };
      expect(chapters.chapters.map((chapter) => [Number(chapter.start_time), chapter.tags.title])).toEqual([
        [0, 'Open the settings'],
        [1.5, 'Turn on dark mode'],
      ]);
    } finally {
      writeFileSync(file, before);
      writeFileSync(markersFile, markers);
    }
  }, 120_000);

  it('checks a motion page: each way it moves lands on the frame, the same on every run, and it says nothing', () => {
    mkdirSync(join(project, 'motion', 'check'), { recursive: true });
    copyFileSync(MOTION_PAGE, join(project, 'motion', 'check', 'index.html'));
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t "chapters"`
Expected: FAIL: there is no command `chapters`.

- [ ] **Step 2: The command**

`apps/cli/src/commands/chapters.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readProjectFile } from '@cuttle/core';
import { parseMarkersJson } from '@cuttle/project';
import { sceneSpans, stepChapters, youtubeChapters, type Chapter } from '@cuttle/timeline';
import type { Output } from '../output';

export interface ChaptersView {
  /** Output seconds, as the export writes them into the video file. */
  chapters: Chapter[];
  /** The lines for a YouTube description (`0:00 Open the settings`). */
  youtube: string;
  /** Why YouTube would not show them: fewer than three, or one shorter than 10 s. */
  problems: string[];
}

/**
 * `cuttle chapters`: the video's chapters from the script's steps (where the take reached each one),
 * as the export writes them into the MP4, and as lines for a YouTube description.
 */
export async function chaptersCommand(projectDir: string, output: Output): Promise<ChaptersView> {
  const file = await readProjectFile(projectDir);
  const { script, sources, scenes, cuts } = file.project;
  const text = sources.markers === undefined ? undefined : await readFile(resolve(file.dir, sources.markers), 'utf8').catch(() => undefined);
  const parsed = text === undefined ? undefined : parseMarkersJson(text);
  const chapters = stepChapters(script, parsed?.ok ? parsed.markers : [], sceneSpans(scenes, cuts));
  const { text: youtube, problems } = youtubeChapters(chapters);
  const view: ChaptersView = { chapters, youtube, problems };
  output.result(view, () => {
    if (chapters.length > 0) return [youtube, ...problems.map((problem) => `note: ${problem}`)].join('\n');
    return script.length === 0 ? 'no chapters: the project has no script ("script" in cuttle.json)' : "no chapters: the take reached none of the script's steps (record a take with the script)";
  });
  return view;
}
```

In `apps/cli/src/main.ts`, replace:

```ts
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
import { renderCommand } from './commands/render';
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
```

with:

```ts
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
import { renderCommand } from './commands/render';
import { chaptersCommand } from './commands/chapters';
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
```

In the same file, replace:

```ts
    .option('--text', 'the words as plain text')
    .action(action((output, project, options: { srt?: boolean; vtt?: boolean; text?: boolean }) => transcriptCommand(project, options, output)));

  program
    .command('recover <take>')
    .description('make a take usable after a crash (e.g. takes/3) and use it')
```

with:

```ts
    .option('--text', 'the words as plain text')
    .action(action((output, project, options: { srt?: boolean; vtt?: boolean; text?: boolean }) => transcriptCommand(project, options, output)));

  program
    .command('chapters')
    .description("the video's chapters from the script's steps: as the export writes them into the MP4, and as lines for a YouTube description")
    .action(action((output, project) => chaptersCommand(project, output)));

  program
    .command('recover <take>')
    .description('make a take usable after a crash (e.g. takes/3) and use it')
```

In `apps/cli/src/commands/render.ts`, replace:

```ts
  seconds: number;
  /** Subtitle files written next to it (`--srt`, `--vtt`). */
  subtitles?: string[];
  stats: { gpu: string; codec: string; hardwareAcceleration: string; bitrate: number; totalMs: number } & Record<string, unknown>;
}
```

with:

```ts
  seconds: number;
  /** Subtitle files written next to it (`--srt`, `--vtt`). */
  subtitles?: string[];
  /** The chapters in the video file, from the script's steps (output seconds). */
  chapters?: { at: number; end: number; title: string; step: string }[];
  stats: { gpu: string; codec: string; hardwareAcceleration: string; bitrate: number; totalMs: number } & Record<string, unknown>;
}
```

In the same file, replace:

```ts
    [
      `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`,
      ...(result.subtitles ?? []).map((path) => `subtitles: ${path}`),
    ].join('\n'),
  );
  return result;
```

with:

```ts
    [
      `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`,
      ...(result.subtitles ?? []).map((path) => `subtitles: ${path}`),
      ...(result.chapters ? [`chapters: ${result.chapters.length} in the video (cuttle chapters lists them for a YouTube description)`] : []),
    ].join('\n'),
  );
  return result;
```

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts`
Expected: PASS.

Run: `pnpm cli:check`
Expected: PASS, 15 tests (the render writes the chapters into the MP4).

- [ ] **Step 3: Commit**

```bash
git add apps/cli
git commit -m "cli: cuttle chapters, the chapters as lines for a YouTube description; render says how many it wrote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The chapters in the export sheet

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/main/export-service.ts`, `apps/desktop/src/main/windows.ts`, `apps/desktop/src/renderer/editor/ExportSheet.tsx`, `apps/desktop/src/renderer/editor/editor.css`, `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The file's chapters, and Copy**

In `apps/desktop/src/shared/ipc.ts`, replace:

```ts
// their window's channels.
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { ID_PATTERN, SCRIPT_MAX_STEPS, STEP_NOTE_MAX, STEP_TITLE_MAX } from '@cuttle/project';
import type { LengthReport } from './media-jobs';
```

with:

```ts
// their window's channels.
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import type { Chapter } from '@cuttle/timeline';
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { ID_PATTERN, SCRIPT_MAX_STEPS, STEP_NOTE_MAX, STEP_TITLE_MAX } from '@cuttle/project';
import type { LengthReport } from './media-jobs';
```

In the same file, replace:

```ts
  bytes: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
}

export type ExportEnd =
```

with:

```ts
  bytes: number;
  /** The subtitle files written next to it. */
  subtitles?: string[];
  /** The chapters in it, from the script's steps. */
  chapters?: Chapter[];
}

export type ExportEnd =
```

In the same file, replace:

```ts
  // editor
  'project:info': z.undefined(),
  'project:reveal': z.string().max(4096).optional(),
  'media:state': z.undefined(),
  'media:retry': z.undefined(),
  'export:targets': z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
```

with:

```ts
  // editor
  'project:info': z.undefined(),
  'project:reveal': z.string().max(4096).optional(),
  /** Text for the clipboard: the chapters for a YouTube description. */
  'export:copy': z.string().max(20_000),
  'media:state': z.undefined(),
  'media:retry': z.undefined(),
  'export:targets': z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
```

In the same file, replace:

```ts
export interface Responses {
  'project:info': ProjectInfo;
  'project:reveal': void;
  'media:state': MediaState;
  'media:retry': void;
  /** Where each format would be written, and when an export already there was made (epoch ms). */
```

with:

```ts
export interface Responses {
  'project:info': ProjectInfo;
  'project:reveal': void;
  'export:copy': void;
  'media:state': MediaState;
  'media:retry': void;
  /** Where each format would be written, and when an export already there was made (epoch ms). */
```

In `apps/desktop/src/shared/channels.ts`, replace:

```ts
    requests: [
      'project:info',
      'project:reveal',
      'media:state',
      'media:retry',
      'export:targets',
```

with:

```ts
    requests: [
      'project:info',
      'project:reveal',
      'export:copy',
      'media:state',
      'media:retry',
      'export:targets',
```

In `apps/desktop/src/main/export-service.ts`, replace:

```ts
            onProgress({ format, position, formats: formats.length, done, total, elapsed: (now - started) / 1000 });
          },
        });
        files.push({ format, out: result.out, seconds: result.seconds, bytes: (await stat(result.out)).size, ...(result.subtitles && { subtitles: result.subtitles }) });
      } catch (error) {
        if (error instanceof ExportError && error.code === 'cancelled') return { state: 'cancelled', files };
        const code = error instanceof ExportError ? error.code : 'internal';
```

with:

```ts
            onProgress({ format, position, formats: formats.length, done, total, elapsed: (now - started) / 1000 });
          },
        });
        files.push({ format, out: result.out, seconds: result.seconds, bytes: (await stat(result.out)).size, ...(result.subtitles && { subtitles: result.subtitles }), ...(result.chapters && { chapters: result.chapters }) });
      } catch (error) {
        if (error instanceof ExportError && error.code === 'cancelled') return { state: 'cancelled', files };
        const code = error instanceof ExportError ? error.code : 'internal';
```

In `apps/desktop/src/main/windows.ts`, replace:

```ts
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE, backupFile, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import { plainIssue } from '../shared/format';
```

with:

```ts
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu, screen, session, shell, type Session, type WebContents } from 'electron';
import { PROJECT_FILE, backupFile, writeProjectFile, type ProjectFile } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import { plainIssue } from '../shared/format';
```

In the same file, replace:

```ts
      if (!isInside(target, dir, process.platform)) throw new Error('only files inside the project can be shown');
      shell.showItemInFolder(target);
    },
    'media:state': () => media.current(),
    'media:retry': () => void media.start(),
    'export:targets': async (formats) =>
```

with:

```ts
      if (!isInside(target, dir, process.platform)) throw new Error('only files inside the project can be shown');
      shell.showItemInFolder(target);
    },
    // the check never touches this computer's clipboard: it keeps what was copied
    'export:copy': (text) => (CHECK ? void ((globalThis as { __copied?: string }).__copied = text) : clipboard.writeText(text)),
    'media:state': () => media.current(),
    'media:retry': () => void media.start(),
    'export:targets': async (formats) =>
```

- [ ] **Step 2: The export sheet**

In `apps/desktop/src/renderer/editor/ExportSheet.tsx`, replace:

```tsx
// The export sheet: formats (the project's own size first), encoder, which files it writes and what
// they replace, a check of things worth a second look, progress, cancel, and the files at the end.
// Closing it while an export runs keeps the export running (the title bar shows it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { formatBytes, formatDuration, formatTime } from '../../shared/format';
import type { ExportTarget } from '../../shared/ipc';
import { sceneSpans } from '@cuttle/timeline';
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
```

with:

```tsx
// The export sheet: formats (the project's own size first), encoder, which files it writes and what
// they replace, a check of things worth a second look, progress, cancel, and the files at the end
// with their chapters (from the script's steps) to copy into a YouTube description.
// Closing it while an export runs keeps the export running (the title bar shows it).
import { useEffect, useMemo, useRef, useState } from 'react';
import { EXPORT_FORMATS } from '@cuttle/export/formats';
import { formatBytes, formatDuration, formatTime } from '../../shared/format';
import type { ExportTarget } from '../../shared/ipc';
import { sceneSpans, stepChapters, youtubeChapters, type Chapter } from '@cuttle/timeline';
import { exportChecks } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';
```

In the same file, replace:

```tsx
  const started = useStore(store, (state) => state.exportStarted);
  const format = useStore(store, (state) => state.format);
  const project = useStore(store, (state) => state.doc?.project);
  const output = project?.output;
  const own = ownFormat(output);
  // The project's own size first; a preset of the same size would write the same video again.
```

with:

```tsx
  const started = useStore(store, (state) => state.exportStarted);
  const format = useStore(store, (state) => state.format);
  const project = useStore(store, (state) => state.doc?.project);
  const markers = useStore(store, (state) => state.media?.markers);
  const output = project?.output;
  const own = ownFormat(output);
  // The project's own size first; a preset of the same size would write the same video again.
```

In the same file, replace:

```tsx
  }, [open]);

  const checks = useMemo(() => (project ? exportChecks(project, sceneSpans(project.scenes, project.cuts)) : []), [project]);

  if (!open) return null;
```

with:

```tsx
  }, [open]);

  const checks = useMemo(() => (project ? exportChecks(project, sceneSpans(project.scenes, project.cuts)) : []), [project]);
  // the script's steps the take reached: the video's chapters
  const chapters = useMemo(() => (project ? stepChapters(project.script, markers ?? [], sceneSpans(project.scenes, project.cuts)) : []), [project, markers]);

  if (!open) return null;
```

In the same file, replace:

```tsx
                </span>
              </div>
            )}
            {files.length > 0 && (
              <div className="note" data-testid="export-note">
                Saves {files.map((file, i) => (
```

with:

```tsx
                </span>
              </div>
            )}
            {chapters.length > 0 && (
              <div className="row" data-testid="export-chapters">
                Chapters
                <span>
                  {chapters.length} from the script, in the video file
                </span>
              </div>
            )}
            {files.length > 0 && (
              <div className="note" data-testid="export-note">
                Saves {files.map((file, i) => (
```

In the same file, replace:

```tsx
                  <small>
                    {targetName(file.format, output)} · {formatDuration(file.seconds)} · {formatBytes(file.bytes)}
                    {file.subtitles && ` · with ${file.subtitles.map((path) => `.${path.split('.').at(-1)}`).join(' and ')}`}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
```

with:

```tsx
                  <small>
                    {targetName(file.format, output)} · {formatDuration(file.seconds)} · {formatBytes(file.bytes)}
                    {file.subtitles && ` · with ${file.subtitles.map((path) => `.${path.split('.').at(-1)}`).join(' and ')}`}
                    {file.chapters && ` · ${file.chapters.length} chapter${file.chapters.length === 1 ? '' : 's'}`}
                  </small>
                </div>
                <button className="ghost" onClick={() => void bridge.invoke('project:reveal', file.out)} title="Show in folder">
```

In the same file, replace:

```tsx
                </button>
              </div>
            ))}
            <div className="actions">
              {end.state === 'done' ? (
                <>
```

with:

```tsx
                </button>
              </div>
            ))}
            {end.files.some((file) => file.chapters) && <ChapterList chapters={end.files.find((file) => file.chapters)!.chapters!} />}
            <div className="actions">
              {end.state === 'done' ? (
                <>
```

In the same file, replace:

```tsx
    </div>
  );
}
```

with:

```tsx
    </div>
  );
}

/** The chapters an export wrote, as lines for a YouTube description, with a button that copies them and why YouTube would not show them. */
function ChapterList({ chapters }: { chapters: Chapter[] }) {
  const [copied, setCopied] = useState(false);
  const { text, problems } = youtubeChapters(chapters);
  const copy = () =>
    void bridge.invoke('export:copy', text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className="chapter-list" data-testid="export-chapter-list">
      <div className="chapter-head">
        <b>Chapters in the video</b>
        <button className="ghost" onClick={copy} title="Copy the lines for a YouTube description" data-testid="export-copy-chapters">
          {copied ? 'Copied' : 'Copy for YouTube'}
        </button>
      </div>
      <pre>{text}</pre>
      {problems.map((problem) => (
        <div key={problem} className="note">
          {problem}
        </div>
      ))}
    </div>
  );
}
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```css
  display: block;
  color: var(--muted);
}
.sheet .actions {
  display: flex;
  justify-content: flex-end;
```

with:

```css
  display: block;
  color: var(--muted);
}
/* the chapters an export wrote: the lines for a YouTube description, to copy */
.chapter-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border-radius: 9px;
  background: var(--raised);
  font-size: var(--size-s);
}
.chapter-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chapter-head b {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}
.chapter-list pre {
  margin: 0;
  max-height: 150px;
  overflow: auto;
  font: var(--size-s) / 1.6 var(--mono);
  color: var(--text);
  white-space: pre-wrap;
  user-select: text;
}
.sheet .actions {
  display: flex;
  justify-content: flex-end;
```

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 3: The check**

A fixture project with a script, whose take reached its three steps at 0, 2 and 9 s:
- the sheet says "3 from the script, in the video file";
- after the export, the file row counts 3 chapters, and the list reads YouTube's lines with the note;
- Copy is checked without the clipboard;
- `ffprobe` finds the chapters at 0, 2 and 4.125 s.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'looks · Cuttle')?.close());
  }, 120_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

with:

```ts
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'looks · Cuttle')?.close());
  }, 120_000);

  it("exports the script's steps as the video's chapters, and lists them to copy for a YouTube description", async () => {
    const dir = join(root, 'chapters');
    makeFixture(dir);
    // the take reached the steps at 0, 2 and 9 s: the video shows 9 s at 4.125 s (after 3 s at 1× and 5 s at 8×)
    writeFileSync(join(dir, 'takes', '1', 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 0, kind: 'step', label: 'step1' }, { t: 2, kind: 'step', label: 'step2' }, { t: 9, kind: 'step', label: 'step3' }] }));
    const path = join(dir, 'cuttle.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), script: [{ id: 'step1', title: 'Open the settings' }, { id: 'step2', title: 'Turn on dark mode' }, { id: 'step3', title: 'Export the video' }] }));
    const page = await openEditor(dir);
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-chapters]');
    expect(await page.locator('[data-testid=export-chapters] span').textContent()).toBe('3 from the script, in the video file');
    await page.waitForSelector('[data-testid=export-start]:not([disabled])');
    await click(page, '[data-testid=export-start]');
    await exported(page);
    expect(await page.locator('[data-testid=export-file] small').textContent()).toContain('· 3 chapters');
    const list = '0:00 Open the settings\n0:02 Turn on dark mode\n0:04 Export the video';
    expect(await page.locator('[data-testid=export-chapter-list] pre').textContent()).toBe(list);
    // a video this short: YouTube would not show them, and says why
    expect(await page.locator('[data-testid=export-chapter-list] .note').textContent()).toMatch(/^YouTube needs each chapter to last 10 s or more/);
    await click(page, '[data-testid=export-copy-chapters]');
    await expect.poll(() => page.locator('[data-testid=export-copy-chapters]').textContent()).toBe('Copied');
    expect(await app.evaluate(() => (globalThis as { __copied?: string }).__copied)).toBe(list);
    await shotOf('48-export-chapters', '/editor.html', 'chapters · Cuttle');
    // the video file has them, where the take reached each step
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', join(dir, 'out', 'export.mp4')], { encoding: 'utf8' });
    const chapters = (JSON.parse(probe.stdout) as { chapters: { start_time: string; tags: { title: string } }[] }).chapters;
    expect(chapters.map((chapter) => [Number(chapter.start_time), chapter.tags.title])).toEqual([
      [0, 'Open the settings'],
      [2, 'Turn on dark mode'],
      [4.125, 'Export the video'],
    ]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'chapters · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
```

Run: `pnpm app:check`
Expected: PASS, 56 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop
git commit -m "app: the export sheet's chapters, copied for a YouTube description

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The guides, and final verification

**Files:**
- Modify: `README.md`, `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`, `skill/test/skill.test.ts`

- [ ] **Step 1: The README, the skill, its project guide, and the skill's commands**

In `README.md`, replace:

```markdown
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
Ctrl+Shift+Alt+N (or Next) goes on, Ctrl+Shift+Alt+B back, each step is a marker of the take, and
the script is kept in the project for the next take. Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
opens on the take at once while `suggest` cuts it in the background. "Record again" adds a take to
```

with:

```markdown
the demo (a title each, and what to say; a pasted list becomes steps). While recording, a prompter
by the HUD shows the step now, its note and the step after it, never in the video:
Ctrl+Shift+Alt+N (or Next) goes on, Ctrl+Shift+Alt+B back, each step is a marker of the take, and
the script is kept in the project for the next take. The export puts the steps into the video as
its chapters (players list them), and its sheet lists them to copy into a YouTube description.
Pause (the HUD, or Ctrl+Shift+Alt+P)
records nothing until you resume; the pieces are joined at the stop. Restart is a held press: the
take is put aside, the countdown starts again, and the editor offers "Undo restart". The editor
opens on the take at once while `suggest` cuts it in the background. "Record again" adds a take to
```

In the same file, replace:

````markdown
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
cuttle capture-page https://example.com --scroll --add
cuttle render --format 9:16          # out/9x16.mp4
cuttle recover takes/2               # after a crash
```
````

with:

````markdown
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
cuttle capture-page https://example.com --scroll --add
cuttle render --format 9:16          # out/9x16.mp4, with the script's steps as its chapters
cuttle chapters                      # those chapters as lines for a YouTube description
cuttle recover takes/2               # after a crash
```
````

In `skill/cuttle/SKILL.md`, replace:

```markdown
encoder (`stats`). For 9:16, check `preview --format 9:16` first. Render each format the user
wants. Tell the user the file's path and length. Do not upload it anywhere.

## When something fails

- `device-not-found`: run `cuttle --json devices`. Names must match exactly (`--mic "<name>"`).
```

with:

```markdown
encoder (`stats`). For 9:16, check `preview --format 9:16` first. Render each format the user
wants. Tell the user the file's path and length. Do not upload it anywhere.

With a script, the video file has the steps as its chapters (`chapters` in the JSON, output
seconds). `cuttle -C "<project>" --json chapters` gives them as lines for a YouTube description
(`youtube`) and says why YouTube would not show them (`problems`: fewer than three, or one shorter
than 10 s). Give the user the lines when the video goes to YouTube.

## When something fails

- `device-not-found`: run `cuttle --json devices`. Names must match exactly (`--mic "<name>"`).
```

In `skill/cuttle/project.md`, replace:

```markdown
unique in the project (the app gives `step1`, `step2` …); `title` says in up to 80 characters what
the step shows; `note` (optional, up to 1000) is what to say, shown only in the app's prompter and
never in the video. A take starts at the first step; the step key (Ctrl+Shift+Alt+N, back
Ctrl+Shift+Alt+B) or the prompter's buttons move on, and each move is a `step` marker.

`look` (every field is optional):
```

with:

```markdown
unique in the project (the app gives `step1`, `step2` …); `title` says in up to 80 characters what
the step shows; `note` (optional, up to 1000) is what to say, shown only in the app's prompter and
never in the video. A take starts at the first step; the step key (Ctrl+Shift+Alt+N, back
Ctrl+Shift+Alt+B) or the prompter's buttons move on, and each move is a `step` marker. The video's
chapters come from these markers: one where the video shows each step reached (a move undone
within 2 s is none; a step in a stretch that is cut starts where the video goes on), the first at
0, each named by its step's title. Fixing a title in `script` renames its chapter.

`look` (every field is optional):
```

In `skill/test/skill.test.ts`, replace:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'brand list', 'brand save', 'brand apply', 'brand remove', 'background', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound', 'brand'];
```

with:

```ts

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'brand list', 'brand save', 'brand apply', 'brand remove', 'background', 'init', 'render', 'chapters', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound', 'brand'];
```

Run: `pnpm exec vitest run --project node skill`
Expected: PASS.

- [ ] **Step 2: Commit**

```bash
git add README.md skill
git commit -m "docs: the chapters from the script, cuttle chapters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 925 passed and 77 skipped (where a speech model is found, its real transcription runs too: 926 and 76; off Windows and macOS the OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 15 tests.

Run: `pnpm app:check`
Expected: PASS, 56 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 4: By hand (the user)**

1. Record a take with a script of three steps, moving on with Ctrl+Shift+Alt+N, and export it: the sheet says "3 from the script" before, and lists the chapters after. "Copy for YouTube" puts the lines on the clipboard.
2. Open the video in VLC (Playback, Chapter) or another player: the chapters are there, named by the steps.
3. Fix a step's title in `cuttle.json` and export again: the chapter has the new name.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits, and the tree came out byte-identical to the prototype.
- The checks ran on the finished prototype, whose tree the replay matches byte for byte. The packaged build ran on the replayed commits. Every screenshot was looked at.
- CI is off (the GitHub Actions minutes are used up). With the user's go, this milestone is merged on the local checks: Windows only, macOS not run.

**Found while checking, and already in the plan above**
- **A move undone at once can be read two ways:** the key pressed too early then undone, or a correct move then a slip back. Next at 20, back at 21 and Next at 22 is read the first way: the step begins at 22.
- **The last chapter ends where the scenes end** (3.13 s), a few milliseconds before the video's last whole frame (3.133 s). The render check allows that.
- **The export sheet's first click on Export can come before its formats are chosen** (a moment after it opens): the check waits for the button to be enabled.
- **The list's head read "in the video file; for YouTube, in its description"**, which wrapped beside its button. It reads "Chapters in the video" now, and the button says what it copies for.

- **The export's chapter test** first sat with the package's pure tests, which have no Node types: the typecheck refused its ffmpeg calls. It is with the main process's tests (`test/main`) now.

**Spec points that move**
- To **P5-M3c**: each step as a caption and a zoom point, and a motion template for a step's title.
