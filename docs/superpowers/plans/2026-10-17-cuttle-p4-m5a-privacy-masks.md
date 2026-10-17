# Cuttle P4-M5a: The Screen's Text and Masks That Follow It Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** What the screen shows that is private gets masked on its own: `suggest` reads the screen's text with Windows' own OCR and masks email addresses, keys, tokens, secret values, IBANs, card and phone numbers and the person's own words, following text that scrolls.

**Architecture:**
- **Format** (`@cuttle/project`):
  - a mask's `moves` (as a zoom's), the project's `privacy.words`, `sources.screenText`;
  - the take's `screen-text.jsonl` (`parseScreenTextJsonl`).
- **Timeline:** `maskRectAt`: between two of its places a mask covers both.
- **Core** (`privacy/`):
  - `ocr.ts`: a Windows PowerShell 5.1 helper with `Windows.Media.Ocr`, started once, one PNG per request;
  - `read.ts`: which frames to read (where the picture changed) and reading them;
  - `patterns.ts`: what is private in a line, with the OCR's slips in mind;
  - `masks.ts`: sightings across frames into masks that follow;
  - `apply.ts`: merged with the project's masks by the tag rules.
  - `suggest` reads the screen inside its new clips (or takes what was read) and makes the masks.
- **CLI:** `suggest --no-privacy`, `--mask <word>`.
- **Editor:** a mask that follows shows its path, its moves on the timeline, and Hold still, as a zoom does since M4a.
- **Skill:** privacy first, with the help and its limits.

**Tech Stack:** TypeScript strict, zod 4, vitest 5, Windows PowerShell 5.1 with `Windows.Media.Ocr`, ffmpeg, Electron 44.7.2, React 19.3.0, Playwright (`_electron`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase4-design.md`. Previous milestone: `docs/superpowers/plans/2026-10-17-cuttle-p4-m4b-crop-dialogs.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `p4-m5a`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 8.

## Decisions made while planning

A prototype of the milestone, checked against the spec, settled these points. The prototype passed `pnpm test` (656 tests, 53 skipped), the typecheck, `app:check` (43 tests) and `cli:check` (5). Every screenshot was looked at.

- **The split.** P4-M5 is split like M2 and M4:
  - M5a: the screen's text, the patterns, masks that follow, `suggest` and the CLI, the editor;
  - M5b: notification masks, "Always mask" in the app's settings, the app's own privacy step after the cut, and the picker's notification hint.
  - Until M5b the app's cut leaves the privacy masks as they are (`privacy: false`), as the cut leaves transcription to its own step.
- **Reading the screen:**
  - **Which frames:** in each clip, its first frame, then every frame (2 a second) where 24 grey pixels or more changed since the last frame read, and at least one every 5 s.
  - **How:** each frame is written as a PNG to a temporary folder and read by the OCR helper; the next one is written while one is read, and each is removed once read.
  - **The helper:** `powershell.exe` with an encoded script, started once. It takes `{ path, scale }` lines on stdin and answers one JSON line each, the words of each line with their rects.
  - **Scale:** it scales the picture up in the decoder (cubic, at most `MaxImageDimension`) to twice its size. The OCR reads small text much better so. Cubic read everything a picture pre-scaled with lanczos did (the spike's fixture), where the decoder's Fant mode lost the `sk-ant-` line.
  - **The result:** written to `takes/<n>/screen-text.jsonl` and linked as `sources.screenText`. A rerun takes what was read.
  - **Where it cannot run** (not Windows, PowerShell refused, no OCR language; `CUTTLE_OCR=off`, which the test config sets as it sets an empty models folder): `ocr-missing`. `suggest` then notes it, makes no masks from text, and tells the person to look.
- **What is private** (`findSecrets`), on a line as its words joined by spaces:
  - email addresses; tokens in links (`?…token=`, `key=`, `secret=`, `password=`, `session=`, `code=`) and the password in `user:password@host`;
  - keys by prefix: `sk-ant-`, `sk-proj-`, `sk-`, `ghp_`, `gho_`, `ghs_`, `ghu_`, `github_pat_`, `glpat-`, `xox[absp]-`, `AKIA` + 16, `AIza`, JWTs (`eyJ…` with dots, to the line's end), and a private key's header. A key needs 10 key characters after its prefix. Prefixes of 4 letters or more allow one wrong one: the OCR read `glpat-` as `g1pat-` and `eyJ` as `ey3`.
  - the value of a `NAME=value` or `name: value` line whose name says key, token, secret, password, session, authorization, credential or cookie (not "Author", not "Keyboard"), to the line's end;
  - IBANs (mod 97), card numbers (13 to 19 digits, Luhn, a known issuer), phone numbers (`+` and 9 to 15 digits, or `0` and 9 to 13), with the OCR's look-alikes of digits made digits next to digits: `O`, `ø` (a slashed zero), `I`, `l`, `|`;
  - the person's words (`privacy.words` and `--mask`), as whole words, one wrong letter allowed in those of 5 or more.
  - A secret covers its words' rects.
- **Masks** (`MASK_RULES`):
  - **Same secret:** text that reads the same (lower case, look-alikes made one), or of the same kind where it was.
  - **Time:** a mask starts 0.5 s before the first sight. It lasts until a frame read shows the secret gone: frames are read where the picture changes, so without a change it stayed on screen. Without such a frame, it lasts to the take's end.
  - **Gone:** two frames read in a row without it, over 2.5 s or more. The OCR read a token that scrolled in one frame of four and only "export" in the others; a stricter rule split its mask and left it bare in between.
  - **Moving text:** it moved when an edge moved more than 4 px. The mask then gets a place where it was last seen before, and one where it went. Between two places a mask covers both (`maskRectAt`), safe however the text moved between the frames read.
  - **Shape:** padded 6 px, `fill`, `auto: "privacy"`, labelled by kind ("Email address", "Key", "IBAN"…).
  - **Two rules, one place:** masks found there (a key in a `TOKEN=` line) whose paths match place by place become one, named for the more specific kind.
- **In `suggest`** (`autoEdits.privacy`, `--no-privacy`): Cuttle's privacy masks are made again, one switched off stays off (half its time, its rect half alike), and the others stay. `--mask` adds to `privacy.words` in cuttle.json. The result has `privacy: { read, masks }`, and the notes count the kinds.
- **The editor:** masks get the zoom path's treatment (M4a):
  - the box at the playhead where the mask is then (both places between two);
  - the dashed path;
  - a drag that moves and scales the whole path (`movePath` scales x and y apart for masks);
  - diamonds on the block, and Hold still;
  - its moves kept with its time through every edit.

## File structure

| File | Responsibility |
|---|---|
| `packages/project/src/{schema,index}.ts`, `screen-text.ts` (new) | `moves` on masks, `privacy.words`, `sources.screenText`, screen-text.jsonl |
| `packages/timeline/src/{overlays,index}.ts` | where a mask that follows is |
| `packages/core/src/privacy/{ocr,read,patterns,masks,apply}.ts` (new), `errors.ts` | reading the screen, what is private, the masks |
| `packages/core/src/{suggest,index}.ts`, `vitest.config.ts` | the masks in `suggest`; no OCR in tests unless asked |
| `apps/cli/src/{main,errors}.ts`, `apps/desktop/src/workers/media.ts` | the flags; the app's cut leaves privacy to M5b |
| `apps/desktop/src/shared/{document,edit,timeline-model}.ts`, `src/renderer/editor/{SourceView,Inspector}.tsx`, `editor.css` | masks that follow, in the editor |
| `skill/cuttle/{SKILL,project}.md` | for Claude |

---

### Task 1: The format

**Files:**
- Create: `packages/project/src/screen-text.ts`, `packages/project/test/screen-text.test.ts`
- Modify: `packages/project/src/{schema,index}.ts`, `packages/project/test/schema.test.ts`

- [ ] **Step 1: The branch**

The plan was committed on the branch `p4-m5a`; work there:

```bash
git switch p4-m5a
```

- [ ] **Step 2: Write the failing tests**

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(pathsOf({ ...minimal, zooms: [{ at: 0, duration: 1, rect: [0, 0, 0, 10] }] })).toContain('zooms.0.rect.2');
  });

  it('takes a zoom that follows: its moves come in time order, inside the zoom', () => {
    const zoom = { at: 2, duration: 4, rect: [0, 0, 800, 450] };
    const moves = [{ at: 3, rect: [100, 0, 800, 450] }, { at: 4.5, rect: [100, 200, 800, 450] }];
```

with:

```ts
    expect(pathsOf({ ...minimal, zooms: [{ at: 0, duration: 1, rect: [0, 0, 0, 10] }] })).toContain('zooms.0.rect.2');
  });

  it('takes a mask that follows, and the privacy guard\'s words', () => {
    const mask = { from: 2, to: 6, rect: [10, 10, 300, 40] };
    const moves = [{ at: 3, rect: [10, 60, 300, 40] }];
    expect(ProjectSchema.parse({ ...minimal, masks: [{ ...mask, moves }] }).masks[0]!.moves).toEqual(moves);
    expect(pathsOf({ ...minimal, masks: [{ ...mask, moves: [{ at: 6, rect: [0, 0, 9, 9] }] }] })).toEqual(['masks.0.moves.0.at']);
    expect(pathsOf({ ...minimal, masks: [{ ...mask, to: 2 }] })).toEqual(['masks.0.to']);
    expect(ProjectSchema.parse(minimal).privacy).toEqual({ words: [] });
    expect(ProjectSchema.parse({ ...minimal, privacy: { words: [' Lena Müller '] } }).privacy.words).toEqual(['Lena Müller']);
    expect(pathsOf({ ...minimal, privacy: { words: [''] } })).toEqual(['privacy.words.0']);
  });

  it('takes a zoom that follows: its moves come in time order, inside the zoom', () => {
    const zoom = { at: 2, duration: 4, rect: [0, 0, 800, 450] };
    const moves = [{ at: 3, rect: [100, 0, 800, 450] }, { at: 4.5, rect: [100, 200, 800, 450] }];
```

`packages/project/test/screen-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseScreenTextJsonl } from '../src/index';

describe('parseScreenTextJsonl', () => {
  it('reads a frame per line: its lines with their words and rects', () => {
    const frame = { t: 1.5, lines: [{ text: 'Signed in as a@b.de', rect: [40, 60, 220, 18], words: [{ text: 'Signed', rect: [40, 60, 50, 18] }, { text: 'a@b.de', rect: [200, 60, 60, 18] }] }] };
    expect(parseScreenTextJsonl(`${JSON.stringify(frame)}\n\n${JSON.stringify({ t: 2, lines: [] })}\n`)).toEqual({ frames: [frame, { t: 2, lines: [] }], issues: [] });
  });

  it('reports a broken line and an invalid frame by their line numbers', () => {
    const result = parseScreenTextJsonl('{"t":1,"lines":[]}\n{"t":2,"lin\n{"t":-1,"lines":[]}\n');
    expect(result.frames).toHaveLength(1);
    expect(result.issues.map((issue) => issue.path)).toEqual(['line 2', 'line 3.t']);
  });
});
```

Run: `pnpm exec vitest run --project node packages/project/test/schema.test.ts packages/project/test/screen-text.test.ts`
Expected: FAIL: a mask has no `moves`, the project no `privacy`, and `parseScreenTextJsonl` does not exist.

- [ ] **Step 3: The format**

In `packages/project/src/schema.ts`, replace:

```ts
  transcript: z.string().min(1).optional(),
  /** The mic cleaned up (made with the transcription): less noise, even loudness, in step with the mic. */
  cleanMic: z.string().min(1).optional(),
});

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
```

with:

```ts
  transcript: z.string().min(1).optional(),
  /** The mic cleaned up (made with the transcription): less noise, even loudness, in step with the mic. */
  cleanMic: z.string().min(1).optional(),
  /** The screen's text, read where the picture changed (the privacy masks are made from it). */
  screenText: z.string().min(1).optional(),
});

// Cross-field checks live on the object they belong to, so zod reports them in the same pass
```

In the same file, replace:

```ts
    from: seconds,
    to: seconds,
    rect: RectSchema,
    style: z.enum(MASK_STYLES).default('fill'),
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .refine((mask) => mask.to > mask.from, { message: '"to" must be greater than "from"', path: ['to'] });

/** A fix the person made to the transcript: the words spoken in [at, end) (source seconds) read as `text` ("" for none). */
const CaptionFixSchema = z
```

with:

```ts
    from: seconds,
    to: seconds,
    rect: RectSchema,
    /** A mask that follows (text that scrolls): from `rect` it goes to each move's rect in turn. */
    moves: z.array(ZoomMoveSchema).optional(),
    style: z.enum(MASK_STYLES).default('fill'),
    enabled: z.boolean().default(true),
    auto: autoKind,
  })
  .superRefine((mask, ctx) => {
    if (!(mask.to > mask.from)) ctx.addIssue({ code: 'custom', message: '"to" must be greater than "from"', path: ['to'] });
    let previous = mask.from;
    (mask.moves ?? []).forEach((move, index) => {
      if (!(move.at > previous)) ctx.addIssue({ code: 'custom', message: index === 0 ? 'a move must come after the mask starts ("from")' : 'moves must be in time order', path: ['moves', index, 'at'] });
      else if (!(move.at < mask.to)) ctx.addIssue({ code: 'custom', message: 'a move must come before the mask ends ("to")', path: ['moves', index, 'at'] });
      previous = move.at;
    });
  });

/** The privacy guard's words: masked wherever the screen shows them (a name, an address). */
const PrivacySchema = z.strictObject({
  words: z.array(z.string().trim().min(1).max(100)).default([]),
});

/** A fix the person made to the transcript: the words spoken in [at, end) (source seconds) read as `text` ("" for none). */
const CaptionFixSchema = z
```

In the same file, replace:

```ts
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
```

with:

```ts
    cuts: z.array(CutSchema).default([]),
    autoEdits: AutoEditsSchema.prefault({}),
    captions: CaptionsSchema.prefault({}),
    privacy: PrivacySchema.prefault({}),
  })
  // Runs once everything else is valid (see the note above BackgroundSchema).
  .superRefine((project, ctx) => {
```

`packages/project/src/screen-text.ts`:

```ts
import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';
import { RectSchema } from './schema';

/** A word the screen showed, with its rect in source pixels of the screen track. */
const ScreenTextWordSchema = z.strictObject({ text: z.string(), rect: RectSchema });

/** A line of words, as the OCR read it; its rect holds all its words. */
const ScreenTextLineSchema = z.strictObject({ text: z.string(), rect: RectSchema, words: z.array(ScreenTextWordSchema) });

/**
 * One line of screen-text.jsonl: the text of the frame at `t` (source seconds), read by the OCR pass
 * where the picture changed. It is the person's screen: it stays on this computer.
 */
export const ScreenTextFrameSchema = z.strictObject({ t: z.number().nonnegative(), lines: z.array(ScreenTextLineSchema) });

export type ScreenTextWord = z.output<typeof ScreenTextWordSchema>;
export type ScreenTextLine = z.output<typeof ScreenTextLineSchema>;
export type ScreenTextFrame = z.output<typeof ScreenTextFrameSchema>;

/** Parses screen-text.jsonl: one frame per line, blank lines ignored, invalid ones reported as `line <n>`. */
export function parseScreenTextJsonl(text: string): { frames: ScreenTextFrame[]; issues: ProjectIssue[] } {
  const frames: ScreenTextFrame[] = [];
  const issues: ProjectIssue[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      issues.push({ path: `line ${index + 1}`, message: `Invalid JSON: ${(error as Error).message}` });
      return;
    }
    const result = ScreenTextFrameSchema.safeParse(value);
    if (result.success) frames.push(result.data);
    else for (const issue of result.error.issues) issues.push({ path: `line ${index + 1}${issue.path.length > 0 ? `.${formatPath(issue.path)}` : ''}`, message: issue.message });
  });
  return { frames, issues };
}
```

In `packages/project/src/index.ts`, replace:

```ts
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { SHORT_SPELLINGS, fillerLexicon, likelyFiller, normWord } from './words';
export { parseEventsJsonl } from './events';
export { SEGMENTS_VERSION, SegmentsFileSchema, parseSegmentsJson, segmentOffsets, takeTime, type Segment, type SegmentsFile, type SegmentsFileParseResult } from './segments';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
export {
```

with:

```ts
export { ID_PREFIXES, newId, usedIds, type IdList } from './ids';
export { SHORT_SPELLINGS, fillerLexicon, likelyFiller, normWord } from './words';
export { parseEventsJsonl } from './events';
export { ScreenTextFrameSchema, parseScreenTextJsonl, type ScreenTextFrame, type ScreenTextLine, type ScreenTextWord } from './screen-text';
export { SEGMENTS_VERSION, SegmentsFileSchema, parseSegmentsJson, segmentOffsets, takeTime, type Segment, type SegmentsFile, type SegmentsFileParseResult } from './segments';
export { TAKE_VERSION, TakeFileSchema, parseTakeJson, trackOffset, type TakeFile, type TakeFileParseResult, type TakeFileTrack } from './take';
export {
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project node packages/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project
git commit -m "project: masks that follow, privacy words, and the screen's text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Where a mask is

**Files:**
- Modify: `packages/timeline/src/{overlays,index}.ts`, `packages/timeline/test/overlays.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/timeline/test/overlays.test.ts`, replace:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { activeMasks, activeTexts, badgeFor } from '../src/overlays';

const mask = (from: number, to: number, enabled = true): Mask => ({
  from, to, rect: [0, 0, 50, 50], style: 'fill', enabled,
```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { activeMasks, activeTexts, badgeFor, maskRectAt } from '../src/overlays';

const mask = (from: number, to: number, enabled = true): Mask => ({
  from, to, rect: [0, 0, 50, 50], style: 'fill', enabled,
```

In the same file, replace:

```ts
    expect(activeMasks(masks, 5.5)).toEqual([masks[0]]);
    expect(activeMasks(masks, 15)).toEqual([]);
  });
});

describe('activeTexts', () => {
```

with:

```ts
    expect(activeMasks(masks, 5.5)).toEqual([masks[0]]);
    expect(activeMasks(masks, 15)).toEqual([]);
  });

  it('follows text that scrolls: between two places it covers both, after the last it holds it', () => {
    // seen at y 100 until 4 s, at y 60 at 4.5 s, and at y 20 from 6 s on
    const scrolling: Mask = { ...mask(1, 10), rect: [10, 100, 200, 20], moves: [{ at: 4, rect: [10, 100, 200, 20] }, { at: 4.5, rect: [10, 60, 200, 20] }, { at: 6, rect: [10, 20, 200, 20] }] };
    expect(maskRectAt(scrolling, 2)).toEqual([10, 100, 200, 20]);
    expect(maskRectAt(scrolling, 4.2)).toEqual([10, 60, 200, 60]);
    expect(maskRectAt(scrolling, 5)).toEqual([10, 20, 200, 60]);
    expect(maskRectAt(scrolling, 8)).toEqual([10, 20, 200, 20]);
    expect(activeMasks([scrolling], 4.2)[0]!.rect).toEqual([10, 60, 200, 60]);
  });
});

describe('activeTexts', () => {
```

Run: `pnpm exec vitest run --project node packages/timeline/test/overlays.test.ts`
Expected: FAIL: `maskRectAt` does not exist.

- [ ] **Step 2: `maskRectAt`**

In `packages/timeline/src/overlays.ts`, replace:

```ts
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';

/** Length of a text's fades in output seconds (see `rampAmount`). */
export const TEXT_FADE_SECONDS = 0.25;
```

with:

```ts
import type { ClipScene, Mask, Rect, TextOverlay } from '@cuttle/project';

/** Length of a text's fades in output seconds (see `rampAmount`). */
export const TEXT_FADE_SECONDS = 0.25;
```

In the same file, replace:

```ts
  opacity: number;
}

/** Enabled masks whose `[from, to)` range, in source seconds, contains `sourceTime`. */
export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks.filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to);
}

/** Enabled texts whose `[at, at+duration)` range, in source seconds, contains `sourceTime`, with their opacity from `opacityOf` (their fades; 0 on a fade's first frame). */
```

with:

```ts
  opacity: number;
}

/**
 * Where a mask is at `sourceTime`: its places are its rect at `from`, then each move's. Between two
 * of them it covers both, safe however the text moved between the frames read; after the last it
 * holds that one.
 */
export function maskRectAt(mask: Pick<Mask, 'from' | 'rect' | 'moves'>, sourceTime: number): Rect {
  const places = [{ at: mask.from, rect: mask.rect }, ...(mask.moves ?? [])];
  let i = 0;
  while (i + 1 < places.length && places[i + 1]!.at <= sourceTime) i++;
  const here = places[i]!.rect;
  const next = places[i + 1]?.rect;
  if (!next) return here;
  const left = Math.min(here[0], next[0]);
  const top = Math.min(here[1], next[1]);
  return [left, top, Math.max(here[0] + here[2], next[0] + next[2]) - left, Math.max(here[1] + here[3], next[1] + next[3]) - top];
}

/** Enabled masks whose `[from, to)` range, in source seconds, contains `sourceTime`; one that follows, where it is then. */
export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks
    .filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to)
    .map((mask) => (mask.moves?.length ? { ...mask, rect: maskRectAt(mask, sourceTime) } : mask));
}

/** Enabled texts whose `[at, at+duration)` range, in source seconds, contains `sourceTime`, with their opacity from `opacityOf` (their fades; 0 on a fade's first frame). */
```

In `packages/timeline/src/index.ts`, replace:

```ts
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
```

with:

```ts
} from './time';
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_MOVE_SECONDS, ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt, zoomTargetAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export {
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/timeline`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline
git commit -m "timeline: a mask that follows covers both places between two

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reading the screen, and what is private

**Files:**
- Create: `packages/core/src/privacy/{patterns,masks,ocr,read,apply}.ts`
- Create: `packages/core/test/{patterns,privacy-masks,privacy-ocr}.test.ts`, `packages/core/test/fixtures/privacy/secrets.html`, `packages/core/test/fixtures/privacy/secrets.png`
- Modify: `packages/core/src/errors.ts`

- [ ] **Step 1: The fixture**

`secrets.html` is a page with planted fake secrets (and clean lines):

`packages/core/test/fixtures/privacy/secrets.html`:

```
<!doctype html>
<meta charset="utf-8">
<title>Planted secrets (all fake)</title>
<style>
  body { margin: 0; background: #1e1e1e; color: #d4d4d4; font: 15px/1.6 "Segoe UI", sans-serif; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 32px; }
  .card { background: #252526; border-radius: 8px; padding: 20px; }
  pre { font: 13px/1.5 Consolas, monospace; color: #9cdcfe; margin: 0; white-space: pre-wrap; }
  .small { font-size: 12px; color: #aaa; }
  .light { background: #fff; color: #222; }
</style>
<div class="card">
  <h3>Account</h3>
  <p>Signed in as lena.mueller@example.com</p>
  <p>Phone: +49 170 1234567</p>
  <p>IBAN: DE89 3704 0044 0532 0130 00</p>
  <p class="small">Card ending 4111 1111 1111 1111, expires 12/29</p>
</div>
<div class="card">
  <h3>.env</h3>
  <pre>ANTHROPIC_API_KEY=sk-ant-api03-AbCdEf1234567890GhIjKlMnOpQrStUvWx
GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz12
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
SESSION=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl</pre>
</div>
<div class="card light">
  <h3>Clean text (must get no mask)</h3>
  <p>Release 2026-10-17, build 4.2.1, 1234 downloads, call us on Mondays.</p>
  <p>Order number 2026101712345 shipped on 17.10.2026.</p>
</div>
<div class="card">
  <pre class="small">$ git remote -v
origin  https://lena:glpat-AbCdEf123456GhIjKlMn@gitlab.example.com/demo.git (fetch)
$ curl "https://api.example.com/v1/items?access_token=abc123def456ghi789"</pre>
</div>
```

`secrets.png` is that page at 1920 × 1080 (46 KB), rendered with Cuttle's page capture (`cuttle capture-page secrets.html`, its first screen): commit it next to the HTML.

- [ ] **Step 2: Write the failing tests**

The patterns are tested on the lines as Windows OCR read the fixture, its slips included:

`packages/core/test/patterns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ScreenTextLine } from '@cuttle/project';
import { cardValid, digitsOf, findSecrets, ibanValid, lineSecrets } from '../src/privacy/patterns';

/** The kinds found in a line, and the text each covers. */
const found = (text: string, words: string[] = []) => findSecrets(text, words).map((secret) => [secret.kind, secret.text]);

describe('findSecrets, on lines as Windows OCR read the fixture page (its slips included)', () => {
  it('finds email addresses, phone numbers, IBANs and card numbers', () => {
    expect(found('Signed in as lena.mueller@example.com')).toEqual([['email', 'lena.mueller@example.com']]);
    expect(found('Phone +49 170 1234567')).toEqual([['phone', '+49 170 1234567']]);
    // "00" read as "OO"
    expect(found('IBAN: DE89 3704 0044 0532 0130 OO')).toContainEqual(['iban', 'DE89 3704 0044 0532 0130 OO']);
    expect(found('Card ending 4111 1111 1111 1111, expires 12/29')).toContainEqual(['card', '4111 1111 1111 1111']);
  });

  it('finds keys by their prefix (one wrong letter allowed) and masks them to the line\'s end', () => {
    expect(found('ANTHROPIC API KEY=sk-ant-apiø3-AbCdEf123456789øGh1jK1mnOpQrStUvWx').map(([kind]) => kind).sort()).toEqual(['key', 'value']);
    expect(found('GITHUB TOKEN=ghp_123456789øabcdefghijk1mnopqrstuvwxyz12')).toContainEqual(['key', 'ghp_123456789øabcdefghijk1mnopqrstuvwxyz12']);
    expect(found('AWS ACCESS KEY ID=AKIAIOSFODNN7EXANPLE')).toContainEqual(['key', 'AKIAIOSFODNN7EXANPLE']);
    // "glpat-" read as "g1pat-", the password in the link (its user@host reads as an email address too)
    const remote = found('origin https://1ena:g1pat-AbCdEf123456GhIjKIMn@git1ab.examp1e.com/demo.git (fetch)');
    expect(remote.map(([kind]) => kind).sort()).toEqual(['email', 'key', 'token']);
    // a JWT the OCR split with spaces, "eyJ" read as "ey3", after a private name
    expect(found('SESSION=ey3hbGc iOiJIUz11NiJ9. zdW1i0i1xmjmø1nø. c21nbmFØdXJ1').map(([kind]) => kind)).toContain('value');
    expect(found('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl')).toContainEqual(['key', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl']);
    expect(found('-----BEGIN OPENSSH PRIVATE KEY-----')).toEqual([['key', '-----BEGIN OPENSSH PRIVATE KEY-----']]);
  });

  it('finds tokens in links, and the value of a private name', () => {
    expect(found('$ curl "https://api.examp1e.com/v1/items?access_token=abc123def456ghi789"')).toContainEqual(['token', 'abc123def456ghi789']);
    expect(found('Password: hunter2 (do not share)')).toEqual([['value', 'hunter2 (do not share)']]);
    expect(found('Authorization: Bearer abc.def')).toContainEqual(['value', 'Bearer abc.def']);
  });

  it('finds the person\'s words, one wrong letter allowed in long ones', () => {
    expect(found('Thanks, Lena Müller!', ['Lena Müller'])).toEqual([['word', 'Lena Müller!']]);
    expect(found('Lena Mūller wrote', ['Lena Müller'])).toEqual([['word', 'Lena Mūller']]);
    expect(found('Lena Meyer wrote', ['Lena Müller'])).toEqual([]);
  });

  it('leaves clean lines alone', () => {
    for (const clean of [
      'Release 2026-10-17, build 4.2.1, 1234 downloadsr call us on Mondays.',
      'Order number 2026101712345 shipped on 17.10.2026.',
      'Author: Lena',
      'The keyboard: great',
      'Use the sk-learn library',
      'Akira wrote this in Aizawa',
      'Call 0800 123',
      'https://example.com/docs',
    ]) expect(found(clean), clean).toEqual([]);
  });
});

describe('the checks', () => {
  it('reads look-alikes as digits only next to digits', () => {
    expect(digitsOf('0130 OO and Olaf')).toBe('0130 00 and Olaf');
    expect(digitsOf('4l11 I111')).toBe('4111 1111');
  });

  it('checks IBANs (mod 97) and card numbers (Luhn, an issuer)', () => {
    expect([ibanValid('DE89 3704 0044 0532 0130 00'), ibanValid('DE88 3704 0044 0532 0130 00')]).toEqual([true, false]);
    expect([cardValid('4111111111111111'), cardValid('4111111111111112'), cardValid('2026101712345')]).toEqual([true, false, false]);
  });
});

describe('lineSecrets', () => {
  it('covers the words a secret is in, and names it to find it again in another frame', () => {
    const line: ScreenTextLine = {
      text: 'Signed in as lena.mueller@example.com',
      rect: [40, 60, 300, 18],
      words: [
        { text: 'Signed', rect: [40, 60, 50, 18] },
        { text: 'in', rect: [94, 60, 14, 18] },
        { text: 'as', rect: [112, 60, 16, 18] },
        { text: 'lena.mueller@example.com', rect: [132, 61, 208, 17] },
      ],
    };
    expect(lineSecrets(line)).toEqual([{ kind: 'email', rect: [132, 61, 208, 17], key: 'email:1ena.mue11er@examp1e.c0m' }]);
  });
});
```

`packages/core/test/privacy-masks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ScreenTextFrame, ScreenTextLine } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';

/** A line of text at (x, y): each character 10 px wide and 20 px high, words one character apart. */
function line(text: string, x: number, y: number): ScreenTextLine {
  let at = x;
  const words = text.split(' ').map((word) => {
    const rect: [number, number, number, number] = [at, y, word.length * 10, 20];
    at += (word.length + 1) * 10;
    return { text: word, rect };
  });
  return { text, rect: [x, y, at - x - 10, 20], words };
}
const frame = (t: number, ...lines: ScreenTextLine[]): ScreenTextFrame => ({ t, lines });
const screen = { width: 1920, height: 1080 };

describe('privacyMasks', () => {
  it('masks a secret from half a second before its first sight until a frame read shows it gone, padded', () => {
    const email = line('mail: lena@example.com', 100, 200);
    const frames = [frame(1, email), frame(1.5, email), frame(2, email), frame(2.5), frame(3), frame(4)];
    expect(privacyMasks(frames, [], screen)).toEqual([{ from: 0.5, to: 2.5, rect: [154, 194, 172, 32], kind: 'email', label: 'Email address' }]);
  });

  it('keeps one mask over frames the OCR missed it in, and starts a new one when it was gone 2.5 s', () => {
    const email = line('lena@example.com', 100, 200);
    // missed at 1.5 s; gone from 2.5 s (four frames, 3 s); back at 8 s, and on screen until the take ends
    const frames = [frame(1, email), frame(1.5), frame(2, email), frame(2.5), frame(3), frame(4), frame(5), frame(8, email)];
    expect(privacyMasks(frames, [], screen, 12).map((mask) => [mask.from, mask.to])).toEqual([
      [0.5, 2.5],
      [7.5, 12],
    ]);
  });

  it('lasts until a frame read shows it gone: the picture did not change before', () => {
    const email = line('lena@example.com', 100, 200);
    expect(privacyMasks([frame(1, email), frame(7), frame(7.5)], [], screen).map((mask) => [mask.from, mask.to])).toEqual([[0.5, 7]]);
  });

  it('follows text that scrolls: where it was last seen before it moved, then each place it went', () => {
    const key = (y: number) => line('ghp_1234567890abcdefghijklmnop', 100, y);
    const frames = [frame(1, key(300)), frame(1.5, key(300)), frame(2, key(250)), frame(2.5, key(200)), frame(3), frame(3.5)];
    expect(privacyMasks(frames, [], screen)).toEqual([
      {
        from: 0.5,
        to: 3,
        rect: [94, 294, 312, 32],
        moves: [
          { at: 1.5, rect: [94, 294, 312, 32] },
          { at: 2, rect: [94, 244, 312, 32] },
          { at: 2.5, rect: [94, 194, 312, 32] },
        ],
        kind: 'key',
        label: 'Key',
      },
    ]);
  });

  it('makes one mask of a key in a NAME=value line, named for the key, and masks the person\'s words', () => {
    const frames = [frame(1, line('GITHUB_TOKEN=ghp_1234567890abcdefghijklmnop', 100, 400), line('Thanks, Lena Müller', 100, 500)), frame(1.5), frame(2)];
    const masks = privacyMasks(frames, ['Lena Müller'], screen);
    expect(masks.map((mask) => [mask.label, mask.rect])).toEqual([
      ['Key', [94, 394, 442, 32]],
      ['Always masked', [174, 494, 122, 32]],
    ]);
  });
});
```

The OCR itself runs on Windows only:

`packages/core/test/privacy-ocr.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rect } from '@cuttle/project';
import { privacyMasks } from '../src/privacy/masks';
import { ScreenReader } from '../src/privacy/ocr';

/**
 * Windows' own OCR on a page with planted fake secrets (fixtures/privacy/secrets.html, rendered at
 * 1920 × 1080 by `cuttle capture-page`): each secret it reads gets a mask, the clean lines none.
 * It runs on Windows, where the OCR is; elsewhere it is skipped.
 */
describe.runIf(process.platform === 'win32')('reading the screen with Windows OCR', () => {
  it('reads the page and masks what is private on it, and nothing on the clean lines', async () => {
    delete process.env.CUTTLE_OCR;
    const reader = await ScreenReader.start();
    let lines;
    try {
      lines = await reader.read(join(import.meta.dirname, 'fixtures', 'privacy', 'secrets.png'), 1920, 1080);
    } finally {
      reader.close();
    }
    const text = lines.map((line) => line.text).join('\n');
    expect(text).toContain('lena.mueller@example.com');
    const masks = privacyMasks([{ t: 1, lines }, { t: 2, lines: [] }, { t: 3, lines: [] }], [], { width: 1920, height: 1080 });
    const kinds = new Set(masks.map((mask) => mask.kind));
    for (const kind of ['email', 'phone', 'iban', 'key', 'value']) expect(kinds, kind).toContain(kind);
    // each planted secret the OCR read is under a mask (the small grey card number and the wrapped
    // end of the curl line go unread, as in the spike); the clean lines are not
    const under = (rect: Rect) => masks.some((mask) => rect[0] < mask.rect[0] + mask.rect[2] && mask.rect[0] < rect[0] + rect[2] && rect[1] < mask.rect[1] + mask.rect[3] && mask.rect[1] < rect[1] + rect[3]);
    for (const secret of ['lena.mueller@example.com', '+49', 'DE89', 'sk-ant-', 'ghp_', 'AKIA', 'SESSION=', 'g1pat-']) {
      const line = lines.find((one) => one.words.some((word) => word.text.includes(secret.split(' ')[0]!)));
      expect(line, secret).toBeDefined();
      expect(under(line!.words.find((word) => word.text.includes(secret.split(' ')[0]!))!.rect), secret).toBe(true);
    }
    for (const clean of ['Release', 'Order']) {
      const line = lines.find((one) => one.text.startsWith(clean));
      expect(line, clean).toBeDefined();
      expect(under(line!.rect), clean).toBe(false);
    }
  }, 60_000);
});
```

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts packages/core/test/privacy-masks.test.ts packages/core/test/privacy-ocr.test.ts`
Expected: FAIL: `../src/privacy/…` does not exist.

- [ ] **Step 3: The patterns and the masks**

`packages/core/src/privacy/patterns.ts`:

```ts
// The privacy guard's patterns: what in a line of screen text is private. The text is the OCR's, so
// it is read with its slips in mind: inside digit runs O is 0 and I, l or | is 1 before a checksum,
// a slashed zero reads as ø, and a key's prefix may have one wrong letter. Pure.
import { normWord, type Rect, type ScreenTextLine } from '@cuttle/project';

export const SECRET_KINDS = ['email', 'key', 'token', 'value', 'iban', 'card', 'phone', 'word'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** What to call a mask over each kind, for people. */
export const SECRET_LABELS: Record<SecretKind, string> = {
  email: 'Email address',
  key: 'Key',
  token: 'Token in a link',
  value: 'Secret value',
  iban: 'IBAN',
  card: 'Card number',
  phone: 'Phone number',
  word: 'Always masked',
};

/** A private thing on a line: its kind, the words it covers (their rect), and its text, compared across frames. */
export interface Secret {
  kind: SecretKind;
  rect: Rect;
  /** The text, normalised (lower case, the OCR's look-alikes made one), to tell the same secret in another frame. */
  key: string;
}

/** Key prefixes; one wrong letter is allowed in those of 4 letters or more. */
const KEY_PREFIXES = ['sk-ant-', 'sk-proj-', 'sk-', 'ghp_', 'gho_', 'ghs_', 'ghu_', 'github_pat_', 'glpat-', 'xoxb-', 'xoxa-', 'xoxp-', 'xoxs-', 'akia', 'aiza', 'eyj'];
/** After a prefix, a key goes on with at least this many key characters. */
const KEY_REST = 10;
/** Names whose value is private, in a `NAME=value` or `name: value` line. */
const SECRET_NAMES = /(api[_ -]?key|_key|key\b|token|secret|passw(or)?d|\bpwd\b|session|authorization|\bauth\b|credential|cookie)/i;

/** The OCR's look-alikes of digits, inside a run of digits. */
const DIGIT_LOOKALIKES: Record<string, string> = { o: '0', O: '0', 'ø': '0', 'Ø': '0', I: '1', l: '1', '|': '1' };
/**
 * Text with the look-alikes of digits made digits where they stand next to digits (within two
 * characters, counting those already made digits: "0130 OO" is "0130 00").
 */
export function digitsOf(text: string): string {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const lookalike = DIGIT_LOOKALIKES[chars[i]!];
    if (lookalike === undefined) continue;
    if ([chars[i - 1], chars[i - 2], chars[i + 1], chars[i + 2]].some((other) => other !== undefined && /[0-9]/.test(other))) chars[i] = lookalike;
  }
  return chars.join('');
}

/** How to compare a secret across frames: lower case, look-alikes made one, no spaces. */
export const keyOf = (text: string) => digitsOf(text).toLowerCase().replace(/[øØo]/g, '0').replace(/[il|]/g, '1').replace(/\s+/g, '');

/** Whether `text` starts with `prefix`, with at most one wrong letter for prefixes of 4 or more. */
function startsLike(text: string, prefix: string): boolean {
  if (text.length < prefix.length) return false;
  let wrong = 0;
  for (let i = 0; i < prefix.length; i++) if (text[i]!.toLowerCase() !== prefix[i]) wrong++;
  return wrong === 0 || (wrong === 1 && prefix.length >= 4);
}

/** The mod 97 check of an IBAN (letters A=10 … Z=35). */
export function ibanValid(iban: string): boolean {
  const compact = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  let rest = 0;
  for (const char of moved) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** The Luhn check of a card number, and a known issuer's first digits (2221–2720, 3, 4, 5, 6). */
export function cardValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  const lead = Number(digits.slice(0, 4));
  if (!/^[3-6]/.test(digits) && !(lead >= 2221 && lead <= 2720)) return false;
  let sum = 0;
  [...digits].reverse().forEach((char, i) => {
    let digit = Number(char);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  });
  return sum % 10 === 0;
}

interface Match {
  kind: SecretKind;
  from: number;
  to: number;
  text: string;
}

/** The private things of a line of text: character ranges of `text`. */
export function findSecrets(text: string, words: readonly string[] = []): Match[] {
  const found: Match[] = [];
  const add = (kind: SecretKind, from: number, to: number) => found.push({ kind, from, to, text: text.slice(from, to) });

  // email addresses
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) add('email', match.index, match.index + match[0].length);
  // a token in a link, and a password in one (https://user:password@host)
  for (const match of text.matchAll(/[?&](?:[a-z_]*token|key|api_?key|secret|sig|signature|password|session(?:_?id)?|code)=([^\s&"'#]+)/gi)) add('token', match.index + match[0].length - match[1]!.length, match.index + match[0].length);
  for (const match of text.matchAll(/\/\/[^\s/:@]+:([^\s/@]+)@/g)) add('token', match.index + 2, match.index + match[0].length - 1);
  // keys by their prefix: the key and what follows on the line
  for (const match of text.matchAll(/[^\s=:"'`(/@]+/g)) {
    const token = match[0];
    const prefix = KEY_PREFIXES.find((candidate) => startsLike(token, candidate));
    if (!prefix) continue;
    // a JWT the OCR split with spaces goes on to the line's end: parts with dots between
    const rest = (prefix === 'eyj' ? text.slice(match.index + prefix.length).replace(/\s+/g, '') : token.slice(prefix.length)).replace(/[^A-Za-z0-9_\-.øØ]/g, '');
    if (prefix === 'eyj' && !(rest.length >= 20 && rest.includes('.'))) continue;
    if (rest.length < (prefix === 'akia' ? 16 : KEY_REST)) continue;
    add('key', match.index, text.length);
  }
  // a private key's header line
  if (/BEGIN [A-Z ]*PRIVATE KEY/i.test(text)) add('key', 0, text.length);
  // the value of NAME=value or name: value, where the name says it is private
  for (const match of text.matchAll(/([A-Za-z][A-Za-z0-9_ .-]{0,40}?)\s*[=:]\s*(\S)/g)) {
    if (!SECRET_NAMES.test(match[1]!)) continue;
    if (/^https?$/i.test(match[1]!.trim())) continue;
    add('value', match.index + match[0].length - 1, text.length);
  }
  // numbers, with the OCR's look-alikes made digits
  const digits = digitsOf(text);
  for (const match of digits.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g)) {
    if (ibanValid(match[0])) add('iban', match.index, match.index + match[0].length);
  }
  for (const match of digits.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    if (cardValid(match[0].replace(/[ -]/g, ''))) add('card', match.index, match.index + match[0].length);
  }
  for (const match of digits.matchAll(/(?:\+\d|\b0\d)[\d ()/-]{7,}\d/g)) {
    const count = match[0].replace(/\D/g, '').length;
    const international = match[0].startsWith('+');
    if ((international && count >= 9 && count <= 15) || (!international && count >= 9 && count <= 13 && !/^0\d{1,3}-\d\d-\d\d/.test(match[0]))) add('phone', match.index, match.index + match[0].length);
  }
  // the person's words, as whole words, one wrong letter allowed in those of 5 or more
  const lower = text.toLowerCase();
  for (const word of words) {
    const parts = word.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const tokens = [...lower.matchAll(/\S+/g)];
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      const same = parts.every((part, k) => {
        const token = normWord(tokens[i + k]![0]);
        const wanted = normWord(part);
        if (token === wanted) return true;
        return wanted.length >= 5 && token.length === wanted.length && [...wanted].filter((char, j) => token[j] !== char).length === 1;
      });
      if (same) add('word', tokens[i]!.index, tokens[i + parts.length - 1]!.index + tokens[i + parts.length - 1]![0].length);
    }
  }
  return found;
}

/**
 * The private things of a line the OCR read, each with the rect of the words it covers. The line's
 * text is its words joined by spaces.
 */
export function lineSecrets(line: ScreenTextLine, words: readonly string[] = []): Secret[] {
  const spans: { from: number; to: number; rect: Rect }[] = [];
  let at = 0;
  for (const word of line.words) {
    spans.push({ from: at, to: at + word.text.length, rect: word.rect });
    at += word.text.length + 1;
  }
  const text = line.words.map((word) => word.text).join(' ');
  return findSecrets(text, words).flatMap((match) => {
    const covered = spans.filter((span) => span.from < match.to && match.from < span.to);
    if (covered.length === 0) return [];
    const left = Math.min(...covered.map((span) => span.rect[0]));
    const top = Math.min(...covered.map((span) => span.rect[1]));
    const right = Math.max(...covered.map((span) => span.rect[0] + span.rect[2]));
    const bottom = Math.max(...covered.map((span) => span.rect[1] + span.rect[3]));
    return [{ kind: match.kind, rect: [left, top, right - left, bottom - top] as Rect, key: `${match.kind}:${keyOf(match.text)}` }];
  });
}
```

`packages/core/src/privacy/masks.ts`:

```ts
// The privacy masks: each private thing the screen showed, masked from just before it was first seen
// to just after it was last seen, following it where it moved (text that scrolls). Pure.
import type { Rect, ScreenTextFrame, ZoomMove } from '@cuttle/project';
import { SECRET_LABELS, lineSecrets, type SecretKind } from './patterns';

export const MASK_RULES = {
  /** A mask starts this long before the first sight and ends this long after the last (source s). */
  margin: 0.5,
  /** Room around the text (px). */
  pad: 6,
  /** A secret moved when an edge of its rect moved more than this (px). */
  moved: 4,
  /**
   * It was gone when this many frames read in a row lacked it, over at least `gone` seconds: the
   * OCR misses a line now and then (a token that scrolls was read in one frame of four).
   */
  missing: 2,
  gone: 2.5,
};

export interface PrivacyMask {
  from: number;
  to: number;
  rect: Rect;
  moves?: ZoomMove[];
  kind: SecretKind;
  label: string;
}

interface Sighting {
  t: number;
  rect: Rect;
}

const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
};

/**
 * The masks for what the frames read show of private things (`lineSecrets`), and of the person's
 * `words`. A secret is the same in the next frame when its text reads the same, or it is of the same
 * kind where it was; it moved when its rect did. `end`: the take's length (source seconds), where a
 * mask ends that no later frame showed gone.
 */
export function privacyMasks(frames: readonly ScreenTextFrame[], words: readonly string[], screen: { width: number; height: number }, end = Infinity, rules = MASK_RULES): PrivacyMask[] {
  type Group = { kind: SecretKind; key: string; sightings: Sighting[]; missed: number };
  const open: Group[] = [];
  const closed: Group[] = [];
  for (const frame of [...frames].sort((a, b) => a.t - b.t)) {
    const seen = new Set<Group>();
    const secrets = frame.lines.flatMap((line) => lineSecrets(line, words));
    for (const secret of secrets) {
      const group =
        open.find((candidate) => !seen.has(candidate) && candidate.key === secret.key) ??
        open.find((candidate) => !seen.has(candidate) && candidate.kind === secret.kind && overlap(candidate.sightings.at(-1)!.rect, secret.rect) >= 0.5);
      if (group) {
        if (group.sightings.at(-1)!.t !== frame.t) group.sightings.push({ t: frame.t, rect: secret.rect });
        group.missed = 0;
        seen.add(group);
        continue;
      }
      const fresh: Group = { kind: secret.kind, key: secret.key, sightings: [{ t: frame.t, rect: secret.rect }], missed: 0 };
      open.push(fresh);
      seen.add(fresh);
    }
    for (const group of [...open]) {
      if (seen.has(group) || ++group.missed < rules.missing || frame.t - group.sightings.at(-1)!.t < rules.gone) continue;
      open.splice(open.indexOf(group), 1);
      closed.push(group);
    }
  }
  // Frames are read where the picture changes: a secret stays on screen until a frame read shows it
  // gone, so a mask lasts until then (to the take's end when none does).
  const times = frames.map((frame) => frame.t).sort((a, b) => a - b);
  const until = (last: number) => {
    const next = times.find((t) => t > last) ?? (Number.isFinite(end) ? end : last);
    return Math.max(last + rules.margin, next);
  };
  const pad = (rect: Rect): Rect => {
    const left = Math.max(0, rect[0] - rules.pad);
    const top = Math.max(0, rect[1] - rules.pad);
    return [Math.round(left), Math.round(top), Math.round(Math.min(screen.width, rect[0] + rect[2] + rules.pad) - left), Math.round(Math.min(screen.height, rect[1] + rect[3] + rules.pad) - top)];
  };
  const moved = (a: Rect, b: Rect) => a.some((value, k) => Math.abs(value - b[k]!) > rules.moved);
  const masks = [...closed, ...open]
    .map((group): PrivacyMask => {
      const [first, ...rest] = group.sightings as [Sighting, ...Sighting[]];
      const from = round(Math.max(0, first.t - rules.margin));
      const moves: ZoomMove[] = [];
      let previous = first;
      for (const sighting of rest) {
        if (moved(previous.rect, sighting.rect)) {
          // where it was last seen before it moved, then where it went: between the two it covers both
          if (moves.at(-1)?.at !== previous.t && previous !== first) moves.push({ at: round(previous.t), rect: pad(previous.rect) });
          moves.push({ at: round(sighting.t), rect: pad(sighting.rect) });
        }
        previous = sighting;
      }
      return { from, to: round(until(previous.t)), rect: pad(first.rect), ...(moves.length > 0 && { moves }), kind: group.kind, label: SECRET_LABELS[group.kind] };
    })
    .sort((a, b) => a.from - b.from);
  return joinCovering(masks);
}

/** Which kind names a mask that two rules found: the more specific. */
const SPECIFIC: readonly SecretKind[] = ['key', 'token', 'iban', 'card', 'email', 'phone', 'word', 'value'];

/**
 * Masks over the same text, found by two rules (a key in a `NAME=value` line), are one: those that
 * overlap in time and, place by place (their rect, then each move at the same time), one covers
 * most of the other.
 */
function joinCovering(masks: PrivacyMask[]): PrivacyMask[] {
  const covered = (a: Rect, b: Rect) => {
    const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return w > 0 && h > 0 ? (w * h) / Math.min(a[2] * a[3], b[2] * b[3]) : 0;
  };
  const both = (a: Rect, b: Rect): Rect => {
    const left = Math.min(a[0], b[0]);
    const top = Math.min(a[1], b[1]);
    return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top];
  };
  const samePath = (a: PrivacyMask, b: PrivacyMask) => {
    const [first, second] = [a.moves ?? [], b.moves ?? []];
    return covered(a.rect, b.rect) >= 0.8 && first.length === second.length && first.every((move, k) => move.at === second[k]!.at && covered(move.rect, second[k]!.rect) >= 0.8);
  };
  const joined: PrivacyMask[] = [];
  for (const mask of masks) {
    const other = joined.find((one) => one.from < mask.to && mask.from < one.to && samePath(one, mask));
    if (!other) {
      joined.push({ ...mask });
      continue;
    }
    other.rect = both(other.rect, mask.rect);
    if (other.moves) other.moves = other.moves.map((move, k) => ({ at: move.at, rect: both(move.rect, mask.moves![k]!.rect) }));
    other.from = Math.min(other.from, mask.from);
    other.to = Math.max(other.to, mask.to);
    if (SPECIFIC.indexOf(mask.kind) < SPECIFIC.indexOf(other.kind)) {
      other.kind = mask.kind;
      other.label = mask.label;
    }
  }
  return joined;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
```

- [ ] **Step 4: The OCR helper, reading the frames, and the masks in a project**

In `packages/core/src/errors.ts`, replace:

```ts
  | 'download'
  /** ffmpeg has no `whisper` filter (before 8.0, or a build without it). */
  | 'ffmpeg-old'
  | 'cancelled';

/** A failure of a project operation (reading a project, running ffmpeg, a take that cannot be used). */
```

with:

```ts
  | 'download'
  /** ffmpeg has no `whisper` filter (before 8.0, or a build without it). */
  | 'ffmpeg-old'
  /** The screen's text cannot be read here (not Windows, PowerShell refused, no OCR language). */
  | 'ocr-missing'
  | 'cancelled';

/** A failure of a project operation (reading a project, running ffmpeg, a take that cannot be used). */
```

`packages/core/src/privacy/ocr.ts`:

```ts
// Reading the screen's text with Windows' own OCR (Windows.Media.Ocr): a Windows PowerShell 5.1
// helper, started once, reads PNG files one request per line on stdin and answers one JSON line
// each. Nothing leaves this computer.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Rect, ScreenTextLine } from '@cuttle/project';
import { CoreError } from '../errors';

/**
 * The helper. It scales each picture up (cubic) before reading it: the OCR reads small text much
 * better at twice its size, and cubic kept what a pre-scaled picture gave (the spike's fixture).
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { [Console]::Out.WriteLine('{"ready":false}'); exit 0 }
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ ready = $true; language = $engine.RecognizerLanguage.LanguageTag; max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension } -Compress))
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($request.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $scale = [double]$request.scale
      $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
      $transform.ScaledWidth = [uint32][Math]::Round($decoder.PixelWidth * $scale)
      $transform.ScaledHeight = [uint32][Math]::Round($decoder.PixelHeight * $scale)
      $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    } finally { $stream.Dispose() }
    $lines = @(foreach ($l in $result.Lines) {
      ,@(foreach ($w in $l.Words) { $r = $w.BoundingRect; @{ t = $w.Text; r = @([Math]::Round($r.X / $scale, 1), [Math]::Round($r.Y / $scale, 1), [Math]::Round($r.Width / $scale, 1), [Math]::Round($r.Height / $scale, 1)) } })
    })
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ lines = $lines } -Compress -Depth 6))
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ error = $_.Exception.Message } -Compress))
  }
}
`;

/** Pictures are read at up to twice their size (the OCR reads small text much better so). */
export const OCR_SCALE = 2;

/** What the helper answers to a picture: its lines, each a list of words with their rects. */
type Answer = { lines?: { t: string; r: [number, number, number, number] }[][]; error?: string };

/** The lines of words of an answer, each with the rect that holds its words. */
export function linesOf(answer: Answer): ScreenTextLine[] {
  return (answer.lines ?? []).flatMap((words) => {
    if (words.length === 0) return [];
    const rects = words.map((word) => word.r);
    const left = Math.min(...rects.map((r) => r[0]));
    const top = Math.min(...rects.map((r) => r[1]));
    const rect: Rect = [left, top, Math.max(...rects.map((r) => r[0] + r[2])) - left, Math.max(...rects.map((r) => r[1] + r[3])) - top];
    return [{ text: words.map((word) => word.t).join(' '), rect, words: words.map((word) => ({ text: word.t, rect: word.r })) }];
  });
}

/** The OCR helper: started once, then one picture after the other. */
export class ScreenReader {
  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly answers: AsyncIterator<string>,
    /** The largest picture side the OCR takes. */
    readonly maxSide: number,
    /** The OCR's language (from the person's Windows languages). */
    readonly language: string,
  ) {}

  /** Starts the helper; `ocr-missing` where it cannot run (not Windows, PowerShell refused, no OCR language). */
  static async start(): Promise<ScreenReader> {
    if (process.platform !== 'win32') throw new CoreError('ocr-missing', "the screen's text is read with Windows' own OCR, which this system does not have");
    if (process.env.CUTTLE_OCR === 'off') throw new CoreError('ocr-missing', 'reading the screen is switched off (CUTTLE_OCR=off)');
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    child.stdin.setDefaultEncoding('utf8');
    const answers = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const started = new Promise<never>((_, reject) => child.on('error', (error) => reject(new CoreError('ocr-missing', `the OCR helper did not start (${error.message})`))));
    const first = await Promise.race([answers.next(), started]);
    const hello = first.done ? undefined : (JSON.parse(first.value) as { ready: boolean; language?: string; max?: number });
    if (!hello?.ready) {
      child.kill();
      throw new CoreError('ocr-missing', hello ? 'Windows has no OCR language installed (Settings > Time & language > Language)' : `the OCR helper did not start${stderr ? `: ${stderr.trim().split(/\r?\n/)[0]}` : ''}`);
    }
    return new ScreenReader(child, answers, hello.max ?? 10_000, hello.language ?? '');
  }

  /** The text of a PNG of `width` × `height`, read at up to `OCR_SCALE` times its size; rects in its pixels. */
  async read(path: string, width: number, height: number): Promise<ScreenTextLine[]> {
    const scale = Math.max(1, Math.min(OCR_SCALE, this.maxSide / Math.max(width, height)));
    this.child.stdin.write(`${JSON.stringify({ path, scale })}\n`);
    const next = await this.answers.next();
    if (next.done) throw new CoreError('ocr-missing', 'the OCR helper stopped');
    const answer = JSON.parse(next.value) as Answer;
    if (answer.error) throw new CoreError('invalid-media', `the OCR could not read ${path}: ${answer.error}`);
    return linesOf(answer);
  }

  close(): void {
    this.child.stdin.end();
    setTimeout(() => this.child.kill(), 2000).unref();
  }
}
```

`packages/core/src/privacy/read.ts`:

```ts
// Reading the screen's text for the privacy masks: the frames where the picture changed inside the
// clips (at most 2 a second, at least one every 5 s), each read with Windows' OCR, written as the
// take's screen-text.jsonl. Only the frames that are read are written to a temporary folder, one at
// a time, and removed once read.
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenTextFrame } from '@cuttle/project';
import { CoreError } from '../errors';
import { runFfmpeg } from '../ffmpeg';
import type { Span } from '../suggest/spans';
import { ScreenReader } from './ocr';

export const READ_RULES = {
  /** At most this many frames a second are read… */
  rate: 2,
  /** …and at least one every this many seconds while the clips run. */
  every: 5,
  /** Frames are compared this wide (in grey)… */
  width: 320,
  /** …a pixel changed when its grey moved more than this… */
  threshold: 24,
  /** …and a frame changed from this many changed pixels (a caret's blink is fewer). */
  minPixels: 24,
};

/** The take's file of what the screen read. */
export const SCREEN_TEXT_FILE = 'screen-text.jsonl';

/**
 * The source seconds to read inside `spans`: each span's first frame, then every frame (at `rate`
 * a second) that changed since the last one kept, and one at least every `every` seconds.
 */
export async function framesToRead(screen: string, spans: readonly Span[], size: { width: number; height: number }, rules = READ_RULES): Promise<number[]> {
  const width = rules.width;
  const height = 2 * Math.round((width * size.height) / size.width / 2);
  const area = width * height;
  const times: number[] = [];
  for (const span of spans) {
    if (!(span.to > span.from)) continue;
    let kept: { t: number; data: Buffer } | undefined;
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    await runFfmpeg(['-ss', span.from.toFixed(3), '-t', (span.to - span.from).toFixed(3), '-i', screen, '-map', '0:v:0', '-vf', `fps=${rules.rate},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= area) {
        const data = pending.subarray(0, area);
        pending = pending.subarray(area);
        const t = Math.round((span.from + index++ / rules.rate) * 1000) / 1000;
        if (t >= span.to) continue;
        let changed = rules.minPixels;
        if (kept && t - kept.t < rules.every) {
          changed = 0;
          for (let i = 0; i < area && changed < rules.minPixels; i++) if (Math.abs(data[i]! - kept.data[i]!) > rules.threshold) changed++;
        }
        if (changed < rules.minPixels) continue;
        kept = { t, data };
        times.push(t);
      }
    });
  }
  return times;
}

/**
 * Reads the screen's text of `screen` at `times` (source seconds) with the OCR helper, in order;
 * `onProgress` gets the share done. `ocr-missing` where the helper cannot run.
 */
export async function readFrames(
  screen: string,
  times: readonly number[],
  size: { width: number; height: number },
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ frames: ScreenTextFrame[]; language: string }> {
  const reader = await ScreenReader.start();
  const folder = mkdtempSync(join(tmpdir(), 'cuttle-screen-'));
  const extract = async (k: number) => {
    const path = join(folder, `${k}.png`);
    await runFfmpeg(['-ss', times[k]!.toFixed(3), '-i', screen, '-map', '0:v:0', '-frames:v', '1', '-y', path]);
    return path;
  };
  const frames: ScreenTextFrame[] = [];
  try {
    // the next frame is written while the OCR reads this one
    let next = times.length > 0 ? extract(0) : undefined;
    for (let k = 0; k < times.length; k++) {
      if (options.signal?.aborted) throw new CoreError('cancelled', 'reading the screen was cancelled');
      const path = await next!;
      next = k + 1 < times.length ? extract(k + 1) : undefined;
      next?.catch(() => {});
      const lines = await reader.read(path, size.width, size.height);
      rmSync(path, { force: true });
      frames.push({ t: times[k]!, lines });
      options.onProgress?.((k + 1) / times.length);
    }
    await next?.catch(() => {});
  } finally {
    reader.close();
    rmSync(folder, { recursive: true, force: true });
  }
  return { frames, language: reader.language };
}

/** Writes screen-text.jsonl (whole, or not at all). */
export function writeScreenText(path: string, frames: readonly ScreenTextFrame[]): void {
  writeFileSync(`${path}.part`, frames.map((frame) => `${JSON.stringify(frame)}\n`).join(''));
  renameSync(`${path}.part`, path);
}
```

`packages/core/src/privacy/apply.ts`:

```ts
// The privacy masks applied to a project: made from the screen's text (screen-text.jsonl) and the
// person's words, merged with the masks there by the tag rules: Cuttle's privacy masks are made
// again, one the person switched off stays off, every other mask stays.
import { readFile } from 'node:fs/promises';
import { newId, parseScreenTextJsonl, usedIds, type CuttleProject, type Rect, type ScreenTextFrame } from '@cuttle/project';
import { privacyMasks, type PrivacyMask } from './masks';
import type { SecretKind } from './patterns';

/** A mask as written to cuttle.json. */
export type RawMask = Record<string, unknown> & { from: number; to: number; rect: Rect; auto?: string; enabled?: boolean; label?: string };

/** The frames of a screen-text.jsonl; none when it cannot be read. */
export async function readScreenText(path: string): Promise<ScreenTextFrame[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseScreenTextJsonl(text).frames;
}

/** How many of each kind, for people: "2 email addresses, 1 key". */
const NAMES: Record<SecretKind, [string, string]> = {
  email: ['email address', 'email addresses'],
  key: ['key', 'keys'],
  token: ['token in a link', 'tokens in links'],
  value: ['secret value', 'secret values'],
  iban: ['IBAN', 'IBANs'],
  card: ['card number', 'card numbers'],
  phone: ['phone number', 'phone numbers'],
  word: ['word you always mask', 'words you always mask'],
};

export interface PrivacyMasksResult {
  masks: RawMask[];
  /** How many masks Cuttle made, and of which kinds. */
  made: number;
  kinds: Partial<Record<SecretKind, number>>;
  notes: string[];
}

const alike = (a: Rect, b: Rect) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter) >= 0.5;
};

/**
 * The project's masks with the privacy masks of `frames` (the person's `words` masked too): those
 * of Cuttle's earlier run (`auto: "privacy"`) are made again; a new one that takes the place of one
 * switched off (half its time, its rect half alike) stays off; every other mask stays.
 */
export function withPrivacyMasks(
  raw: Record<string, unknown>,
  project: CuttleProject,
  frames: readonly ScreenTextFrame[],
  screen: { width: number; height: number; duration?: number },
  words: readonly string[] = project.privacy.words,
  taken = usedIds(raw),
): PrivacyMasksResult {
  const old = (raw.masks as RawMask[] | undefined) ?? [];
  const off = old.filter((mask) => mask.auto === 'privacy' && mask.enabled === false);
  const staysOff = (mask: PrivacyMask) =>
    off.some((other) => {
      const shared = Math.min(other.to, mask.to) - Math.max(other.from, mask.from);
      return shared >= 0.5 * Math.min(other.to - other.from, mask.to - mask.from) && alike(other.rect, mask.rect);
    });
  const made = privacyMasks(frames, words, screen, screen.duration);
  const fresh: RawMask[] = made.map((mask) => ({
    id: newId('masks', taken),
    label: mask.label,
    from: mask.from,
    to: mask.to,
    rect: mask.rect,
    ...(mask.moves && { moves: mask.moves }),
    style: 'fill',
    ...(staysOff(mask) && { enabled: false }),
    auto: 'privacy',
  }));
  const kept = old.filter((mask) => mask.auto !== 'privacy');
  const kinds: Partial<Record<SecretKind, number>> = {};
  for (const mask of made) kinds[mask.kind] = (kinds[mask.kind] ?? 0) + 1;
  const notes: string[] = [];
  if (made.length > 0) {
    const list = Object.entries(kinds).map(([kind, count]) => `${count} ${NAMES[kind as SecretKind][count === 1 ? 0 : 1]}`);
    const stayOff = fresh.filter((mask) => mask.enabled === false).length;
    notes.push(`masked ${made.length} private thing${made.length === 1 ? '' : 's'} the screen showed: ${list.join(', ')}${stayOff > 0 ? `; ${stayOff} stay off, as before` : ''}`);
  } else notes.push(`nothing private found in the screen's text (${frames.length} frame${frames.length === 1 ? '' : 's'} read)`);
  return { masks: [...kept, ...fresh].sort((a, b) => a.from - b.from), made: made.length, kinds, notes };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project node packages/core/test/patterns.test.ts packages/core/test/privacy-masks.test.ts packages/core/test/privacy-ocr.test.ts`
Expected: PASS (on Windows the OCR reads the fixture in under a second).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "core: read the screen's text with Windows OCR, and find what is private in it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Privacy masks in `suggest` and the CLI

**Files:**
- Modify: `packages/core/src/{suggest,index}.ts`, `vitest.config.ts`, `apps/cli/src/{main,errors}.ts`, `apps/cli/test/cli.test.ts`, `apps/desktop/src/workers/media.ts`

- [ ] **Step 1: The tests**

A new test generates a screen with an email address, a shell line with a token that scrolls up and a name. It runs `suggest --mask` with the real OCR (Windows only) and checks the three masks, the token's moves, the linked screen text, the words kept, and the rerun. The answer test's snapshot gets `privacy` and the note that the screen was not read (the tests switch the OCR off).

In `apps/cli/test/cli.test.ts`, replace:

```ts
          "sped up 9.4 s without input 3× (5.1–14.5 s)",
          "no crop: no still edges around what changes",
          "zoom on Claude's answer at 15.5 s (145, 422, 448, 236)",
        ],
        "project": "<project>/cuttle.json",
        "scenes": [
          {
```

with:

```ts
          "sped up 9.4 s without input 3× (5.1–14.5 s)",
          "no crop: no still edges around what changes",
          "zoom on Claude's answer at 15.5 s (145, 422, 448, 236)",
          "the screen's text was not read: reading the screen is switched off (CUTTLE_OCR=off); no privacy masks from it, so look for private things yourself",
        ],
        "privacy": {
          "masks": 0,
          "read": false,
        },
        "project": "<project>/cuttle.json",
        "scenes": [
          {
```

In the same file, replace:

```ts
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe('cuttle frame', () => {
  it('writes a source frame at full size, with a numbered grid on request', async () => {
    const dir = temp();
```

with:

```ts
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe.runIf(process.platform === 'win32')('cuttle suggest reads the screen (Windows OCR)', () => {
  it('masks what the screen shows that is private, follows text that scrolls, and keeps the words asked for', async () => {
    const off = process.env.CUTTLE_OCR;
    delete process.env.CUTTLE_OCR;
    try {
      const dir = temp();
      mkdirSync(join(dir, 'takes', '1'), { recursive: true });
      // a 1280×720 screen: an email address, a shell line with a token that scrolls up 30 px a
      // second, and a name (Windows OCR drops a line that is one long NAME_WITH_UNDERSCORES=value
      // word in a large font; with a word before it, it reads it)
      // the drive's colon escaped for the option and again for the graph
      const text = (value: string, x: number, y: string) => `drawtext=fontfile=C\\\\:/Windows/Fonts/consola.ttf:fontsize=28:fontcolor=white:x=${x}:y=${y}:text='${value}'`;
      const graph = ['color=c=0x1e1e1e:s=1280x720:r=30:d=8', text('Signed in as lena.mueller@example.com', 80, '80'), text('export GITHUB_TOKEN=ghp_1234567890abcdefghijklmnop', 80, '420-t*30'), text('Thanks, Lena Müller', 80, '640')].join(',');
      const made = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', graph, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', '-y', join(dir, 'takes', '1', 'screen.mp4')]);
      expect(made.status, String(made.stderr)).toBe(0);
      const moves = Array.from({ length: 16 }, (_, k) => ({ t: 0.5 * k, type: 'move', x: 600 + 10 * k, y: 300 }));
      writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), moves.map((event) => `${JSON.stringify(event)}\n`).join(''));
      writeFileSync(join(dir, 'takes', '1', 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 } } }));
      writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4', events: 'takes/1/events.jsonl' } }));
      type Rect = [number, number, number, number];
      type Mask = { label: string; from: number; to: number; rect: Rect; moves?: { at: number; rect: Rect }[]; auto?: string; style?: string };
      const first = (await cli('--json', '-C', dir, 'suggest', '--no-crop', '--mask', 'Lena Müller')).json as { privacy: { read: boolean; masks: number }; notes: string[] };
      expect(first.privacy).toEqual({ read: true, masks: 3 });
      expect(first.notes.some((note) => /^read the screen's text in \d+ frames \(.+\), into takes\/1\/screen-text\.jsonl$/.test(note))).toBe(true);
      const file = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { masks: Mask[]; sources: { screenText?: string }; privacy?: { words: string[] } };
      expect(file.sources.screenText).toBe('takes/1/screen-text.jsonl');
      expect(file.privacy).toEqual({ words: ['Lena Müller'] });
      const byLabel = (label: string) => file.masks.find((mask) => mask.label === label)!;
      expect(file.masks.every((mask) => mask.auto === 'privacy' && mask.style === 'fill')).toBe(true);
      // the email holds still near the top; the name at the bottom
      expect(byLabel('Email address').rect[1]).toBeLessThan(120);
      expect(byLabel('Email address').moves).toBeUndefined();
      expect(byLabel('Always masked').rect[1]).toBeGreaterThan(600);
      // the token follows its line up the screen
      const key = byLabel('Key');
      // the OCR read the scrolling line in one frame of four: a move at each of those
      expect(key.moves!.length).toBeGreaterThanOrEqual(3);
      expect(key.moves!.at(-1)!.rect[1]).toBeLessThan(key.rect[1] - 100);
      // a rerun takes the screen's text read before, and the words from cuttle.json
      const again = (await cli('--json', '-C', dir, 'suggest', '--no-crop')).json as { privacy: { masks: number }; notes: string[] };
      expect(again.privacy.masks).toBe(3);
      expect(again.notes.some((note) => note.startsWith("read the screen's text"))).toBe(false);
      expect((await cli('--json', '-C', dir, 'suggest', '--no-crop', '--no-privacy', '--dry-run')).json).toMatchObject({ privacy: { read: false, masks: 0 } });
    } finally {
      if (off !== undefined) process.env.CUTTLE_OCR = off;
    }
  }, 120_000);
});

describe('cuttle frame', () => {
  it('writes a source frame at full size, with a numbered grid on request', async () => {
    const dir = temp();
```

- [ ] **Step 2: `suggest`, the flags, and no OCR in tests unless asked**

In `packages/core/src/suggest.ts`, replace:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { analyseScreen, grabGray, grayFrames, screenBands } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type ScreenTextFrame, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
import { analyseScreen, grabGray, grayFrames, screenBands } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { union } from './suggest/spans';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
```

In the same file, replace:

```ts
  dialogZooms?: boolean;
  /** Crops each clip to the content (default true): the window's content area, else the picture's still edges. */
  crop?: boolean;
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
```

with:

```ts
  dialogZooms?: boolean;
  /** Crops each clip to the content (default true): the window's content area, else the picture's still edges. */
  crop?: boolean;
  /** Masks what the screen showed that is private (default true): its text is read first where it was not yet. */
  privacy?: boolean;
  /** Words to mask wherever the screen shows them (a name, an address), kept in cuttle.json's `privacy.words`. */
  maskWords?: string[];
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
```

In the same file, replace:

```ts
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

with:

```ts
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy masks were made. */
  privacy: { read: boolean; masks: number };
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
```

In the same file, replace:

```ts
    if (left > 0) notes.push(`${left} click${left === 1 ? '' : 's'} got no zoom: sped up, or near a cut or another zoom`);
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = allZooms;
    if (cuts && (cuts.length > 0 || file.raw.cuts !== undefined)) file.raw.cuts = cuts;
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
  const result: SuggestResult = {
```

with:

```ts
    if (left > 0) notes.push(`${left} click${left === 1 ? '' : 's'} got no zoom: sped up, or near a cut or another zoom`);
  }

  // The privacy masks: what the screen showed that is private, from its text (read inside the new
  // clips where it was not yet) and the person's words.
  const words = [...new Set([...file.project.privacy.words, ...(args.maskWords ?? []).map((word) => word.trim()).filter(Boolean)])];
  let masks: RawMask[] | undefined;
  let privacy = { read: false, masks: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, args, notes);
    if (text) {
      const result = withPrivacyMasks(file.raw, file.project, text.frames, screenInfo, words, taken);
      notes.push(...result.notes);
      masks = result.masks;
      privacy = { read: true, masks: result.made };
      if (text.made) file.raw.sources = { ...(file.raw.sources as object), screenText: text.made };
    }
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = allZooms;
    if (cuts && (cuts.length > 0 || file.raw.cuts !== undefined)) file.raw.cuts = cuts;
    if (masks) file.raw.masks = masks;
    if (words.length > file.project.privacy.words.length) file.raw.privacy = { ...(file.raw.privacy as object), words };
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
  const result: SuggestResult = {
```

In the same file, replace:

```ts
    zooms: allZooms,
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

with:

```ts
    zooms: allZooms,
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    privacy,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
```

In the same file, replace:

```ts
  return result;
}

/**
 * Transcribes the mic before the cut when the take has one, it has no transcript yet, and a speech
 * model is downloaded; says why not otherwise. A failed transcription is noted, not thrown: the
```

with:

```ts
  return result;
}

/**
 * The screen's text: what was read before (`sources.screenText`), else read now inside `clips`
 * (not in a dry run) and written next to the screen track, which `made` names. Says why not where it
 * cannot be read: the masks from text are then left as they are.
 */
async function screenTextFor(
  dir: string,
  screen: string,
  linked: string | undefined,
  clips: readonly { from: number; to: number }[],
  size: { width: number; height: number },
  args: SuggestOptions,
  notes: string[],
): Promise<{ frames: ScreenTextFrame[]; made?: string } | undefined> {
  if (linked) {
    const frames = await readScreenText(resolve(dir, linked));
    if (frames) return { frames };
    notes.push(`${linked} cannot be read: it is read again`);
  }
  if (args.dryRun) {
    notes.push("the screen's text was not read (a dry run): no privacy masks from it");
    return undefined;
  }
  try {
    args.onStatus?.('reading the screen …');
    const spans = union(clips.map(({ from: start, to }) => ({ from: start, to })));
    const times = await framesToRead(screen, spans, size);
    let shown = 0;
    const { frames, language } = await readFrames(screen, times, size, {
      onProgress: (fraction) => {
        const percent = Math.floor(fraction * 10) * 10;
        if (percent > shown) args.onStatus?.(`reading the screen … ${(shown = percent)} %`);
      },
    });
    const path = join(dirname(screen), SCREEN_TEXT_FILE);
    writeScreenText(path, frames);
    notes.push(`read the screen's text in ${frames.length} frame${frames.length === 1 ? '' : 's'} (${language}), into ${relative(dir, path).split(sep).join('/')}`);
    return { frames, made: relative(dir, path).split(sep).join('/') };
  } catch (error) {
    if (!(error instanceof CoreError) || error.code !== 'ocr-missing') throw error;
    notes.push(`the screen's text was not read: ${error.message}; no privacy masks from it, so look for private things yourself`);
    return undefined;
  }
}

/**
 * Transcribes the mic before the cut when the take has one, it has no transcript yet, and a speech
 * model is downloaded; says why not otherwise. A failed transcription is noted, not thrown: the
```

In `packages/core/src/index.ts`, replace:

```ts
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CROP_RULES, areaStretches, bandCrop, cropOf, cropPieces, type CropStretch, type ScreenBands } from './suggest/crop';
export { DIALOG_RULES, dialogZooms, type DialogZoom } from './suggest/dialogs';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

with:

```ts
export { TYPING_RULES, keyBursts, screenStretches, typingZooms, type Burst, type ScreenChange, type TypingInput, type TypingZoom } from './suggest/typing';
export { CROP_RULES, areaStretches, bandCrop, cropOf, cropPieces, type CropStretch, type ScreenBands } from './suggest/crop';
export { DIALOG_RULES, dialogZooms, type DialogZoom } from './suggest/dialogs';
export { SECRET_KINDS, SECRET_LABELS, findSecrets, lineSecrets, type Secret, type SecretKind } from './privacy/patterns';
export { MASK_RULES, privacyMasks, type PrivacyMask } from './privacy/masks';
export { ScreenReader } from './privacy/ocr';
export { READ_RULES, SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
export { readScreenText, withPrivacyMasks, type PrivacyMasksResult, type RawMask } from './privacy/apply';
export { CLEAN_MIC_FILE, cleanMic, cleanupFilter, denoiseLatency } from './speech/cleanup';
```

In `vitest.config.ts`, replace:

```ts
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts'],
          // No speech model unless a test asks for one: a take with a mic is never transcribed by chance.
          env: { CUTTLE_MODELS_DIR: join(tmpdir(), 'cuttle-test-no-models') },
        },
      },
      {
```

with:

```ts
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts'],
          // No speech model unless a test asks for one: a take with a mic is never transcribed by
          // chance; and no OCR, which reads the screen of every take (a test that reads asks for it).
          env: { CUTTLE_MODELS_DIR: join(tmpdir(), 'cuttle-test-no-models'), CUTTLE_OCR: 'off' },
        },
      },
      {
```

In `apps/cli/src/main.ts`, replace:

```ts
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on dialogs, nor on typing, nor on clicks)')
    .option('--no-crop', 'no crop to the content (a browser\'s page without its tabs and bars)')
    .option('--no-dialog-zooms', 'no zooms on dialogs')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
```

with:

```ts
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on dialogs, nor on typing, nor on clicks)')
    .option('--no-crop', 'no crop to the content (a browser\'s page without its tabs and bars)')
    .option('--no-privacy', "no privacy masks (and the screen's text is not read)")
    .option('--mask <word>', 'mask this word wherever the screen shows it (a name, an address); kept in cuttle.json', (word: string, words: string[]) => [...words, word], [] as string[])
    .option('--no-dialog-zooms', 'no zooms on dialogs')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
```

In the same file, replace:

```ts
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, options: { claude?: string | true; zoom: boolean; crop: boolean; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, options, output),
      ),
    );
```

with:

```ts
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, { mask, ...options }: { claude?: string | true; zoom: boolean; crop: boolean; privacy: boolean; mask: string[]; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; dryRun?: boolean }) =>
        suggestCommand(project, { ...options, ...(mask.length > 0 && { maskWords: mask }) }, output),
      ),
    );
```

In `apps/cli/src/errors.ts`, replace:

```ts
  'model-missing': EXIT.usage,
  download: EXIT.device,
  'ffmpeg-old': EXIT.device,
};

/** A failure the CLI reports with a code and an exit code. */
```

with:

```ts
  'model-missing': EXIT.usage,
  download: EXIT.device,
  'ffmpeg-old': EXIT.device,
  'ocr-missing': EXIT.device,
};

/** A failure the CLI reports with a code and an exit code. */
```

In `apps/desktop/src/workers/media.ts`, replace:

```ts
      return meta;
    }
    case 'suggest': {
      // the app transcribes after the cut, as a step of its own (`transcribe`, `speech-edits`)
      await suggestProject(job.input, { transcribe: false, onStatus: () => reply({ id, progress: 0 }) });
      return undefined;
    }
    case 'transcribe': {
```

with:

```ts
      return meta;
    }
    case 'suggest': {
      // the app transcribes after the cut, as a step of its own (`transcribe`, `speech-edits`); the
      // screen's text is read in a step of its own too (P4-M5b): the cut leaves the privacy masks be
      await suggestProject(job.input, { transcribe: false, privacy: false, onStatus: () => reply({ id, progress: 0 }) });
      return undefined;
    }
    case 'transcribe': {
```

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run --project node packages/core apps/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core apps/cli vitest.config.ts apps/desktop/src/workers/media.ts
git commit -m "core, cli: suggest masks what the screen shows that is private (--no-privacy, --mask)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Masks that follow, in the editor

**Files:**
- Modify: `apps/desktop/src/shared/{document,edit,timeline-model}.ts`, `apps/desktop/src/renderer/editor/{SourceView,Inspector}.tsx`, `apps/desktop/src/renderer/editor/editor.css`
- Test: `apps/desktop/test/document.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/desktop/test/document.test.ts`, replace:

```ts
    expect(project(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 0.5 } }, limits)).zooms[0]!.moves).toHaveLength(2);
  });

  it('moves and scales the whole path the way the box at the playhead was dragged', () => {
    const path = { rect: [0, 200, 640, 400] as [number, number, number, number], moves: [{ at: 5, rect: [300, 200, 640, 400] as [number, number, number, number] }] };
    // the box at the playhead (on the move) went 100 px right and 50 px down
```

with:

```ts
    expect(project(applyCommand(following, { type: 'set', list: 'zooms', id: 'z1', fields: { at: 0.5 } }, limits)).zooms[0]!.moves).toHaveLength(2);
  });

  it('keeps a mask\'s path with its time too: a drag or a shift takes it along, an edge leaves it in the take', () => {
    const scrolling: Raw = {
      ...following,
      masks: [{ id: 'm1', from: 2, to: 8, rect: [10, 400, 300, 30], moves: [{ at: 4, rect: [10, 300, 300, 30] }, { at: 6, rect: [10, 200, 300, 30] }], auto: 'privacy' }],
    };
    const mask = (raw: Raw) => (raw.masks as Raw[])[0]!;
    expect(mask(applyCommand(scrolling, { type: 'set', list: 'masks', id: 'm1', fields: { from: 3, to: 9 } }, limits))).toMatchObject({ from: 3, moves: [{ at: 5 }, { at: 7 }] });
    expect(mask(applyCommand(scrolling, { type: 'shift', list: 'masks', id: 'm1', by: 1 }, limits)).moves).toMatchObject([{ at: 5 }, { at: 7 }]);
    expect(mask(applyCommand(scrolling, { type: 'set', list: 'masks', id: 'm1', fields: { from: 5 } }, limits))).toMatchObject({ from: 5, rect: [10, 300, 300, 30], moves: [{ at: 6 }] });
    expect(mask(applyCommand(scrolling, { type: 'set', list: 'masks', id: 'm1', fields: { moves: undefined } }, limits))).not.toHaveProperty('moves');
  });

  it('moves and scales the whole path the way the box at the playhead was dragged', () => {
    const path = { rect: [0, 200, 640, 400] as [number, number, number, number], moves: [{ at: 5, rect: [300, 200, 640, 400] as [number, number, number, number] }] };
    // the box at the playhead (on the move) went 100 px right and 50 px down
```

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts`
Expected: FAIL: a mask's moves stay where they were.

- [ ] **Step 2: The document and the gestures**

In `apps/desktop/src/shared/document.ts`, replace:

```ts

type Move = { at: number; rect: number[] };

/**
 * Keeps a zoom's moves with its time. Moved as a whole, they go with it (`by`); at a new speed of
 * its clip, they stretch with it from its start (`scale`); with an edge moved, they stay where they
 * are in the take. Moves no longer inside the zoom go, and when its start passed some, it starts
 * where the last of them went.
 */
function keepPath(item: Item, change: { by?: number; scale?: number } = {}): void {
  if (!Array.isArray(item.moves)) return;
  const at = Number(item.at);
  let moves = item.moves as Move[];
  if (change.by) moves = moves.map((move) => ({ ...move, at: move.at + change.by! }));
  if (change.scale) moves = moves.map((move) => ({ ...move, at: at + (move.at - at) * change.scale! }));
```

with:

```ts

type Move = { at: number; rect: number[] };

/** An item's source range: a mask's `from` and `to`, a zoom's `at` and `at + duration`. */
const rangeOf = (item: Item): [number, number] => (item.from !== undefined ? [Number(item.from), Number(item.to)] : [Number(item.at), Number(item.at) + Number(item.duration)]);

/**
 * Keeps a zoom's or mask's moves with its time. Moved as a whole, they go with it (`by`); at a new
 * speed of its clip, they stretch with it from its start (`scale`); with an edge moved, they stay
 * where they are in the take. Moves no longer inside it go, and when its start passed some, it
 * starts where the last of them went.
 */
function keepPath(item: Item, change: { by?: number; scale?: number } = {}): void {
  if (!Array.isArray(item.moves)) return;
  const [at, end] = rangeOf(item);
  let moves = item.moves as Move[];
  if (change.by) moves = moves.map((move) => ({ ...move, at: move.at + change.by! }));
  if (change.scale) moves = moves.map((move) => ({ ...move, at: at + (move.at - at) * change.scale! }));
```

In the same file, replace:

```ts
  const kept: Move[] = [];
  for (const move of moves) {
    const time = round(move.at);
    if (time > (kept.at(-1)?.at ?? at) && time < at + Number(item.duration)) kept.push({ ...move, at: time });
  }
  if (kept.length > 0) item.moves = kept;
  else delete item.moves;
```

with:

```ts
  const kept: Move[] = [];
  for (const move of moves) {
    const time = round(move.at);
    if (time > (kept.at(-1)?.at ?? at) && time < end) kept.push({ ...move, at: time });
  }
  if (kept.length > 0) item.moves = kept;
  else delete item.moves;
```

In the same file, replace:

```ts
    item.duration = round(Math.max(frame, Number(item.duration)));
  }
  if (Array.isArray(item.rect)) item.rect = clampRect(item.rect as number[], limits.screen);
  if (list === 'zooms' && Array.isArray(item.moves)) {
    item.moves = (item.moves as Move[]).map((move) => ({ at: Number(move.at), rect: clampRect(move.rect, limits.screen) }));
    keepPath(item);
  }
```

with:

```ts
    item.duration = round(Math.max(frame, Number(item.duration)));
  }
  if (Array.isArray(item.rect)) item.rect = clampRect(item.rect as number[], limits.screen);
  if ((list === 'zooms' || list === 'masks') && Array.isArray(item.moves)) {
    item.moves = (item.moves as Move[]).map((move) => ({ at: Number(move.at), rect: clampRect(move.rect, limits.screen) }));
    keepPath(item);
  }
```

In the same file, replace:

```ts
        const by = Math.max(command.by, -Number(item.from));
        item.from = Number(item.from) + by;
        item.to = Number(item.to) + by;
      } else {
        const at = Number(item.at);
        item.at = Math.max(0, at + command.by);
```

with:

```ts
        const by = Math.max(command.by, -Number(item.from));
        item.from = Number(item.from) + by;
        item.to = Number(item.to) + by;
        keepPath(item, { by });
      } else {
        const at = Number(item.at);
        item.at = Math.max(0, at + command.by);
```

In the same file, replace:

```ts
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      const before = { at: Number(item.at), duration: Number(item.duration) };
      claim(item, command.fields);
      setFields(item, command.fields);
      // a zoom's path goes with it when it moves as a whole, and stays in the take when an edge moves
      if (command.list === 'zooms' && !('moves' in command.fields)) keepPath(item, Number(item.duration) === before.duration ? { by: Number(item.at) - before.at } : {});
      touched.push([command.list, item]);
      break;
    }
```

with:

```ts
    }
    case 'set': {
      const { item } = find(next, command.list, command.id);
      const before = rangeOf(item);
      claim(item, command.fields);
      setFields(item, command.fields);
      // a path goes with its zoom or mask when it moves as a whole, and stays in the take when an edge moves
      if ((command.list === 'zooms' || command.list === 'masks') && !('moves' in command.fields)) {
        const after = rangeOf(item);
        keepPath(item, after[1] - after[0] === before[1] - before[0] ? { by: after[0] - before[0] } : {});
      }
      touched.push([command.list, item]);
      break;
    }
```

In the same file, replace:

```ts
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
          copy.to = Number(copy.to) + command.shift;
        } else if (command.list !== 'scenes') {
          copy.at = Number(copy.at) + command.shift;
          if (command.list === 'zooms') keepPath(copy, { by: command.shift });
```

with:

```ts
        if (command.list === 'masks') {
          copy.from = Number(copy.from) + command.shift;
          copy.to = Number(copy.to) + command.shift;
          keepPath(copy, { by: command.shift });
        } else if (command.list !== 'scenes') {
          copy.at = Number(copy.at) + command.shift;
          if (command.list === 'zooms') keepPath(copy, { by: command.shift });
```

In `apps/desktop/src/shared/edit.ts`, replace:

```ts
}

/**
 * A zoom's path (its rect and its moves' rects) moved and scaled the way the rect shown at the
 * playhead went from `from` to `to`: what the person drags is where the zoom is then, and the rest of
 * the path follows.
 */
export function movePath(path: { rect: Rect; moves?: readonly { at: number; rect: Rect }[] }, from: Rect, to: Rect): { rect: Rect; moves?: { at: number; rect: Rect }[] } {
  const scale = to[2] / from[2];
  const map = (rect: Rect): Rect => [Math.round(to[0] + (rect[0] - from[0]) * scale), Math.round(to[1] + (rect[1] - from[1]) * scale), Math.round(rect[2] * scale), Math.round(rect[3] * scale)];
  return { rect: map(path.rect), ...(path.moves && { moves: path.moves.map((move) => ({ at: move.at, rect: map(move.rect) })) }) };
}
```

with:

```ts
}

/**
 * A zoom's or mask's path (its rect and its moves' rects) moved and scaled the way the rect shown at
 * the playhead went from `from` to `to`: what the person drags is where it is then, and the rest of
 * the path follows.
 */
export function movePath(path: { rect: Rect; moves?: readonly { at: number; rect: Rect }[] }, from: Rect, to: Rect): { rect: Rect; moves?: { at: number; rect: Rect }[] } {
  const [sx, sy] = [to[2] / from[2], to[3] / from[3]];
  const map = (rect: Rect): Rect => [Math.round(to[0] + (rect[0] - from[0]) * sx), Math.round(to[1] + (rect[1] - from[1]) * sy), Math.round(rect[2] * sx), Math.round(rect[3] * sy)];
  return { rect: map(path.rect), ...(path.moves && { moves: path.moves.map((move) => ({ at: move.at, rect: map(move.rect) })) }) };
}
```

In `apps/desktop/src/shared/timeline-model.ts`, replace:

```ts
    cuts: cutNotches(project, spans),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom', (zoom) => (zoom.moves ?? []).map((move) => move.at)),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask'),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
    },
    markers: markers
```

with:

```ts
    cuts: cutNotches(project, spans),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom', (zoom) => (zoom.moves ?? []).map((move) => move.at)),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask', (mask) => (mask.moves ?? []).map((move) => move.at)),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
    },
    markers: markers
```

- [ ] **Step 3: The source view and the inspector**

In `apps/desktop/src/renderer/editor/SourceView.tsx`, replace:

```
import type { Rect } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { zoomTargetAt } from '@cuttle/timeline';
import { adjustRect, drawnRect, fitInside, movePath, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, cropClip, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
```

with:

```
import type { Rect } from '@cuttle/project';
import type { Command } from '../../shared/document';
import { formatSource } from '../../shared/format';
import { maskRectAt, zoomTargetAt } from '@cuttle/timeline';
import { adjustRect, drawnRect, fitInside, movePath, toSource, toStage, type Fit, type Handle } from '../../shared/edit';
import { addMask, addZoom, cropClip, overlayBlocked, playheadPlace } from './actions';
import { edit, preview } from './doc';
```

In the same file, replace:

```
  const zoomAt = (zoom: (typeof project.zooms)[number]): Rect => (frameAt === undefined ? zoom.rect : (zoomTargetAt(zoom, frameAt, speed).map((value) => Math.round(value)) as Rect));
  const boxes: Box[] = [
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoomAt(zoom), here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: mask.rect, here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  // that clip's crop, while cropping or selected
  if (croppedClip?.crop && croppedClip.id) boxes.push({ kind: 'crop', id: croppedClip.id, rect: croppedClip.crop.rect, here: true });
```

with:

```
  const zoomAt = (zoom: (typeof project.zooms)[number]): Rect => (frameAt === undefined ? zoom.rect : (zoomTargetAt(zoom, frameAt, speed).map((value) => Math.round(value)) as Rect));
  const boxes: Box[] = [
    ...project.zooms.map((zoom) => ({ kind: 'zoom' as const, id: zoom.id!, rect: zoomAt(zoom), here: frameAt !== undefined && frameAt >= zoom.at && frameAt < zoom.at + zoom.duration })),
    // a mask that follows covers, at that second, where it is (between two places both)
    ...project.masks.map((mask) => ({ kind: 'mask' as const, id: mask.id!, rect: frameAt === undefined ? mask.rect : maskRectAt(mask, frameAt), here: frameAt !== undefined && frameAt >= mask.from && frameAt < mask.to })),
  ].filter((box) => box.here || (selection?.kind === box.kind && selection.id === box.id));
  // that clip's crop, while cropping or selected
  if (croppedClip?.crop && croppedClip.id) boxes.push({ kind: 'crop', id: croppedClip.id, rect: croppedClip.crop.rect, here: true });
```

In the same file, replace:

```
    select({ kind: box.kind, id: box.id });
    const list = box.kind === 'zoom' ? 'zooms' : box.kind === 'mask' ? 'masks' : 'scenes';
    const clip = box.kind === 'crop' ? project.scenes.find((scene) => scene.id === box.id) : undefined;
    const path = box.kind === 'zoom' ? project.zooms.find((zoom) => zoom.id === box.id) : undefined;
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined).map((value) => Math.round(value));
        // a crop moved by hand is the person's: a new crop object, without the automatic tag; a zoom
        // that follows takes its whole path along
        const fields =
          box.kind === 'crop' && clip?.type === 'clip'
            ? { crop: { rect, ...(clip.crop?.enabled === false && { enabled: false }) } }
```

with:

```
    select({ kind: box.kind, id: box.id });
    const list = box.kind === 'zoom' ? 'zooms' : box.kind === 'mask' ? 'masks' : 'scenes';
    const clip = box.kind === 'crop' ? project.scenes.find((scene) => scene.id === box.id) : undefined;
    const path = box.kind === 'zoom' ? project.zooms.find((zoom) => zoom.id === box.id) : box.kind === 'mask' ? project.masks.find((mask) => mask.id === box.id) : undefined;
    let commands: Command[] | undefined;
    follow(
      event,
      (dx, dy) => {
        const rect = adjustRect(box.rect, handle, dx, dy, screen, box.kind === 'zoom' ? aspect : undefined).map((value) => Math.round(value));
        // a crop moved by hand is the person's: a new crop object, without the automatic tag; a zoom
        // or mask that follows takes its whole path along
        const fields =
          box.kind === 'crop' && clip?.type === 'clip'
            ? { crop: { rect, ...(clip.crop?.enabled === false && { enabled: false }) } }
```

In the same file, replace:

```
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {selected?.kind === 'zoom' && <ZoomPath fit={fit} zoom={project.zooms.find((zoom) => zoom.id === selected.id)} />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
```

with:

```
      <canvas ref={canvas} style={{ width: size.width, height: size.height }} />
      {(selected?.kind === 'zoom' || selected?.kind === 'crop') && <ZoomDim fit={fit} rect={selected.rect} size={size} />}
      {selected?.kind === 'zoom' && <ZoomPath fit={fit} zoom={project.zooms.find((zoom) => zoom.id === selected.id)} />}
      {selected?.kind === 'mask' && <ZoomPath fit={fit} zoom={project.masks.find((mask) => mask.id === selected.id)} kind="mask" />}
      {!selected && tool === 'crop' && boxes.some((box) => box.kind === 'crop') && <ZoomDim fit={fit} rect={boxes.find((box) => box.kind === 'crop')!.rect} size={size} />}
      {boxes.map((box) => {
        const at = toStage(box.rect, fit);
```

In the same file, replace:

```
                  : selected
                    ? ` · drag the box to place it, elsewhere for a new ${tool}`
                    : ` · drag to draw a ${tool}`
                : selected?.kind === 'zoom' && project.zooms.find((zoom) => zoom.id === selected.id)?.moves?.length
                  ? ' · it follows the dashed path: drag the box to move all of it, its handles to resize it'
                  : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
```

with:

```
                  : selected
                    ? ` · drag the box to place it, elsewhere for a new ${tool}`
                    : ` · drag to draw a ${tool}`
                : (selected?.kind === 'zoom' ? project.zooms : selected?.kind === 'mask' ? project.masks : []).find((item) => item.id === selected?.id)?.moves?.length
                  ? ' · it follows the dashed path: drag the box to move all of it, its handles to resize it'
                  : ' · drag the box to move it, its handles to resize it'}
        <span className="sep" />
```

In the same file, replace:

```
  );
}

/** A selected zoom that follows: the rects it moves through, dashed, and the way from one to the next. */
function ZoomPath({ fit, zoom }: { fit: Fit; zoom?: { rect: Rect; moves?: { rect: Rect }[] } }) {
  if (!zoom?.moves?.length) return null;
  const rects = [zoom.rect, ...zoom.moves.map((move) => move.rect)].map((rect) => toStage(rect, fit));
  const middles = rects.map((rect) => `${rect.x + rect.width / 2},${rect.y + rect.height / 2}`);
  return (
    <svg className="zoom-path" data-testid="zoom-path">
      {rects.map((rect, i) => (
        <rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      ))}
```

with:

```
  );
}

/** A selected zoom or mask that follows: the rects it moves through, dashed, and the way from one to the next. */
function ZoomPath({ fit, zoom, kind = 'zoom' }: { fit: Fit; zoom?: { rect: Rect; moves?: { rect: Rect }[] }; kind?: 'zoom' | 'mask' }) {
  if (!zoom?.moves?.length) return null;
  const rects = [zoom.rect, ...zoom.moves.map((move) => move.rect)].map((rect) => toStage(rect, fit));
  const middles = rects.map((rect) => `${rect.x + rect.width / 2},${rect.y + rect.height / 2}`);
  return (
    <svg className={`zoom-path${kind === 'mask' ? ' mask' : ''}`} data-testid={`${kind}-path`}>
      {rects.map((rect, i) => (
        <rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
      ))}
```

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
          <TextInput value={mask.label ?? ''} placeholder="Mask" onCommit={(value) => set('masks', id, { label: value.trim() || undefined }, 'Rename mask')} />
        </Row>
        {timing('masks', mask.from, mask.to)}
        {area('masks', mask.rect, 'mask')}
        <Row label="Style">
          <Select value={mask.style} options={MASK_STYLES} names={MASK_STYLE_NAMES} onChange={(style) => set('masks', id, { style }, 'Change mask style')} />
        </Row>
```

with:

```
          <TextInput value={mask.label ?? ''} placeholder="Mask" onCommit={(value) => set('masks', id, { label: value.trim() || undefined }, 'Rename mask')} />
        </Row>
        {timing('masks', mask.from, mask.to)}
        {area('masks', mask.rect, 'mask', mask.moves?.length ? 'Start, in source pixels' : undefined)}
        {mask.moves && mask.moves.length > 0 && (
          <Row label="Follows" note={`${mask.moves.length} move${mask.moves.length === 1 ? '' : 's'}`} plain>
            <button type="button" className="ghost small" onClick={() => set('masks', id, { moves: undefined }, 'Hold the mask still')} data-testid="mask-hold">
              Hold still
            </button>
          </Row>
        )}
        <Row label="Style">
          <Select value={mask.style} options={MASK_STYLES} names={MASK_STYLE_NAMES} onChange={(style) => set('masks', id, { style }, 'Change mask style')} />
        </Row>
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
.zoom-path circle {
  fill: var(--zoom);
}
.source-box.drawing {
  pointer-events: none;
}
```

with:

```
.zoom-path circle {
  fill: var(--zoom);
}
.zoom-path.mask rect,
.zoom-path.mask polyline {
  stroke: var(--mask);
}
.zoom-path.mask circle {
  fill: var(--mask);
}
.item.mask .move-mark {
  background: var(--mask);
}
.source-box.drawing {
  pointer-events: none;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm exec vitest run --project node apps/desktop/test/document.test.ts apps/desktop/test/timeline-model.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src apps/desktop/test/document.test.ts
git commit -m "desktop: a mask that follows: its path, its moves on the timeline, Hold still

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The skill

**Files:**
- Modify: `skill/cuttle/SKILL.md`, `skill/cuttle/project.md`

- [ ] **Step 1: Privacy first, with the help and its limits**

In `skill/cuttle/SKILL.md`, replace:

```markdown

Then refine `cuttle.json` ([project.md](project.md)) and preview again:

- **Privacy first.** Look for names, email addresses, tokens and API keys, file paths with user
  names, hook or plugin errors, and notifications.
  - Twelve stills miss things: step through sped-up stretches with `preview --at` about every
    output second.
  - For each find, take the still's `source` second and run
```

with:

```markdown

Then refine `cuttle.json` ([project.md](project.md)) and preview again:

- **Privacy first.** On Windows `suggest` reads the screen's text (Windows' own OCR, on this
  computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers (masks tagged `auto: "privacy"`,
  following text that scrolls). Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
  grey text and some lines, so **still look** yourself. Look for names, email addresses, tokens and
  API keys, file paths with user names, hook or plugin errors, and notifications.
  - Twelve stills miss things: step through sped-up stretches with `preview --at` about every
    output second.
  - For each find, take the still's `source` second and run
```

In `skill/cuttle/project.md`, replace:

```markdown
transcript.json: `{ "language", "model", "words": [{ "t", "end", "text" }], "sounds": [{ "t", "end" }] }`,
in source seconds; `sounds` are stretches the mic heard without a word (a cough, a dropped filler).
`cleanMic` is the mic cleaned up with it (less noise, even loudness), played instead of the mic
while `look.audio.cleanup` is on.

`look` (every field is optional):
```

with:

```markdown
transcript.json: `{ "language", "model", "words": [{ "t", "end", "text" }], "sounds": [{ "t", "end" }] }`,
in source seconds; `sounds` are stretches the mic heard without a word (a cough, a dropped filler).
`cleanMic` is the mic cleaned up with it (less noise, even loudness), played instead of the mic
while `look.audio.cleanup` is on. `screenText` is the screen's text, read where the picture
changed (`suggest`, on Windows): one JSON line per frame read,
`{ "t", "lines": [{ "text", "rect", "words": [{ "text", "rect" }] }] }`. Read it to find what the
screen showed where; never edit it.

`look` (every field is optional):
```

In the same file, replace:

```markdown
`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
few pixels too small leaves letters readable. Masks cover clips only, not still scenes (a captured
page).

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
```

with:

```markdown
`masks` hide private things: `from` and `to` (source seconds), `rect`, `style` (`fill`: the colour
around it, safest for tokens and keys; `blur`) and `enabled` (`true`). Make the rect generous: a
few pixels too small leaves letters readable. Masks cover clips only, not still scenes (a captured
page). A mask over text that scrolls has `moves` (`[{ "at", "rect" }]`, as a zoom's): its places
are `rect` at `from`, then each move's; between two places it covers both. `privacy.words` are
words masked wherever the screen shows them (`suggest --mask` adds to them).

`texts`: `at` and `duration` (source seconds), `text`, `style` (`pill`, `lower-third`, `caption`),
`position` (`top`, `center`, `bottom`) and `enabled` (`true`). A `top` text sits over the window's
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run --project node skill/test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add skill
git commit -m "skill: the privacy masks from the screen's text, --mask, and masks that follow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: The check**

A privacy mask over text that scrolls comes into the demo project from outside. The check finds its diamonds, its path in the source view, its box covering both places between two, and holds it still.

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await editor.waitForFunction(() => document.querySelectorAll('.item.zoom[data-id=z8]').length === 0);
  }, 45_000);

  it('crops a clip in the source view: the window takes the crop’s shape; the crop is switched off in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await press('.scene[data-id=s1]');
```

with:

```ts
    await editor.waitForFunction(() => document.querySelectorAll('.item.zoom[data-id=z8]').length === 0);
  }, 45_000);

  it('shows a privacy mask that follows text up the screen: its path in the source view, the Auto tab row, Hold still', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    // suggest's mask over a token that scrolled up between 0.5 and 2.5 s
    const outside = onDisk() as unknown as { masks: unknown[] };
    outside.masks.push({ id: 'm8', label: 'Key', from: 0.2, to: 2.8, rect: [300, 500, 500, 40], moves: [{ at: 1, rect: [300, 500, 500, 40] }, { at: 1.5, rect: [300, 400, 500, 40] }, { at: 2, rect: [300, 300, 500, 40] }], style: 'fill', auto: 'privacy' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.mask[data-id=m8] .move-mark');
    await click(editor, '#tab-auto');
    await click(editor, '[data-testid=auto-group-privacy] .auto-toggle');
    await click(editor, '[data-testid=auto-group-privacy] .auto-item');
    await editor.waitForSelector('[data-testid=mask-path]');
    // between two places it covers both: one place is 500 × 40, at 1.25 s it is 500 × 140
    const shape = async () => {
      const box = (await editor.locator('.source-box.mask.selected').boundingBox())!;
      return box.width / box.height;
    };
    await seek(1.25);
    await expect.poll(shape).toBeLessThan(5);
    await click(editor, '#tab-selection');
    await editor.waitForSelector('[data-testid=mask-hold]');
    await shot('33-privacy-mask');
    await click(editor, '[data-testid=mask-hold]');
    await savedWhen((file) => (file.masks.find((mask) => mask.id === 'm8') as unknown as { moves?: unknown }).moves === undefined);
    expect((await doc()).undo).toBe('Hold the mask still');
    await editor.keyboard.press('Escape');
    await undoAll();
    writeFileSync(projectFile(), original);
    await editor.waitForFunction(() => document.querySelectorAll('.item.mask[data-id=m8]').length === 0);
  }, 45_000);

  it('crops a clip in the source view: the window takes the crop’s shape; the crop is switched off in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await press('.scene[data-id=s1]');
```

- [ ] **Step 2: Run it, with screenshots, and look at them**

```bash
mkdir -p "$TEMP/cuttle-p4m5a-shots"
CUTTLE_HIDDEN=1 CUTTLE_RECORDER_BACKEND=test CUTTLE_CHECK_SHOTS="$TEMP/cuttle-p4m5a-shots" pnpm app:check
```

Expected: PASS, 43 tests. Look at `33-privacy-mask`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/app.check.test.ts
git commit -m "desktop: app:check shows a privacy mask that follows text and holds it still

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: All tests, the typecheck, the checks and the packaged build**

Run: `pnpm test`
Expected: PASS, 656 passed and 53 skipped (on a machine without a speech model the real transcription is skipped too: 655 and 54; off Windows the two OCR tests are skipped too).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm cli:check`
Expected: PASS, 5 tests.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

Run: `git status --short`
Expected: no output.

- [ ] **Step 2: By hand (the user)**

1. Record a take that shows an email address, a `.env` file and a token in a terminal. Run `cuttle suggest --mask "<your name>"`: the masks are there in the editor's Auto tab ("Private things masked"), and play over them.
2. Scroll a page with an email address on it: the mask follows.
3. Note what was missed: Windows OCR drops some lines (see below). Claude still looks.

## Changes during execution

**How this plan was made and checked**
- It was written from the finished prototype. Its tasks were replayed on a fresh clone for their commits (the fixture PNG copied in), and the tree came out byte-identical to the prototype.
- The checks ran once, on the prototype, whose tree the replay matches byte for byte: the task steps' tests, `pnpm test`, the typecheck, `app:check` and `cli:check`. The packaged build (`pnpm app:build`) ran on the replayed commits.
- The OCR's behaviour was probed on the fixture and on generated frames (scales, resampling, inverted pictures, lines alone and with a word before them).

**Found while checking, and already in the plan above**
- **The decoder's Fant scaling lost a line** the pre-scaled picture gave; cubic gives the same as lanczos. The helper scales with cubic.
- **Windows OCR drops a line that is one long `NAME_WITH_UNDERSCORES=value` word in a larger font** (28 px Consolas: nothing; 16 px: "GITHUB"). It reads it with a word before it (`export GITHUB_TOKEN=…`), or with its underscores read as spaces in small type (the fixture's `.env`). Inverting the picture, other scales, a word drawn beside it or squeezing it changed nothing. It is a limit of the OCR, said in the skill: the guard helps, Claude still looks.
- **A token that scrolled was read in one frame of four** (the others gave only "export"). Two missed frames closed its mask and left gaps; a secret is gone only after 2.5 s without it.
- **A mask ended 0.5 s after the last sight** though the screen did not change (no frame was read) until much later. A mask now lasts until a frame shows the secret gone.
- **A key in a `TOKEN=` line** gave two masks (key and value), counted twice; masks over the same place become one, also when they move.
- **The user:password part of a link** reads as an email address too; it is masked either way.
- **The OCR missed the small grey card number and the wrapped end of a curl line** on the fixture, as in the spike; the test checks what it read.
- **Running the OCR in every test** that calls `suggest` would cost seconds each: the test config switches it off (`CUTTLE_OCR=off`), and the OCR tests switch it on.
- **The new CLI test did not typecheck** (rects as `number[]`); it types them as tuples.
- **A recorder timing test wobbled** in one full run under load ("stops while paused": 0.56 s off, 0.5 allowed). It passed three times alone, its code is unchanged here, and a clean full run passed.

**Spec points that move**
- **M5 is split** (above). The notification masks, "Always mask" in the app, the app's privacy step and the picker's hint come in M5b.
- **A mask's places include its start:** its rect at `from` counts as the first place. Between it and the first move the mask covers both, so a secret that moved before the second sighting is covered too.
- **The end of a mask** is the first frame that shows the secret gone, not 0.5 s after the last sight: frames are read where the picture changes.
- **A golden image of a mask between two keyframes** is not needed: the engine draws the rect the timeline gives, which `maskRectAt`'s tests cover.
