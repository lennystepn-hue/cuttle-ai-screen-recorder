# Cuttle Phase 3: Smoothed Cursor, Zooms on Clicks, Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cursor glides instead of jittering, and clicks stay exactly where they were. `suggest` and the editor zoom in where clicks happen at normal speed. The Look tab shows the cursor and frame styles as pictures the engine draws, and a moved scene has a ghost that follows the pointer.

**Architecture:**
- **Smoothing** is a pure function of the take's input and `look.cursor.smoothing`. The cursor track keeps the recorded path and makes a smoothed one per smoothing on first use, so the editor and the export draw the same path:
  - the path is cut into stretches at clicks, rests and jumps;
  - each stretch is resampled at 120 Hz and smoothed by a centred Gaussian (no lag);
  - its ends are pinned to their anchors.
- **Zooms on clicks** are a pure function in `@cuttle/timeline`, shared by `suggest` and the editor's command:
  - left clicks at normal speed are grouped by time and place;
  - each group gets a zoom in the screen's shape that eases in as the first click happens;
  - fewer, better zooms: merged when they show the same spot, never two at once, at most one starting in any 5 output seconds.
- **The swatches** are drawn by the engine's renderer on an offscreen canvas, once per editor.

**Tech Stack:** TypeScript strict, vitest 5 (node and browser), Electron 44.7.2, React 19.3.0, Playwright 1.64.1 (`_electron`).

Spec: `docs/superpowers/specs/2026-10-17-cuttle-phase3-design.md` (committed before this plan). Phase 2 (done): `docs/superpowers/plans/2026-10-17-cuttle-p2-m4-pause-first-run.md`.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `phase-3`, in Git Bash; the `pnpm` commands also work in PowerShell.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- If `pnpm install` fails with EPERM on Windows, run it again.
- ffmpeg and ffprobe must be on PATH. The checks never show a window and never capture this machine.
- The task steps run only the tests they touch; the full `pnpm test` runs in Task 5.

## Decisions made while planning

A prototype of the whole phase, reviewed against the spec, settled these points. On the prototype, `pnpm test` passes 506 tests (44 skipped), `pnpm typecheck` exits with 0, `pnpm app:check` passes its 35 tests, and `pnpm app:build` packages the app and passes its 4.

- **Smoothing** (`packages/timeline/src/cursor.ts`).
  - `look.cursor.smoothing` runs from 0 (the path as recorded) to 1 (very smooth). The default is 0.5, so old projects are smoothed on their next render.
  - Anchors cut the path into stretches:
    - every click, kept exactly;
    - a rest of 0.25 s or more, where the cursor holds still until the next move;
    - a jump of 400 px or more within 20 ms, which is not smoothed across;
    - the first and last sample.
  - Each stretch is resampled at 120 Hz and smoothed by a centred Gaussian, sigma `0.02 + 0.16 × smoothing` s, its window cut at the stretch's ends. Each end's error then fades out within 3 sigma, so an anchor's own jitter bends the path near it only.
  - `cursorAt(track, t, speed, smoothing)` reads a smoothed path made once per track and smoothing. The editor's track serves every smoothing the Look tab picks.
  - The one golden whose cursor moved (`crossfade-clips`) pins smoothing 0. Its samples are 2 s apart, so smoothing would hold its cursor still through that rest; the golden is about the crossfade, not the cursor.
- **Zooms on clicks** (`packages/timeline/src/click-zooms.ts`).
  - Considered: left clicks inside clips at most 2× fast.
  - A click joins the open group when it comes within 3 s of the last click, in the same clip, and the group's box stays within 40 % of the screen's width and height.
  - The zoom covers the box padded by 10 % of the screen's width, is at least 45 % of the width (at most about 2.2×), has the screen's shape, and stays on the screen.
  - It starts 0.7 s before the first click and lasts until 1.2 s after the last, at least 1.8 s. It stays a second away from its clip's cuts; when that leaves less than 1.8 s there is no zoom.
  - Two neighbours whose rects overlap 60 % (of the smaller) and that are 1.5 s apart or less become one.
  - Dropped: a zoom that would show more than 80 % of the screen, one that meets another zoom (`avoid`: the answer zoom), and one that starts within 5 output seconds of the last.
  - `suggest` adds them after the answer zoom ("Click", "Clicks"). `--no-click-zooms` leaves them out, and `--no-zoom` leaves out every zoom.
  - The editor's "Auto-zoom on clicks" replaces the Click/Clicks zooms with a fresh set, as one step to undo, and keeps clear of zooms made by hand.
- **Swatches** (`apps/desktop/src/renderer/editor/swatches.ts`).
  - The Look tab draws the frame styles and the cursor styles once, on an offscreen canvas, with the engine's renderer: a one-clip project on a calm background.
  - A frame shows its window's top-left corner, enlarged by CSS. A cursor shows close up, through a zoom on the screen.
  - The pictures are object URLs (the page's CSP allows `blob:`). The System cursor is named "System".
- **A ghost under a moved scene.** While a scene is dragged, a translucent block with its name follows the pointer; the insert mark still says where it lands.
- **Movement** in the Look tab's cursor section: As recorded, Light smoothing, Smooth, Very smooth (0, 0.3, 0.5, 0.8). A value set in cuttle.json shows as it is.
- **Not in this phase:**
  - Pickers created at start, and a busy camera tried again. Measure the picker first; no camera here can be made busy.
  - macOS: no Mac here.

## File structure

```
cuttle/
├── README.md                                  suggest's zooms on clicks
├── skill/cuttle/                              SKILL.md (--no-click-zooms), project.md (cursor.smoothing)
├── packages/project/                          schema (cursor.smoothing); test
├── packages/timeline/                         cursor (the smoothed path), frame, click-zooms (new), index; tests
├── packages/engine/test/scenarios.ts          crossfade-clips pins smoothing 0
├── packages/core/src/suggest.ts               zooms on clicks
├── apps/cli/                                  main (--no-click-zooms), commands/suggest; test
└── apps/desktop/
    ├── src/shared/names.ts                    "System"
    ├── src/renderer/editor/                   swatches (new); Inspector, session, actions, commands, Timeline, editor.css
    └── test/app.check.test.ts                 swatches, movement, the ghost, auto-zoom
```

---

### Task 1: The smoothed cursor

**Files:**
- Modify: `packages/project/src/schema.ts`, `packages/project/test/schema.test.ts`, `packages/timeline/src/{cursor,frame}.ts`, `packages/timeline/test/cursor.test.ts`, `packages/engine/test/scenarios.ts`, `skill/cuttle/project.md`

- [ ] **Step 1: The branch**

The spec and this plan were committed on the branch `phase-3`; work there:

```bash
git switch phase-3
```

- [ ] **Step 2: Write the failing tests**

In `packages/timeline/test/cursor.test.ts`, replace:

```ts
    expect(cursorAt(createCursorTrack([]), 1, 1)).toBeUndefined();
  });
});
```

with:

```ts
    expect(cursorAt(createCursorTrack([]), 1, 1)).toBeUndefined();
  });
});

describe('the smoothed path', () => {
  /** A hand's move: 60 samples a second with jitter (deterministic), a click at 1 s, a rest, a jump. */
  const jittery: InputEvent[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    jittery.push({ t, type: 'move', x: 100 + 400 * t + (i % 2 ? 6 : -6), y: 300 + (i % 3) * 5 });
  }
  jittery.push({ t: 1, type: 'click', x: 500, y: 300, button: 'left' });
  for (let i = 1; i <= 30; i++) jittery.push({ t: 1 + i / 60, type: 'move', x: 500 + 10 * i + (i % 2 ? 4 : -4), y: 300 });
  // a rest of 2 s, then a jump to the other side of the screen
  jittery.push({ t: 3.5, type: 'move', x: 801, y: 301 });
  jittery.push({ t: 3.51, type: 'move', x: 1800, y: 900 });
  jittery.push({ t: 3.6, type: 'move', x: 1810, y: 905 });
  const hand = createCursorTrack(jittery);

  it('is the recorded path at smoothing 0', () => {
    expect(cursorAt(hand, 0.5, 1, 0)).toMatchObject(cursorAt(hand, 0.5, 1)!);
    expect(cursorAt(hand, 0.51, 1, 0)!.x).toBeCloseTo(100 + 400 * 0.51 + (Math.round(0.51 * 60) % 2 ? 6 : -6) - 0, -1);
  });

  it('is exactly at every click, at its time, whatever the smoothing', () => {
    for (const smoothing of [0.3, 0.5, 1]) expect(cursorAt(hand, 1, 1, smoothing)).toMatchObject({ x: 500, y: 300 });
  });

  it('takes the jitter out without lagging behind the hand', () => {
    const at = (t: number, smoothing: number) => cursorAt(hand, t, 1, smoothing)!;
    // the jitter (±6 px every sample) is gone: neighbouring frames differ by the move's own step
    const steps = (smoothing: number) => Array.from({ length: 40 }, (_, i) => Math.abs(at(0.2 + (i + 1) / 120, smoothing).x - at(0.2 + i / 120, smoothing).x));
    expect(Math.max(...steps(0.5))).toBeLessThan(5);
    expect(Math.max(...steps(0))).toBeGreaterThan(5);
    // zero-phase: in the middle of a steady move the smoothed cursor is where the hand is on average
    expect(at(0.5, 0.5).x).toBeCloseTo(100 + 400 * 0.5, -1);
  });

  it('holds still through a rest, and jumps where the pointer jumped', () => {
    const rested = cursorAt(hand, 1.5, 1, 0.5)!;
    expect(cursorAt(hand, 2.5, 1, 0.5)).toMatchObject({ x: rested.x, y: rested.y });
    expect(cursorAt(hand, 3.4, 1, 0.5)).toMatchObject({ x: rested.x, y: rested.y });
    expect(cursorAt(hand, 3.51, 1, 0.5)).toMatchObject({ x: 1800, y: 900 });
    expect(cursorAt(hand, 3.6, 1, 0.5)).toMatchObject({ x: 1810, y: 905 });
  });

  it('is made once per smoothing and track', () => {
    cursorAt(hand, 0.3, 1, 0.8);
    const first = hand.smoothed!.get(0.8);
    cursorAt(hand, 0.7, 1, 0.8);
    expect(hand.smoothed!.get(0.8)).toBe(first);
  });
});
```

In `packages/project/test/schema.test.ts`, replace:

```ts
    expect(p.output).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(p.look.background).toEqual({ preset: 'sunset-sky' });
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple' });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
```

with:

```ts
    expect(p.output).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(p.look.background).toEqual({ preset: 'sunset-sky' });
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
```

In the same file, replace:

```ts

  it('fills the remaining defaults of a partial block', () => {
    const p = ProjectSchema.parse({ ...minimal, look: { cursor: { style: 'dot' } } });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'dot', size: 1, color: '#D97757', clickEffect: 'ripple' });
  });

  it('rejects non-finite numbers', () => {
```

with:

```ts

  it('fills the remaining defaults of a partial block', () => {
    const p = ProjectSchema.parse({ ...minimal, look: { cursor: { style: 'dot' } } });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'dot', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
  });

  it('rejects non-finite numbers', () => {
```

Run: `pnpm exec vitest run --project node packages/timeline/test/cursor.test.ts packages/project/test/schema.test.ts`
Expected: FAIL: the smoothed path is the recorded one (no smoothing yet), and the schema has no `smoothing`.

- [ ] **Step 3: The smoothed path, in the format and the frame**

In `packages/project/src/schema.ts`, replace:

```ts
  size: z.number().positive().max(4).default(1),
  color: hexColor.default('#D97757'),
  clickEffect: z.enum(CLICK_EFFECTS).default('ripple'),
});

const WebcamSchema = z.strictObject({
```

with:

```ts
  size: z.number().positive().max(4).default(1),
  color: hexColor.default('#D97757'),
  clickEffect: z.enum(CLICK_EFFECTS).default('ripple'),
  /** How smooth the drawn path is: 0 as recorded, 1 very smooth (clicks stay exact). */
  smoothing: z.number().min(0).max(1).default(0.5),
});

const WebcamSchema = z.strictObject({
```

In `packages/timeline/src/cursor.ts`, replace:

```ts
/** Click effect length in output seconds; converted to source seconds with the scene speed. */
export const CLICK_EFFECT_SECONDS = 0.4;

export interface CursorTrack {
  moves: { t: number; x: number; y: number }[];
  clicks: { t: number; x: number; y: number; button: 'left' | 'right' | 'middle' }[];
  shapes: { t: number; shape: CursorShape }[];
}

export interface CursorFrame {
```

with:

```ts
/** Click effect length in output seconds; converted to source seconds with the scene speed. */
export const CLICK_EFFECT_SECONDS = 0.4;

/** The smoothed path's samples per source second. */
export const SMOOTH_RATE = 120;
/** No move for this long is a rest: the cursor holds still, it is not smoothed across. */
export const REST_SECONDS = 0.25;
/** A move this far within one sample (at most `JUMP_SECONDS`) is a jump, not smoothed across. */
export const JUMP_PX = 400;
export const JUMP_SECONDS = 0.02;

type Point = { t: number; x: number; y: number };

export interface CursorTrack {
  moves: Point[];
  clicks: { t: number; x: number; y: number; button: 'left' | 'right' | 'middle' }[];
  shapes: { t: number; shape: CursorShape }[];
  /** Smoothed paths made so far, by smoothing (made on first use, kept for the track's life). */
  smoothed?: Map<number, Point[]>;
}

export interface CursorFrame {
```

In the same file, replace:

```ts
  return track;
}

function positionAt(moves: CursorTrack['moves'], t: number): { x: number; y: number } {
  const first = moves[0]!;
  const last = moves[moves.length - 1]!;
  if (t <= first.t) return { x: first.x, y: first.y };
```

with:

```ts
  return track;
}

/** The Gaussian's sigma in source seconds for a smoothing of 0–1 (0.5: 0.1 s). */
export const smoothingSigma = (smoothing: number) => 0.02 + 0.16 * smoothing;

/**
 * The indexes of `moves` where the path is cut into stretches that are smoothed on their own: the
 * first and last sample, every click (it must be exact), both sides of a rest (the cursor holds
 * still) and of a jump (a teleport is not smoothed across).
 */
export function anchorsOf(moves: readonly Point[], clicks: readonly { t: number }[]): number[] {
  const anchors = new Set<number>([0, moves.length - 1]);
  const clickTimes = new Set(clicks.map((click) => click.t));
  for (let i = 0; i < moves.length; i++) {
    if (clickTimes.has(moves[i]!.t)) anchors.add(i);
    if (i === 0) continue;
    const a = moves[i - 1]!;
    const b = moves[i]!;
    const rest = b.t - a.t >= REST_SECONDS;
    const jump = b.t - a.t <= JUMP_SECONDS && Math.hypot(b.x - a.x, b.y - a.y) >= JUMP_PX;
    if (rest || jump) {
      anchors.add(i - 1);
      anchors.add(i);
    }
  }
  return [...anchors].sort((a, b) => a - b);
}

/** The path between two samples, resampled at `SMOOTH_RATE` (its ends are the samples themselves). */
function resample(moves: readonly Point[], from: number, to: number): Point[] {
  const start = moves[from]!;
  const end = moves[to]!;
  const count = Math.max(2, Math.round((end.t - start.t) * SMOOTH_RATE) + 1);
  const points: Point[] = [];
  let k = from;
  for (let i = 0; i < count; i++) {
    const t = i === count - 1 ? end.t : start.t + ((end.t - start.t) * i) / (count - 1);
    while (k < to - 1 && moves[k + 1]!.t <= t) k++;
    const a = moves[k]!;
    const b = moves[Math.min(k + 1, to)]!;
    const f = b.t === a.t ? 0 : clamp01((t - a.t) / (b.t - a.t));
    points.push({ t, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
  }
  return points;
}

/**
 * One stretch smoothed: a centred Gaussian (no lag), its window cut at the stretch's ends, then the
 * ends' errors faded out near them, so it starts and ends exactly at its anchors.
 */
function smoothStretch(points: Point[], sigma: number): Point[] {
  const n = points.length;
  if (n <= 2) return points;
  const radius = Math.ceil(3 * sigma * SMOOTH_RATE);
  const weights = Array.from({ length: radius + 1 }, (_, d) => Math.exp(-((d / SMOOTH_RATE) ** 2) / (2 * sigma * sigma)));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let total = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) {
      const w = weights[Math.abs(j - i)]!;
      x += points[j]!.x * w;
      y += points[j]!.y * w;
      total += w;
    }
    out.push({ t: points[i]!.t, x: x / total, y: y / total });
  }
  // The ends' errors fade out within the kernel's reach (or the stretch, when it is shorter): an
  // anchor's own jitter bends the path near it only, not the whole stretch.
  const first = { x: points[0]!.x - out[0]!.x, y: points[0]!.y - out[0]!.y };
  const last = { x: points[n - 1]!.x - out[n - 1]!.x, y: points[n - 1]!.y - out[n - 1]!.y };
  const reach = Math.min(radius, n - 1);
  const fade = (distance: number) => {
    const u = clamp01(1 - distance / reach);
    return u * u * (3 - 2 * u);
  };
  return out.map((point, i) => {
    const a = fade(i);
    const b = fade(n - 1 - i);
    return { t: point.t, x: point.x + first.x * a + last.x * b, y: point.y + first.y * a + last.y * b };
  });
}

/** The path the cursor draws at `smoothing` (0: as recorded), made once per track and smoothing. */
export function smoothedPath(track: CursorTrack, smoothing: number): Point[] {
  if (smoothing <= 0 || track.moves.length < 3) return track.moves;
  track.smoothed ??= new Map();
  const known = track.smoothed.get(smoothing);
  if (known) return known;
  const sigma = smoothingSigma(Math.min(1, smoothing));
  const anchors = anchorsOf(track.moves, track.clicks);
  const path: Point[] = [];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const from = anchors[k]!;
    const to = anchors[k + 1]!;
    const a = track.moves[from]!;
    const b = track.moves[to]!;
    // between two anchors next to each other: a rest holds still until the next move, a jump jumps
    const stretch =
      to - from > 1 ? smoothStretch(resample(track.moves, from, to), sigma) : b.t - a.t >= REST_SECONDS ? [a, { t: b.t - 1 / SMOOTH_RATE, x: a.x, y: a.y }, b] : [a, b];
    path.push(...(path.length > 0 ? stretch.slice(1) : stretch));
  }
  track.smoothed.set(smoothing, path);
  return path;
}

function positionAt(moves: readonly Point[], t: number): { x: number; y: number } {
  const first = moves[0]!;
  const last = moves[moves.length - 1]!;
  if (t <= first.t) return { x: first.x, y: first.y };
```

In the same file, replace:

```ts
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}

export function cursorAt(track: CursorTrack, sourceTime: number, speed: number): CursorFrame | undefined {
  if (track.moves.length === 0) return undefined;
  const { x, y } = positionAt(track.moves, sourceTime);

  let shape: CursorShape = 'arrow';
  for (const change of track.shapes) {
```

with:

```ts
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}

/** The cursor at a source time: on the path smoothed by `smoothing` (0, the default: as recorded). */
export function cursorAt(track: CursorTrack, sourceTime: number, speed: number, smoothing = 0): CursorFrame | undefined {
  if (track.moves.length === 0) return undefined;
  const { x, y } = positionAt(smoothedPath(track, smoothing), sourceTime);

  let shape: CursorShape = 'arrow';
  for (const change of track.shapes) {
```

In `packages/timeline/src/frame.ts`, replace:

```ts
    const pastEnd = t >= span.end || !inside(local);
    const sourceLocal = pastEnd ? clamp(lastFrameShown(span, inside) - span.start, 0, length) : local;
    const sourceTime = sourceTimeAt(scene, sourceLocal);
    let cursor = project.look.cursor.enabled && opts.cursor ? cursorAt(opts.cursor, sourceTime, scene.speed) : undefined;
    if (cursor && project.look.cursor.clickEffect === 'none') cursor = { ...cursor, clicks: [] };
    // The output time this source frame belongs to (a held or frozen frame's, during a crossfade).
    const shownAt = span.start + (sourceTime - scene.from) / scene.speed;
```

with:

```ts
    const pastEnd = t >= span.end || !inside(local);
    const sourceLocal = pastEnd ? clamp(lastFrameShown(span, inside) - span.start, 0, length) : local;
    const sourceTime = sourceTimeAt(scene, sourceLocal);
    let cursor = project.look.cursor.enabled && opts.cursor ? cursorAt(opts.cursor, sourceTime, scene.speed, project.look.cursor.smoothing) : undefined;
    if (cursor && project.look.cursor.clickEffect === 'none') cursor = { ...cursor, clicks: [] };
    // The output time this source frame belongs to (a held or frozen frame's, during a crossfade).
    const shownAt = span.start + (sourceTime - scene.from) / scene.speed;
```

In `packages/engine/test/scenarios.ts`, replace:

```ts
  },
  // Crossfade between two clips of one recording, halfway: the outgoing clip holds its last frame
  // with its mask and cursor, the incoming clip starts at a later source time without the mask,
  // its cursor further right and down (900, 600).
  {
    name: 'crossfade-clips',
    project: project(
      { frame: { title: TITLE } },
      {
        scenes: [
          { type: 'clip', from: 0, to: 2 },
```

with:

```ts
  },
  // Crossfade between two clips of one recording, halfway: the outgoing clip holds its last frame
  // with its mask and cursor, the incoming clip starts at a later source time without the mask,
  // its cursor further right and down (900, 600). The cursor as recorded (smoothing would hold it
  // still through the 2 s without a move).
  {
    name: 'crossfade-clips',
    project: project(
      { frame: { title: TITLE }, cursor: { smoothing: 0 } },
      {
        scenes: [
          { type: 'clip', from: 0, to: 2 },
```

In `skill/cuttle/project.md`, replace:

```markdown
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |
```

with:

```markdown
|---|---|
| `background.preset` | `sunset-sky`, `aurora`, `mesh`, `solid` (needs `color`, e.g. `"#0c0c0c"`), `image` (needs `image`: a path) |
| `frame` | `enabled` (`true`), `style` (`mac-dark`, `mac-light`, `browser-light`, `none`), `title` (`""`), `radius` (`14`), `shadow` (`true`) |
| `cursor` | `enabled` (`true`), `style` (`system`, `arrow-white`, `arrow-black`, `dot`, `ring`, `spotlight`), `size` (`1`, up to 4), `color` (`"#D97757"`: tints dot, ring, spotlight and the click ripple), `clickEffect` (`ripple`, `none`), `smoothing` (`0.5`: 0 draws the path as recorded, up to 1 very smooth; clicks stay exact) |
| `webcam` | `enabled` (`false`), `shape` (`circle`, `rounded`), `corner` (`bottom-left`, `bottom-right`, `top-left`, `top-right`), `size` (`0.18` of the output's short side, up to 0.5) |
| `audio` | `enabled` (`true`), `muteSpedUp` (`true`: sped-up clips are silent) |
| `transition` | `enabled` (`true`: a crossfade between scenes), `duration` (`0.3` s, up to 2) |
```

- [ ] **Step 4: Run the tests, the goldens and the typecheck**

Run: `pnpm exec vitest run --project node packages/timeline packages/project`
Expected: PASS, 132 tests.

Run: `pnpm exec vitest run --project browser packages/engine/test/golden.browser.test.ts`
Expected: PASS: every golden matches (the crossfade pins smoothing 0; no other golden's cursor moves).

Run: `pnpm exec tsc -p tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 5: Commit**

```bash
git add packages/project packages/timeline packages/engine/test/scenarios.ts skill/cuttle/project.md
git commit -m "timeline: the smoothed cursor (a centred Gaussian per stretch; clicks exact, rests held, jumps kept); look.cursor.smoothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Zooms on clicks in suggest and the CLI

**Files:**
- Create: `packages/timeline/src/click-zooms.ts`, `packages/timeline/test/click-zooms.test.ts`
- Modify: `packages/timeline/src/index.ts`, `packages/core/src/suggest.ts`, `apps/cli/src/main.ts`, `apps/cli/src/commands/suggest.ts`, `apps/cli/test/cli.test.ts`, `skill/cuttle/SKILL.md`, `README.md`

- [ ] **Step 1: Write the failing tests**

`packages/timeline/test/click-zooms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { InputEvent } from '@cuttle/project';
import { clickZooms, zoomRectFor } from '../src/click-zooms';

const screen = { width: 1920, height: 1080 };
const click = (t: number, x: number, y: number, button: 'left' | 'right' = 'left'): InputEvent => ({ t, type: 'click', x, y, button });
const whole = [{ from: 0, to: 60, speed: 1 }];

describe('zooms on clicks', () => {
  it('zooms in on one click: from just before it, around it, in the screen’s shape', () => {
    const [zoom, ...rest] = clickZooms([click(10, 960, 540)], whole, screen);
    expect(rest).toEqual([]);
    expect(zoom).toMatchObject({ at: 9.3, duration: 1.9, clicks: 1 });
    // at least 45 % of the width, centred on the click, 16:9
    expect(zoom!.rect).toEqual([528, 297, 864, 486]);
  });

  it('follows a burst of clicks in one spot with one zoom that lasts until the last', () => {
    const zooms = clickZooms([click(10, 400, 300), click(11, 450, 320), click(12.5, 520, 360), click(14, 480, 340)], whole, screen);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toMatchObject({ at: 9.3, duration: 5.9, clicks: 4 });
    const [x, y, width, height] = zooms[0]!.rect;
    for (const [cx, cy] of [[400, 300], [520, 360]]) {
      expect(cx! >= x && cx! <= x + width && cy! >= y && cy! <= y + height).toBe(true);
    }
  });

  it('starts another zoom for clicks across the screen, once 5 output seconds have passed', () => {
    const zooms = clickZooms([click(10, 200, 200), click(11, 1700, 900), click(20, 1700, 900)], whole, screen);
    // the click at 11 s is elsewhere but too soon after the first zoom; the one at 20 s gets its own
    expect(zooms.map((zoom) => zoom.at)).toEqual([9.3, 19.3]);
  });

  it('keeps zooms out of waiting that is sped up, away from cuts, and off right clicks', () => {
    const clips = [
      { from: 0, to: 10, speed: 1 },
      { from: 10, to: 40, speed: 8 },
      { from: 40, to: 60, speed: 1 },
    ];
    expect(clickZooms([click(20, 500, 500), click(30, 500, 500, 'right')], clips, screen)).toEqual([]);
    // a click right after a cut: the zoom starts a second into the clip
    expect(clickZooms([click(40.2, 500, 500)], clips, screen)[0]!.at).toBe(41);
    // a clip too short to zoom in and out without touching a cut
    expect(clickZooms([click(5, 500, 500)], [{ from: 4, to: 7, speed: 1 }], screen)).toEqual([]);
  });

  it('makes one zoom of neighbours that show nearly the same spot', () => {
    // 3.2 s apart (not one cluster), the same spot: the second zoom would start 1.3 s after the first ends
    const zooms = clickZooms([click(10, 800, 500), click(13.2, 820, 510)], whole, screen);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toMatchObject({ at: 9.3, clicks: 2 });
    expect(zooms[0]!.duration).toBeCloseTo(5.1, 6);
  });

  it('zooms on one of two clicks far apart at once, and never over another zoom', () => {
    // clicks spread over most of the screen within 3 s: two clusters (too wide for one), the second too soon
    expect(clickZooms([click(10, 100, 100), click(10.5, 1800, 1000)], whole, screen)).toHaveLength(1);
    expect(clickZooms([click(10, 960, 540)], whole, screen, [{ at: 9, duration: 4 }])).toEqual([]);
  });

  it('keeps a zoom on the screen at its edge', () => {
    expect(zoomRectFor({ left: 1900, top: 1070, right: 1910, bottom: 1075 }, screen)).toEqual([1056, 594, 864, 486]);
  });
});
```

In `apps/cli/test/cli.test.ts`, replace:

```ts
    expect(existsSync(join(dir, 'cuttle.json.bak'))).toBe(true);
  }, 30_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

with:

```ts
    expect(existsSync(join(dir, 'cuttle.json.bak'))).toBe(true);
  }, 30_000);

  it('zooms on clicks where the work happens at 1×, and leaves them out with --no-click-zooms', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
    // typing from 3 to 12 s (no waiting to speed up) and two clicks at one spot
    const events = [
      ...Array.from({ length: 31 }, (_, i) => ({ t: 3 + i * 0.3, type: 'keys', count: 1 })),
      { t: 6, type: 'click', x: 400, y: 300, button: 'left' },
      { t: 6.6, type: 'click', x: 430, y: 320, button: 'left' },
    ].sort((a, b) => a.t - b.t);
    writeFileSync(join(dir, 'takes/1/events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    const { code, json } = await cli('--json', '-C', dir, 'suggest', '--dry-run');
    expect(code).toBe(0);
    const zooms = (json as { zooms: { label: string; at: number; duration: number; rect: number[] }[] }).zooms;
    expect(zooms.find((zoom) => zoom.label === 'Clicks')).toMatchObject({ at: 5.3, duration: 2.5, rect: [127, 148, 576, 324] });
    expect((json as { notes: string[] }).notes).toContain('1 zoom(s) on clicks');
    const without = await cli('--json', '-C', dir, 'suggest', '--dry-run', '--no-click-zooms');
    expect((without.json as { zooms: { label: string }[] }).zooms.map((zoom) => zoom.label)).not.toContain('Clicks');
  }, 30_000);

  it('leaves cuttle.json alone with --dry-run', async () => {
    const dir = temp();
    cpSync(fixture, dir, { recursive: true });
```

Run: `pnpm exec vitest run --project node packages/timeline/test/click-zooms.test.ts`
Expected: FAIL: the test cannot load `../src/click-zooms` (the file does not exist yet).

- [ ] **Step 2: The zooms, in suggest and the CLI**

`packages/timeline/src/click-zooms.ts`:

```ts
// Zooms that follow the clicks of a take: clicks close in time and place make one zoom that eases
// in as the first click happens, stays while the work goes on there, and leaves. Fewer, better
// zooms: never in waiting that is sped up, never one that would barely zoom, never two at once, and
// at most one starting in any 5 output seconds. Pure; `suggest` and the editor share it.
import type { InputEvent, Rect } from '@cuttle/project';

/** A click joins the zoom being formed when it comes this soon after its last click (source s)… */
export const CLUSTER_GAP_SECONDS = 3;
/** …and the clicks' box with it stays within this share of the screen's width and height. */
export const CLUSTER_SPAN = 0.4;
/** Room around the clicks, as a share of the screen's width. */
export const PAD = 0.1;
/** A zoom shows at least this share of the screen's width (at most about 2.2× zoom). */
export const MIN_WIDTH = 0.45;
/** A zoom that would show more than this share of the screen's area barely zooms: none. */
export const MAX_AREA = 0.8;
/** The zoom starts this long before the first click (it eases in for 0.6 s)… */
export const LEAD_SECONDS = 0.7;
/** …and lasts until this long after the last one, at least `MIN_SECONDS`. */
export const TAIL_SECONDS = 1.2;
export const MIN_SECONDS = 1.8;
/** Clicks in clips faster than this are not zoomed (waiting sped up). */
export const MAX_SPEED = 2;
/** Two zooms that overlap this much (of the smaller) and are this close in time become one. */
export const MERGE_OVERLAP = 0.6;
export const MERGE_GAP_SECONDS = 1.5;
/** At most one zoom starts in any this many output seconds. */
export const MIN_OUTPUT_GAP = 5;
/** No zoom starts or ends this close to its clip's cut (a cut and a zoom at once is too much). */
export const EDGE_SECONDS = 1;

export interface ClipSpan {
  from: number;
  to: number;
  speed: number;
}

export interface ClickZoom {
  at: number;
  duration: number;
  rect: Rect;
  /** How many clicks it follows. */
  clicks: number;
}

type Box = { left: number; top: number; right: number; bottom: number };

const boxOf = (points: readonly { x: number; y: number }[]): Box => ({
  left: Math.min(...points.map((point) => point.x)),
  top: Math.min(...points.map((point) => point.y)),
  right: Math.max(...points.map((point) => point.x)),
  bottom: Math.max(...points.map((point) => point.y)),
});

/** A box padded, made at least `MIN_WIDTH` wide in the screen's aspect, and kept on the screen. */
export function zoomRectFor(box: Box, screen: { width: number; height: number }): Rect {
  const pad = PAD * screen.width;
  const aspect = screen.width / screen.height;
  let width = Math.max(box.right - box.left + 2 * pad, MIN_WIDTH * screen.width);
  let height = Math.max(box.bottom - box.top + 2 * pad, width / aspect);
  width = Math.max(width, height * aspect);
  height = width / aspect;
  width = Math.min(width, screen.width);
  height = Math.min(height, screen.height);
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), screen.width - width);
  const y = Math.min(Math.max(cy - height / 2, 0), screen.height - height);
  return [Math.round(x), Math.round(y), Math.round(width), Math.round(height)];
}

/** The share of the smaller rect that the two cover together. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a[2] * a[3], b[2] * b[3]);
}

/**
 * The zooms for a take's left clicks inside `clips` (in output order), in source seconds and
 * pixels. `avoid` are spans other zooms already take (the answer zoom): no click zoom overlaps one.
 */
export function clickZooms(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: { width: number; height: number }, avoid: readonly { at: number; duration: number }[] = []): ClickZoom[] {
  // output seconds where each clip starts, to space the zooms out as people see them
  const starts: number[] = [];
  let shown = 0;
  for (const clip of clips) {
    starts.push(shown);
    shown += (clip.to - clip.from) / clip.speed;
  }
  const clipOf = (t: number) => clips.findIndex((clip) => t >= clip.from && t < clip.to);
  const outputAt = (t: number, index: number) => starts[index]! + (t - clips[index]!.from) / clips[index]!.speed;

  const clicks = events
    .filter((event): event is Extract<InputEvent, { type: 'click' }> => event.type === 'click' && event.button === 'left')
    .map((click) => ({ ...click, clip: clipOf(click.t) }))
    .filter((click) => click.clip >= 0 && clips[click.clip]!.speed <= MAX_SPEED)
    .sort((a, b) => a.t - b.t);

  // clusters: close in time, within one clip, and in one part of the screen
  const clusters: (typeof clicks)[] = [];
  for (const click of clicks) {
    const open = clusters.at(-1);
    const last = open?.at(-1);
    if (open && last && last.clip === click.clip && click.t - last.t <= CLUSTER_GAP_SECONDS) {
      const box = boxOf([...open, click]);
      if (box.right - box.left <= CLUSTER_SPAN * screen.width && box.bottom - box.top <= CLUSTER_SPAN * screen.height) {
        open.push(click);
        continue;
      }
    }
    clusters.push([click]);
  }

  let zooms = clusters.flatMap((cluster) => {
    const clip = clips[cluster[0]!.clip]!;
    const at = Math.max(cluster[0]!.t - LEAD_SECONDS, clip.from + EDGE_SECONDS);
    const end = Math.min(Math.max(cluster.at(-1)!.t + TAIL_SECONDS, at + MIN_SECONDS), clip.to - EDGE_SECONDS);
    if (end - at < MIN_SECONDS - 1e-9) return [];
    return [{ at, end, clip: cluster[0]!.clip, points: cluster.map(({ x, y }) => ({ x, y })), clicks: cluster.length }];
  });

  // neighbours that show nearly the same spot become one
  const merged: typeof zooms = [];
  for (const zoom of zooms) {
    const previous = merged.at(-1);
    if (previous && previous.clip === zoom.clip && zoom.at - previous.end <= MERGE_GAP_SECONDS && overlap(zoomRectFor(boxOf(previous.points), screen), zoomRectFor(boxOf(zoom.points), screen)) >= MERGE_OVERLAP) {
      previous.end = Math.max(previous.end, zoom.end);
      previous.points.push(...zoom.points);
      previous.clicks += zoom.clicks;
      continue;
    }
    merged.push({ ...zoom, points: [...zoom.points] });
  }
  zooms = merged;

  const result: ClickZoom[] = [];
  let lastStart = -Infinity;
  let lastEnd = -Infinity;
  for (const zoom of zooms) {
    const rect = zoomRectFor(boxOf(zoom.points), screen);
    if ((rect[2] * rect[3]) / (screen.width * screen.height) > MAX_AREA) continue;
    if (avoid.some((other) => zoom.at < other.at + other.duration && other.at < zoom.end)) continue;
    // one at a time, and not too often
    const start = outputAt(zoom.at, zoom.clip);
    if (zoom.at < lastEnd || start - lastStart < MIN_OUTPUT_GAP) continue;
    result.push({ at: round(zoom.at), duration: round(zoom.end - zoom.at), rect, clicks: zoom.clicks });
    lastStart = start;
    lastEnd = zoom.end;
  }
  return result;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
```

In `packages/timeline/src/index.ts`, replace:

```ts
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
```

with:

```ts
export { occurrences, rampAmount, type Occurrence } from './occurrences';
export { ZOOM_RAMP_SECONDS, fitZoomRect, zoomRectAt } from './zoom';
export { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, type ActiveText } from './overlays';
export { CLICK_EFFECT_SECONDS, createCursorTrack, cursorAt, smoothedPath, type CursorFrame, type CursorTrack } from './cursor';
export { createTimeline, type RenderState, type SceneFrame, type Timeline, type TimelineOptions } from './frame';
export { clickZooms, zoomRectFor, type ClickZoom, type ClipSpan } from './click-zooms';
```

In `packages/core/src/suggest.ts`, replace:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseMarkersJson, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { analyseScreen, grabGray } from './suggest/media';
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseMarkersJson, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { clickZooms } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { analyseScreen, grabGray } from './suggest/media';
```

In the same file, replace:

```ts
  claude?: string | true;
  /** Print the suggestion without writing cuttle.json. */
  dryRun?: boolean;
  /** Zoom on Claude's final answer (default true). */
  zoom?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
}
```

with:

```ts
  claude?: string | true;
  /** Print the suggestion without writing cuttle.json. */
  dryRun?: boolean;
  /** Zooms at all: on Claude's final answer and on the clicks (default true). */
  zoom?: boolean;
  /** Zooms that follow the clicks (default true; `zoom: false` turns them off too). */
  clickZooms?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
}
```

In the same file, replace:

```ts
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }

  let backup: string | undefined;
  if (!args.dryRun) {
```

with:

```ts
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }
  if (args.zoom !== false && args.clickZooms !== false && events.length > 0) {
    const followed = clickZooms(
      events,
      clips.map((clip) => ({ from: clip.from, to: clip.to, speed: clip.speed ?? 1 })),
      screenInfo,
      zooms,
    );
    for (const zoom of followed) {
      zooms.push({ id: newId('zooms', taken), label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect });
    }
    zooms.sort((a, b) => a.at - b.at);
    if (followed.length > 0) notes.push(`${followed.length} zoom(s) on clicks`);
  }

  let backup: string | undefined;
  if (!args.dryRun) {
```

In `apps/cli/src/main.ts`, replace:

```ts

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up) and a zoom on the answer')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zoom on the answer')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(action((output, project, options: { claude?: string | true; zoom: boolean; dryRun?: boolean }) => suggestCommand(project, options, output)));

  program
    .command('preview')
```

with:

```ts

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up), a zoom on the answer and zooms on clicks')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms at all')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(action((output, project, options: { claude?: string | true; zoom: boolean; clickZooms: boolean; dryRun?: boolean }) => suggestCommand(project, options, output)));

  program
    .command('preview')
```

In `apps/cli/src/commands/suggest.ts`, replace:

```ts
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...result.notes.map((note) => `- ${note}`),
      `${clips.length} clip(s), about ${seconds.toFixed(1)} s${result.zooms.length > 0 ? `, ${result.zooms.length} zoom` : ''}`,
      result.written ? `written to ${result.project} (previous version: ${result.backup})` : '(dry run: cuttle.json unchanged)',
      'next: cuttle preview',
    ].join('\n');
```

with:

```ts
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...result.notes.map((note) => `- ${note}`),
      `${clips.length} clip(s), about ${seconds.toFixed(1)} s${result.zooms.length > 0 ? `, ${result.zooms.length} zoom${result.zooms.length === 1 ? '' : 's'}` : ''}`,
      result.written ? `written to ${result.project} (previous version: ${result.backup})` : '(dry run: cuttle.json unchanged)',
      'next: cuttle preview',
    ].join('\n');
```

In `skill/cuttle/SKILL.md`, replace:

````markdown
cuttle -C "<project>" --json preview
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work)
and zooms on Claude's answer. Its `notes` say what it did, in source seconds. It replaces every clip
and zoom (masks, texts, stills and cards stay), so run it once, before your hand edits. Its clips
and zoom have ids, and labels where Claude's markers say what they show ("Claude at work",
"Answer"): keep them when you edit, and give items you add an unused id and a label (project.md).
For a take recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers
from Claude Code's transcript.
````

with:

````markdown
cuttle -C "<project>" --json preview
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
zooms on Claude's answer, and zooms where clicks happen at normal speed ("Click", "Clicks";
`--no-click-zooms` leaves those out, `--no-zoom` every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and zoom (masks, texts, stills and cards stay), so run it
once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
unused id and a label (project.md).
For a take recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers
from Claude Code's transcript.
````

In `README.md`, replace:

```markdown
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder ends its turn (or Ctrl+C)
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, a zoom on the answer
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
cuttle capture-page https://example.com --scroll --add
```

with:

```markdown
cuttle init demo && cd demo
cuttle devices                       # monitors, windows, cameras, microphones
cuttle record --mic --until-claude   # stops when Claude Code in this folder ends its turn (or Ctrl+C)
cuttle suggest                       # scenes: quiet start and end trimmed, idle cut, waiting sped up, zooms on the answer and on clicks
cuttle preview                       # 12 stills and a contact sheet in preview/
cuttle frame 42.5 --grid             # a source frame with a numbered pixel grid, for masks and zooms
cuttle capture-page https://example.com --scroll --add
```

- [ ] **Step 3: Run the tests and the typecheck**

Run: `pnpm exec vitest run --project node packages/timeline/test/click-zooms.test.ts skill`
Expected: PASS, 17 tests.

Run: `pnpm exec vitest run --project node apps/cli/test/cli.test.ts -t suggest`
Expected: PASS: suggest on a take with clicks at 1× adds a "Clicks" zoom, and none with `--no-click-zooms`.

Run: `pnpm exec tsc -p packages/core/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm exec tsc -p apps/cli/tsconfig.json`
Expected: exits with code 0, no output.

- [ ] **Step 4: Commit**

```bash
git add packages/timeline packages/core apps/cli skill/cuttle/SKILL.md README.md
git commit -m "suggest: zooms on clicks (grouped in time and place, fewer and better); --no-click-zooms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The editor: movement, swatches, the ghost, Auto-zoom

**Files:**
- Create: `apps/desktop/src/renderer/editor/swatches.ts`
- Modify: `apps/desktop/src/shared/names.ts`, `apps/desktop/src/renderer/editor/{Inspector.tsx,session.ts,actions.ts,commands.ts,Timeline.tsx,editor.css}`

- [ ] **Step 1: The swatches**

`apps/desktop/src/renderer/editor/swatches.ts`:

```ts
// The Look tab's cursor and frame styles as small pictures the engine draws itself, so a swatch
// shows what the export shows. Drawn once per editor, when the Look tab first asks, one after the
// other on one offscreen canvas.
import { createRenderer, type EngineAssets, type FrameSources } from '@cuttle/engine';
import { CURSOR_STYLES, FRAME_STYLES, parseProject, type CursorStyle, type FrameStyle } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '@cuttle/timeline';

const SCREEN = { width: 1280, height: 800 };
const SWATCH = { width: 320, height: 180 };
/** The cursor rests here, on a calm part of the screen; its swatches zoom in on it so its art can be judged. */
const POINTER = { x: 1110, y: 300 };

/** A screen like an editor's, made of rects, for the swatches to frame and point at. */
function fakeScreen(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(SCREEN.width, SCREEN.height);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1E1E1E';
  g.fillRect(0, 0, 1280, 800);
  g.fillStyle = '#252526';
  g.fillRect(0, 0, 240, 800);
  const colors = ['#569CD6', '#CE9178', '#6A9955', '#DCDCAA', '#C586C0', '#9CDCFE'];
  for (let line = 0; line < 30; line++) {
    let x = 280 + (line % 4) * 32;
    for (let word = 0; word < 4; word++) {
      const width = 30 + ((line * 7 + word * 13) % 9) * 18;
      g.fillStyle = colors[(line + word) % colors.length]!;
      g.fillRect(x, 60 + line * 23, width, 12);
      x += width + 12;
    }
  }
  return canvas;
}

export type SwatchKey = `cursor:${CursorStyle}` | `frame:${FrameStyle}`;

/** One swatch: a one-clip project with the look to show, drawn at its first frame. */
function draw(canvas: OffscreenCanvas, assets: EngineAssets, screen: OffscreenCanvas, look: Record<string, unknown>, zoom?: number[]): Promise<Blob> {
  const parsed = parseProject({
    version: 1,
    output: { ...SWATCH, fps: 30 },
    sources: { screen: 'screen.mp4' },
    scenes: [{ type: 'clip', from: 0, to: 2 }],
    look: { background: { preset: 'solid', color: '#2B2B33' }, ...look },
    ...(zoom && { zooms: [{ at: 0, duration: 2, rect: zoom }] }),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const cursor = createCursorTrack([{ t: 0, type: 'move', ...POINTER }]);
  const state = createTimeline(parsed.project, { screenSize: SCREEN, cursor }).frameAt(1);
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
  for (const layer of state.layers) if (layer.kind === 'clip') sources.screens.set(layer.index, screen);
  const renderer = createRenderer(canvas, parsed.project, { assets, screenSize: SCREEN });
  try {
    renderer.render(state, sources);
  } finally {
    renderer.dispose();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

let drawn: Promise<Map<SwatchKey, string>> | undefined;

/** The swatches as object URLs, drawn on the first call (later calls share them). */
export function swatches(assets: EngineAssets): Promise<Map<SwatchKey, string>> {
  drawn ??= (async () => {
    const canvas = new OffscreenCanvas(SWATCH.width, SWATCH.height);
    const screen = fakeScreen();
    const urls = new Map<SwatchKey, string>();
    // frames: the whole window (the Look tab shows its top-left corner); cursors: close up, upper right
    for (const style of FRAME_STYLES) {
      const blob = await draw(canvas, assets, screen, { frame: { style, title: 'claude · ~/demo' }, cursor: { enabled: false } });
      urls.set(`frame:${style}`, URL.createObjectURL(blob));
    }
    for (const style of CURSOR_STYLES) {
      const blob = await draw(canvas, assets, screen, { frame: { enabled: false }, cursor: { style, clickEffect: 'none' } }, [POINTER.x - 56, POINTER.y - 16, 96, 60]);
      urls.set(`cursor:${style}`, URL.createObjectURL(blob));
    }
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    return urls;
  })().catch((error: unknown) => {
    drawn = undefined;
    throw error;
  });
  return drawn;
}
```

In `apps/desktop/src/renderer/editor/session.ts`, replace:

```ts
// The open project in an editor window: the document, its media, the player, the tool and the
// selection, and the export.
import { loadEngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
```

with:

```ts
// The open project in an editor window: the document, its media, the player, the tool and the
// selection, and the export.
import { loadEngineAssets, type EngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
```

In the same file, replace:

```ts
    const doc = openDocument(info.raw, info.hash, editLimits);
    store.set({ info, doc });
    const [media, assets] = await Promise.all([openProjectMedia(info, doc.project), loadEngineAssets()]);
    player = new Player({
      canvas,
      media,
```

with:

```ts
    const doc = openDocument(info.raw, info.hash, editLimits);
    store.set({ info, doc });
    const [media, assets] = await Promise.all([openProjectMedia(info, doc.project), loadEngineAssets()]);
    engineAssets = assets;
    player = new Player({
      canvas,
      media,
```

In the same file, replace:

```ts
  });
}

let proxyInUse = false;

async function switchToProxy(path: string): Promise<void> {
```

with:

```ts
  });
}

/** The engine's fonts and images, once the project opened (the Look tab's swatches draw with them). */
export let engineAssets: EngineAssets | undefined;

let proxyInUse = false;

async function switchToProxy(path: string): Promise<void> {
```

In `apps/desktop/src/shared/names.ts`, replace:

```ts
export const BACKGROUND_NAMES: Names<typeof BACKGROUND_PRESETS> = { 'sunset-sky': 'Sunset sky', aurora: 'Aurora', mesh: 'Mesh', solid: 'Solid colour', image: 'Image' };
export const FRAME_NAMES: Names<typeof FRAME_STYLES> = { 'mac-dark': 'Mac, dark', 'mac-light': 'Mac, light', 'browser-light': 'Browser, light', none: 'None' };
export const CURSOR_NAMES: Names<typeof CURSOR_STYLES> = {
  system: 'System pointer',
  'arrow-white': 'White arrow',
  'arrow-black': 'Black arrow',
  dot: 'Dot',
```

with:

```ts
export const BACKGROUND_NAMES: Names<typeof BACKGROUND_PRESETS> = { 'sunset-sky': 'Sunset sky', aurora: 'Aurora', mesh: 'Mesh', solid: 'Solid colour', image: 'Image' };
export const FRAME_NAMES: Names<typeof FRAME_STYLES> = { 'mac-dark': 'Mac, dark', 'mac-light': 'Mac, light', 'browser-light': 'Browser, light', none: 'None' };
export const CURSOR_NAMES: Names<typeof CURSOR_STYLES> = {
  system: 'System',
  'arrow-white': 'White arrow',
  'arrow-black': 'Black arrow',
  dot: 'Dot',
```

- [ ] **Step 2: The Look tab: movement and the swatches**

In `apps/desktop/src/renderer/editor/Inspector.tsx`, replace:

```
import { CardIcon, CopyIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { chooseImage, deleteSelection, duplicateSelection, LIST_OF, SPEEDS } from './actions';
import { edit, preview } from './doc';
import { setTool, store, type Selection, type Tool } from './session';
import { useStore } from './store';

const TABS = [
```

with:

```
import { CardIcon, CopyIcon, FilmIcon, MaskIcon, PageIcon, TextIcon, TrashIcon, ZoomIcon } from '../icons';
import { chooseImage, deleteSelection, duplicateSelection, LIST_OF, SPEEDS } from './actions';
import { edit, preview } from './doc';
import { engineAssets, setTool, store, type Selection, type Tool } from './session';
import { swatches, type SwatchKey } from './swatches';
import { useStore } from './store';

const TABS = [
```

In the same file, replace:

```
  );
}

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
```

with:

```
  );
}

/** How smooth the cursor's path is: the steps the menu offers, and a value set in cuttle.json kept as it is. */
const SMOOTHING: { value: number; name: string }[] = [
  { value: 0, name: 'As recorded' },
  { value: 0.3, name: 'Light smoothing' },
  { value: 0.5, name: 'Smooth' },
  { value: 0.8, name: 'Very smooth' },
];

function SmoothingSelect({ value }: { value: number }) {
  const known = SMOOTHING.some((step) => step.value === value);
  return (
    <select
      value={String(value)}
      onChange={(event) => look(['cursor', 'smoothing'], Number(event.target.value), 'Cursor movement')}
      onKeyDown={(event) => event.stopPropagation()}
      title="The cursor glides instead of jittering; clicks stay exactly where they were"
      data-testid="cursor-smoothing"
    >
      {!known && <option value={String(value)}>{value} (from cuttle.json)</option>}
      {SMOOTHING.map((step) => (
        <option key={step.value} value={String(step.value)}>
          {step.name}
        </option>
      ))}
    </select>
  );
}

/** The engine's own pictures of the cursor or frame styles (drawn once), to pick one by sight. */
function PictureSwatches<T extends string>({ label, kind, options, names, value, onPick }: { label: string; kind: 'cursor' | 'frame'; options: readonly T[]; names: Record<T, string>; value: T; onPick: (value: T) => void }) {
  const [urls, setUrls] = useState<Map<SwatchKey, string>>();
  useEffect(() => {
    if (!engineAssets) return;
    let live = true;
    swatches(engineAssets).then(
      (drawn) => live && setUrls(drawn),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="swatches picture-swatches" role="group" aria-label={label}>
      {options.map((option) => {
        const url = urls?.get(`${kind}:${option}` as SwatchKey);
        return (
          <button key={option} type="button" className="swatch-button picture" aria-pressed={value === option} title={names[option]} onClick={() => onPick(option)} data-testid={`${kind}-${option}`}>
            {url ? <img src={url} alt="" draggable={false} /> : <i className="swatch-wait" aria-hidden />}
            <span>{names[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} aria-label={label} data-testid={testId} disabled={disabled}>
```

In the same file, replace:

```
      </Row>
      {current.frame.enabled && (
        <>
          <Row label="Style">
            <Select value={current.frame.style} options={FRAME_STYLES} names={FRAME_NAMES} onChange={(style) => look(['frame', 'style'], style, 'Frame style')} testId="frame-style" />
          </Row>
          <Row label="Title">
            <TextInput value={current.frame.title} placeholder="none" onCommit={(title) => look(['frame', 'title'], title, 'Frame title')} />
          </Row>
```

with:

```
      </Row>
      {current.frame.enabled && (
        <>
          <PictureSwatches
            label="Frame style"
            kind="frame"
            options={FRAME_STYLES}
            names={FRAME_NAMES}
            value={current.frame.style}
            onPick={(style) => look(['frame', 'style'], style, `Frame: ${FRAME_NAMES[style]}`)}
          />
          <Row label="Title">
            <TextInput value={current.frame.title} placeholder="none" onCommit={(title) => look(['frame', 'title'], title, 'Frame title')} />
          </Row>
```

In the same file, replace:

```
      </Row>
      {current.cursor.enabled && (
        <>
          <Row label="Style">
            <Select value={current.cursor.style} options={CURSOR_STYLES} names={CURSOR_NAMES} onChange={(style) => look(['cursor', 'style'], style, 'Cursor style')} />
          </Row>
          <div className="grid2">
            <Row label="Size">
              <NumberInput value={current.cursor.size} min={0.5} max={4} step={0.25} onCommit={(value) => look(['cursor', 'size'], value, 'Cursor size')} />
```

with:

```
      </Row>
      {current.cursor.enabled && (
        <>
          <PictureSwatches
            label="Cursor style"
            kind="cursor"
            options={CURSOR_STYLES}
            names={CURSOR_NAMES}
            value={current.cursor.style}
            onPick={(style) => look(['cursor', 'style'], style, `Cursor: ${CURSOR_NAMES[style]}`)}
          />
          <div className="grid2">
            <Row label="Size">
              <NumberInput value={current.cursor.size} min={0.5} max={4} step={0.25} onCommit={(value) => look(['cursor', 'size'], value, 'Cursor size')} />
```

In the same file, replace:

```
          <Row label="Clicks">
            <Select value={current.cursor.clickEffect} options={CLICK_EFFECTS} names={CLICK_NAMES} onChange={(effect) => look(['cursor', 'clickEffect'], effect, 'Click effect')} />
          </Row>
        </>
      )}
```

with:

```
          <Row label="Clicks">
            <Select value={current.cursor.clickEffect} options={CLICK_EFFECTS} names={CLICK_NAMES} onChange={(effect) => look(['cursor', 'clickEffect'], effect, 'Click effect')} />
          </Row>
          <Row label="Movement">
            <SmoothingSelect value={current.cursor.smoothing} />
          </Row>
        </>
      )}
```

- [ ] **Step 3: Auto-zoom on clicks, and the ghost of a moved scene**

In `apps/desktop/src/renderer/editor/actions.ts`, replace:

```ts
// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { sceneSpans, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
```

with:

```ts
// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { clickZooms, sceneSpans, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
```

In the same file, replace:

```ts
  setTool('zoom');
}

/** A mask from the playhead to the clip's end; then the source view to place it. */
export function addMask(rect?: number[]): void {
  const blocked = overlayBlocked();
```

with:

```ts
  setTool('zoom');
}

/** The labels of zooms made from the clicks: Auto-zoom replaces these, and only these. */
export const CLICK_ZOOM_LABELS = ['Click', 'Clicks'];

/**
 * Zooms that follow the take's clicks (as `suggest` makes them), in place of the click zooms there
 * are: one step to undo. Zooms made or changed by hand stay, and the new ones keep clear of them.
 */
export function autoZoomClicks(): void {
  const { doc, media } = store.get();
  const project = documentProject();
  if (!doc || doc.issues || !media || !project) return;
  if (media.events.length === 0) return toast('This take has no input recorded: there are no clicks to zoom on.', { tone: 'warning' });
  const isClickZoom = (zoom: { label?: string }) => zoom.label !== undefined && CLICK_ZOOM_LABELS.includes(zoom.label);
  const kept = project.zooms.filter((zoom) => !isClickZoom(zoom));
  const clips = project.scenes.filter((scene): scene is ClipScene => scene.type === 'clip').map((clip) => ({ from: clip.from, to: clip.to, speed: clip.speed }));
  const zooms = clickZooms(media.events, clips, screenSize(), kept);
  const old = (doc.raw.zooms as { id: string; label?: string }[] | undefined) ?? [];
  const commands: Command[] = [
    ...old.filter(isClickZoom).map((zoom) => ({ type: 'delete', list: 'zooms', id: zoom.id }) as Command),
    ...zooms.map((zoom) => ({ type: 'add', list: 'zooms', item: { label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect } }) as Command),
  ];
  if (commands.length === 0) return toast('No clicks to zoom on: none at normal speed, away from cuts and other zooms.');
  if (edit(commands, 'Auto-zoom on clicks')) toast(zooms.length === 0 ? 'No clicks to zoom on any more: the click zooms are gone.' : `${zooms.length} zoom${zooms.length === 1 ? '' : 's'} on clicks.`, { undo: true });
}

/** A mask from the playhead to the clip's end; then the source view to place it. */
export function addMask(rect?: number[]): void {
  const blocked = overlayBlocked();
```

In `apps/desktop/src/renderer/editor/commands.ts`, replace:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { bridge } from '../bridge';
import { addCard, addMask, addPage, addZoom, cycleSpeed, deleteSelection, duplicateSelection, overlayBlocked, selectedOrCurrentClip, setSpeed, showRawTake, split } from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setTool, store } from './session';
```

with:

```ts
// Everything the editor can do by name, with its keys: the command menu (Ctrl+K) lists these, and
// the keyboard runs them. Keys are written as the menu shows them.
import { bridge } from '../bridge';
import { addCard, addMask, addPage, addZoom, autoZoomClicks, cycleSpeed, deleteSelection, duplicateSelection, overlayBlocked, selectedOrCurrentClip, setSpeed, showRawTake, split } from './actions';
import { redo, undo } from './doc';
import { currentPlayer, openExport, select, setTool, store } from './session';
```

In the same file, replace:

```ts
    { id: 'speed-1', name: 'Normal speed (1×)', keywords: 'speed', group: 'Edit', run: () => setSpeed(1), blocked: needsClip },
    { id: 'raw', name: 'Show the raw take (one clip over all of it)', group: 'Edit', run: showRawTake },
    { id: 'add-zoom', name: 'Add a zoom at the playhead', group: 'Add', run: () => addZoom(), blocked: () => overlayBlocked() },
    { id: 'add-mask', name: 'Add a mask at the playhead', group: 'Add', run: () => addMask(), blocked: () => overlayBlocked() },
    { id: 'add-caption', name: 'Add a caption at the playhead (type it on the video)', group: 'Add', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'add-card', name: 'Add a title card', group: 'Add', run: addCard },
```

with:

```ts
    { id: 'speed-1', name: 'Normal speed (1×)', keywords: 'speed', group: 'Edit', run: () => setSpeed(1), blocked: needsClip },
    { id: 'raw', name: 'Show the raw take (one clip over all of it)', group: 'Edit', run: showRawTake },
    { id: 'add-zoom', name: 'Add a zoom at the playhead', group: 'Add', run: () => addZoom(), blocked: () => overlayBlocked() },
    { id: 'auto-zoom', name: 'Auto-zoom on clicks', keywords: 'zoom clicks automatic follow', group: 'Add', run: autoZoomClicks },
    { id: 'add-mask', name: 'Add a mask at the playhead', group: 'Add', run: () => addMask(), blocked: () => overlayBlocked() },
    { id: 'add-caption', name: 'Add a caption at the playhead (type it on the video)', group: 'Add', run: () => setTool('caption'), blocked: () => overlayBlocked() },
    { id: 'add-card', name: 'Add a title card', group: 'Add', run: addCard },
```

In `apps/desktop/src/renderer/editor/Timeline.tsx`, replace:

```
interface DragView {
  guide?: number;
  insertAt?: number;
}

export function Timeline() {
```

with:

```
interface DragView {
  guide?: number;
  insertAt?: number;
  /** A scene being moved: its block follows the pointer, translucent (left and width in output seconds). */
  ghost?: { left: number; width: number; label: string };
}

export function Timeline() {
```

In the same file, replace:

```
          preview(commands);
          return;
        }
        // moving: the scene goes where the pointer is among the others' middles
        const t = timeAt(moved.clientX);
        const rest = model.scenes.filter((other) => other.id !== block.id);
        insertAt = rest.filter((other) => (other.start + other.end) / 2 < t).length;
        setDrag({ insertAt: insertAt === 0 ? (rest[0]?.start ?? 0) : rest[insertAt - 1]!.end });
      },
      (moved) => {
        setDrag({});
```

with:

```
          preview(commands);
          return;
        }
        // moving: the scene goes where the pointer is among the others' middles; a ghost of it follows the pointer
        const t = timeAt(moved.clientX);
        const rest = model.scenes.filter((other) => other.id !== block.id);
        insertAt = rest.filter((other) => (other.start + other.end) / 2 < t).length;
        setDrag({
          insertAt: insertAt === 0 ? (rest[0]?.start ?? 0) : rest[insertAt - 1]!.end,
          ghost: { left: block.start + deltaOut, width: block.end - block.start, label: block.title },
        });
      },
      (moved) => {
        setDrag({});
```

In the same file, replace:

```
                  deps={[media, spans]}
                />
                {drag.guide !== undefined && <div className="snap-guide" style={{ left: drag.guide * pps }} />}
                {drag.insertAt !== undefined && <div className="insert-mark" style={{ left: drag.insertAt * pps, top: tops.video, height: heights.video }} />}
                <Playhead pps={pps} top={heights.markers - 8} scroller={scroller} />
              </>
```

with:

```
                  deps={[media, spans]}
                />
                {drag.guide !== undefined && <div className="snap-guide" style={{ left: drag.guide * pps }} />}
                {drag.ghost && (
                  <div className="scene-ghost" style={{ left: drag.ghost.left * pps, width: drag.ghost.width * pps, top: tops.video + 4, height: heights.video - 8 }}>
                    <span>{drag.ghost.label}</span>
                  </div>
                )}
                {drag.insertAt !== undefined && <div className="insert-mark" style={{ left: drag.insertAt * pps, top: tops.video, height: heights.video }} />}
                <Playhead pps={pps} top={heights.markers - 8} scroller={scroller} />
              </>
```

In `apps/desktop/src/renderer/editor/editor.css`, replace:

```
}

/* a version a conflict set aside: offered back until answered */
/* an empty lane says how to fill it; a missing track says so (never in the way of a click) */
.lane-hint {
  position: absolute;
```

with:

```
}

/* a version a conflict set aside: offered back until answered */
/* a scene being moved: a translucent copy follows the pointer, the insert mark says where it lands */
.scene-ghost {
  position: absolute;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 0 0 1.5px var(--accent),
    var(--shadow-float);
  pointer-events: none;
  z-index: 3;
  display: flex;
  align-items: flex-end;
  padding: 0 0 6px 8px;
  overflow: hidden;
}
.scene-ghost span {
  font-size: var(--size-xs);
  font-weight: 600;
  white-space: nowrap;
}

/* an empty lane says how to fill it; a missing track says so (never in the way of a click) */
.lane-hint {
  position: absolute;
```

In the same file, replace:

```
    0 0 0 2px var(--accent),
    inset 0 0 0 1px rgba(0, 0, 0, 0.3);
}
/* the swatches look like the engine's presets (packages/engine/src/presets/backgrounds.ts) */
.bg-sunset-sky {
  background: linear-gradient(180deg, #1b1c4a, #b85679 62%, #f9a866);
```

with:

```
    0 0 0 2px var(--accent),
    inset 0 0 0 1px rgba(0, 0, 0, 0.3);
}
/* the cursor and frame styles: the engine's own pictures, the name under them */
.picture-swatches {
  margin: 2px 0 10px;
}
.swatch-button.picture {
  position: relative;
  height: auto;
  aspect-ratio: 16 / 9;
  padding: 0;
  background: var(--stage);
}
.swatch-button.picture img,
.swatch-button.picture .swatch-wait {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* a frame shows by its window's top-left corner (the controls and the title), enlarged */
.picture-swatches[aria-label='Frame style'] img {
  transform: scale(3);
  transform-origin: 6% 7%;
}
.swatch-button.picture span {
  position: relative;
  white-space: nowrap;
  margin: auto 0 0;
  padding: 3px 6px;
  width: 100%;
  text-align: left;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
}
/* the swatches look like the engine's presets (packages/engine/src/presets/backgrounds.ts) */
.bg-sunset-sky {
  background: linear-gradient(180deg, #1b1c4a, #b85679 62%, #f9a866);
```

- [ ] **Step 4: Typecheck and build**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json`
Expected: exits with code 0, no output.

Run: `pnpm app:build:js`
Expected: exits with code 0 and ends with `built apps/desktop/dist`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "desktop: the Look tab's cursor movement and its styles drawn by the engine; Auto-zoom on clicks; a ghost under a moved scene

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The end-to-end check

**Files:**
- Modify: `apps/desktop/test/app.check.test.ts`

- [ ] **Step 1: Swatches, movement, the ghost and Auto-zoom in the check**

In `apps/desktop/test/app.check.test.ts`, replace:

```ts
    await undoAll();
  }, 30_000);

  it('keeps a drag going over a version written outside the app meanwhile: both are in the file, each undone on its own', async () => {
    await press('.item.zoom');
    await drag('.item.zoom', [40, 0], { hold: true });
```

with:

```ts
    await undoAll();
  }, 30_000);

  it('draws the cursor and frame styles with the engine, and sets them and the cursor’s movement in the Look tab', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await click(editor, '#tab-look');
    // the swatches are the engine's own pictures
    await editor.waitForSelector('[data-testid=frame-mac-light] img', { timeout: 20_000 });
    await editor.waitForSelector('[data-testid=cursor-ring] img', { timeout: 20_000 });
    await shot('14-look-swatches');
    await click(editor, '[data-testid=frame-mac-light]');
    await savedWhen((file) => (file as unknown as { look: { frame: { style?: string } } }).look.frame.style === 'mac-light');
    await editor.selectOption('[data-testid=cursor-smoothing]', '0.8');
    await savedWhen((file) => (file as unknown as { look: { cursor?: { smoothing?: number } } }).look.cursor?.smoothing === 0.8);
    await click(editor, '#tab-selection');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('shows a ghost of a scene being moved, and zooms on clicks from the menu when there are any', async () => {
    await drag('.scene[data-id="s3"]', [-600, 0], { hold: true });
    expect(await editor.locator('.scene-ghost').count()).toBe(1);
    await shot('15-scene-ghost');
    await release([0, 0]);
    expect(await editor.locator('.scene-ghost').count()).toBe(0);
    await savedWhen((file) => file.scenes[0]?.id === 's3');
    await undoAll();
    // the fixture's clicks are too close to cuts or to the answer zoom for a zoom of their own
    await editor.keyboard.press('Control+K');
    await editor.keyboard.type('zoom on clicks');
    await editor.waitForFunction(() => document.querySelector('.command-menu [aria-selected=true]')?.textContent?.includes('Auto-zoom on clicks'));
    await editor.keyboard.press('Enter');
    await expect.poll(() => doc().then((state) => state.toast?.text ?? ''), { timeout: 5000 }).toContain('No clicks to zoom on');
    expect((await editor.evaluate(() => document.querySelector('.app')?.getAttribute('data-tool'))) ?? 'select').toBe('select');
  }, 30_000);

  it('keeps a drag going over a version written outside the app meanwhile: both are in the file, each undone on its own', async () => {
    await press('.item.zoom');
    await drag('.item.zoom', [40, 0], { hold: true });
```

- [ ] **Step 2: Run it**

Run: `pnpm app:check`
Expected: PASS, 35 tests (about two minutes). No window shows on the screen.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test
git commit -m "desktop: app:check draws the swatches, sets the cursor's movement, moves a scene with its ghost, and runs Auto-zoom

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

**Files:**
- Modify: `packages/recorder/test/record.test.ts`

- [ ] **Step 1: The paused-take check allows a few frames at the end**

On a loaded machine (the full suite runs files side by side) a piece's webcam can end a frame or two late. The check measured the joined webcam's length to 0.05 s and failed at 1.6 frames; sync is about where each piece starts, which the check keeps exact.

In `packages/recorder/test/record.test.ts`, replace:

```ts
    expect(events.filter((type) => type === 'resumed')).toHaveLength(2);
    expect(events.at(-1)).toBe('stopping');

    // the joined tracks are as long as the take (each segment lined up with its screen segment)
    const screen = probe(join(projectDir, take.screen));
    expect(screen).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 });
    expect(screen.duration).toBeCloseTo(take.seconds, 1);
    expect(probe(join(projectDir, take.webcam!)).duration).toBeCloseTo(take.seconds, 1);
    expect(probe(join(projectDir, take.mic!)).duration).toBeCloseTo(take.seconds, 1);
    // take.json: the joined webcam and mic start with the screen
    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
```

with:

```ts
    expect(events.filter((type) => type === 'resumed')).toHaveLength(2);
    expect(events.at(-1)).toBe('stopping');

    // the joined tracks are as long as the take (each segment lined up with its screen segment), to a
    // few frames at the end: a loaded machine ends a piece's webcam a frame or two late
    const screen = probe(join(projectDir, take.screen));
    expect(screen).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 });
    expect(screen.duration).toBeCloseTo(take.seconds, 1);
    expect(Math.abs(probe(join(projectDir, take.webcam!)).duration - take.seconds)).toBeLessThan(0.1);
    expect(Math.abs(probe(join(projectDir, take.mic!)).duration - take.seconds)).toBeLessThan(0.1);
    // take.json: the joined webcam and mic start with the screen
    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
```

- [ ] **Step 2: All tests, the typecheck and the unpacked build**

Run: `pnpm test`
Expected: PASS, 506 tests in 62 files, 44 skipped (the real-capture test and the Electron checks: cli, app, build).

Run: `pnpm typecheck`
Expected: exits with code 0.

Run: `pnpm app:build`
Expected: `packaged Cuttle-win32-x64: …`, then PASS, 4 tests.

```bash
git add packages/recorder/test/record.test.ts
git commit -m "recorder: the paused-take check allows a few frames at the end of a joined track

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run: `git status --short`
Expected: no output.

- [ ] **Step 3: By hand (the user)**

These need a person and a real screen.

1. Record a browser while you click through a page and type. `cuttle suggest`, or let the app cut it: the zooms land where you clicked, at normal speed, and none in the sped-up waiting.
2. Play it: the cursor glides, and every click's ripple is exactly at the cursor's tip. In the Look tab, set Movement to "As recorded" and back: the editor follows at once.
3. In the Look tab, pick frame and cursor styles from their pictures; the video shows what the picture showed.
4. Drag a scene along the timeline: a ghost follows the pointer, and the scene lands at the insert mark.
