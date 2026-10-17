# Cuttle Phase 1 Roadmap

> **For agentic workers:** This roadmap splits phase 1 into six milestones. Each milestone gets its
> own detailed plan (superpowers:writing-plans) right before it starts; M1 is already written:
> `2026-10-16-cuttle-m1-foundation.md`. Execute each detailed plan with
> superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Phase 1 of the spec `docs/superpowers/specs/2026-10-16-cuttle-design.md`: the project
format, timeline, WebGL engine, exporter, recorder, CLI and Claude skill, so Claude can record and
render a demo like the treg launch video with a handful of commands.

**Architecture:** pnpm monorepo in TypeScript. Pure packages (`project`, `timeline`) are plain
TypeScript tested with vitest. `engine` and `export` run in Chromium (a hidden Electron window) and
use WebGL2 and WebCodecs. `recorder` is Node and drives ffmpeg. `apps/cli` ties them together.

**Tech Stack:** TypeScript 5, pnpm workspaces, vitest, zod 4, Electron, WebGL2, WebCodecs,
Mediabunny, ffmpeg, uiohook-napi, koffi, commander.

---

## Milestones and order

```
M1 foundation (project + timeline) ──► M2 engine ──► M3 export ──┐
                         └──────────► M4 recorder ───────────────┴──► M5 CLI ──► M6 skill
```

M4 only depends on M1, so it can run in parallel with M2/M3 in a separate session (different
files, no overlap).

| # | Milestone | Detailed plan | Done when |
|---|---|---|---|
| M1 | Monorepo, `@cuttle/project`, `@cuttle/timeline` | `2026-10-16-cuttle-m1-foundation.md` | `pnpm test` and `pnpm typecheck` pass; timeline answers every spec rule with a test |
| M2 | `@cuttle/engine` (WebGL2 compositor + presets) | `2026-10-16-cuttle-m2-engine.md` | Golden-image tests for each preset, frame style, mask style, text style, the badge and all six cursor styles (with click ripple) pass in headless Electron |
| M3 | `@cuttle/export` (decode → render → encode → mux, audio via ffmpeg) | `2026-10-16-cuttle-m3-export.md` | A 10 s `testsrc` fixture renders to 16:9, 1:1 and 9:16; ffprobe shows the expected duration (±1 frame), size, H.264 and AAC |
| M4 | `@cuttle/recorder` (devices, ffmpeg backends, events, triggers, markers) | `2026-10-17-cuttle-m4-recorder.md` | The `test` backend records a 3 s take with all tracks; `untilFile` and `untilClaude` (fake transcript) stop it; a manual Windows run records a monitor |
| M5 | `apps/cli` (`cuttle …`) | `2026-10-17-cuttle-m5-cli.md` | Every spec command exists with `--json`; snapshot tests pass; the treg demo can be rebuilt from its takes with `cuttle suggest`, a few JSON edits and `cuttle render` |
| M6 | `skill/` + installer | `2026-10-17-cuttle-m6-skill.md` | `pnpm skill:install` writes `~/.claude/skills/cuttle/SKILL.md`; a fresh Claude Code session follows it end to end |

## Shared interfaces (fixed now, used by every milestone)

These come from M1. Later milestones import them and must not redefine them.

```ts
// @cuttle/project
export type Rect = [x: number, y: number, w: number, h: number]; // source pixels
export type CuttleProject = z.output<typeof ProjectSchema>;     // see M1 Task 2
export type Scene = CuttleProject['scenes'][number];
export type ClipScene = Extract<Scene, { type: 'clip' }>;
export type StillScene = Extract<Scene, { type: 'still' }>;
export type CardScene = Extract<Scene, { type: 'card' }>;
export type Zoom = CuttleProject['zooms'][number];
export type Mask = CuttleProject['masks'][number];
export type TextOverlay = CuttleProject['texts'][number];
export type InputEvent = z.output<typeof InputEventSchema>;   // one line of events.jsonl;
// t in source seconds; x, y in source pixels of the screen track (capture origin subtracted,
// display scale applied); outside [0, width) × [0, height) means off the captured area
export function parseEventsJsonl(text: string): { events: InputEvent[]; issues: ProjectIssue[] }; // M3; drops a cut-off last line
export type TakeFile = z.output<typeof TakeFileSchema>;         // take.json (M3): per-track first-capture times
// { version: 1, tracks: { screen: { file, start }, webcam?: { file, start }, mic?: { file, start } } },
// start in seconds on one monotonic clock; written by the recorder next to the take's tracks
export function parseTakeJson(text: string): { ok: true; take: TakeFile } | { ok: false; issues: ProjectIssue[] };
export function trackOffset(take: TakeFile, track: 'webcam' | 'mic'): number | undefined; // track start − screen start
export type Marker = z.output<typeof MarkerSchema>;            // one entry of markers.json (M4): { t, kind, label? },
// t in source seconds; kind 'manual' | 'prompt' | 'tool' | 'answer'; label: the tool's name or a manual note
export function parseMarkersJson(text: string): { ok: true; markers: Marker[] } | { ok: false; issues: ProjectIssue[] };
export type CursorShape = 'arrow' | 'text' | 'pointer' | 'wait' | 'crosshair' | 'move' | 'not-allowed';
export type CursorStyle = 'system' | 'arrow-white' | 'arrow-black' | 'dot' | 'ring' | 'spotlight';
export function parseProject(raw: unknown): ParseResult;
export function parseProjectJson(text: string): ParseResult;
export function defaultProject(screen?: string): CuttleProject;

// @cuttle/timeline
export interface ActiveText { overlay: TextOverlay; opacity: number }
export interface SceneFrame {
  index: number;
  kind: 'clip' | 'still' | 'card';
  local: number;        // seconds since the scene started, clamped to its duration
  progress: number;     // local / duration, 0..1
  opacity: number;      // 1 except during a crossfade
  sourceTime?: number;  // clip scenes: source seconds, always inside the clip's [from, to)
  zoom?: Rect;          // clip scenes: crop rect in source pixels, screen aspect, inside the screen
  masks: Mask[];        // clip scenes: active masks
  texts: ActiveText[];  // clip scenes: active texts with fade opacity
  badge?: string;       // clip scenes: e.g. "12× speed"
  cursor?: CursorFrame; // clip scenes: when look.cursor.enabled and a cursor track was given
}
export interface CursorFrame { x: number; y: number; shape: CursorShape; clicks: { x: number; y: number; progress: number }[] }
export interface RenderState { t: number; layers: SceneFrame[] } // back to front
export interface Timeline { duration: number; spans: SceneSpan[]; frameAt(t: number): RenderState }
export function createCursorTrack(events: readonly InputEvent[]): CursorTrack;
export function fitZoomRect(rect: Rect, full: Rect): Rect; // screen aspect, kept inside the screen
export function createTimeline(
  project: CuttleProject,
  opts: { screenSize: { width: number; height: number }; cursor?: CursorTrack },
): Timeline;
```

Interfaces the later milestones introduce (their detailed plans must keep these names):

```ts
// @cuttle/engine (M2)
// Keyed by SceneFrame.index: during a crossfade two clip layers with unrelated source times are
// visible at once, so every per-layer image is looked up by scene index.
export interface FrameSources {
  screens: Map<number, TexImageSource>;    // scene index → decoded frame at that layer's sourceTime
  webcams: Map<number, TexImageSource>;    // scene index → webcam frame at that layer's sourceTime; none (or an
                                           //   empty one) means no bubble
  stills: Map<number, ImageBitmap>;        // scene index → image for still scenes (premultiplied, not flipped,
                                           //   at most MAX_TEXTURE_SIZE per side)
}
// render throws on a missing or empty (0×0) screen frame, a missing, closed or oversized still,
// and a lost WebGL context
export interface Renderer { render(state: RenderState, sources: FrameSources): void; dispose(): void }
export type CursorImage = `system:${CursorShape}` | 'arrow-white' | 'arrow-black';
export const FONT_FAMILY = 'Cuttle Inter';                  // also exported: type Size { width; height }
export interface EngineAssets { cursors: ReadonlyMap<CursorImage, ImageBitmap> }
export function loadEngineAssets(): Promise<EngineAssets>;  // Inter fonts + cursor art; needs a window, load once
export interface RendererOptions {
  assets: EngineAssets;
  screenSize: { width: number; height: number };            // same as for createTimeline
  backgroundImage?: ImageBitmap;                            // required for look.background.preset 'image'
}
export function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, project: CuttleProject, options: RendererOptions): Renderer;

// @cuttle/export (M3) – Electron main process; bundle it with Vite and ship dist/export-page/ next to the bundle
export interface ExportOptions {
  projectDir: string;
  format?: '16:9' | '1:1' | '9:16';                         // without it: the project's output size
  out: string;                                               // written only on success (temp file + rename)
  onProgress?: (done: number, total: number) => void;        // frames
  encoder?: 'auto' | 'hardware' | 'software';                // auto: hardware first, software fallback
  pageDir?: string;                                          // default: export-page/ next to the bundle
  signal?: AbortSignal;                                      // cancels: window closed, ffmpeg killed, nothing at out
}
export interface ExportResult {
  out: string; frames: number; seconds: number;              // seconds = frames / fps
  stats: { gpu: string; codec: string; hardwareAcceleration: 'prefer-hardware' | 'prefer-software'; bitrate: number;
           page: { decodeMs: number; renderMs: number; encodeMs: number; finalizeMs: number; totalMs: number };
           audioMs: number; totalMs: number };
}
export function exportProject(opts: ExportOptions): Promise<ExportResult>;
export class ExportError extends Error {                     // CLI exit codes: 1, 1, 1, 2, 3, 130
  code: 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render' | 'cancelled';
}                                                            // also refused: an out path that is a project file
export const EXPORT_FORMATS: Record<'16:9' | '1:1' | '9:16', { width: number; height: number }>; // 1920×1080, 1080×1080, 1080×1920
export function renderStills(opts: StillsOptions): Promise<StillsResult>; // M5: PNGs of output frames (cuttle preview)
// StillsOptions: projectDir, format?, times (output seconds), outDir, sheet?: { columns? } (default 4), onProgress?, pageDir?, signal?
// StillsResult: { stills: { t, file }[]; sheet?: string; width; height; stats: { gpu, totalMs } }; files 01-12.50s.png, sheet.png

// @cuttle/recorder (M4) – Node (plain or Electron's main process); real capture on Windows, backend 'test' everywhere
export interface RecordOptions {
  projectDir: string;                      // must exist; the take goes to takes/<n>/
  source: { kind: 'monitor'; index: number } | { kind: 'region'; rect: Rect; monitor: number } | { kind: 'window'; title: string };
                                           // rect in that monitor's pixels; a window is the region of its bounds at the start
  webcam?: string; mic?: string;           // device names from listDevices()
  stop: { maxSeconds?: number; untilFile?: string; untilIdleSeconds?: number; untilClaude?: string /* cwd */ };
  countdownSeconds?: number;               // default 3
  drawMouse?: boolean;
  backend?: 'auto' | 'test';
  onEvent?: (event: RecorderEvent) => void; // countdown, recording, marker, warning, stopping
}
export interface Take {                    // paths relative to projectDir, with forward slashes
  dir: string; screen: string; webcam?: string; mic?: string; events: string; markers: string;
  screenSize: { width: number; height: number }; seconds: number;
  stopReason: 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude'; warnings: string[];
}
export interface Monitor { index: number; name: string; bounds: Bounds; scale: number; primary: boolean } // index = ddagrab output_idx
export interface WindowInfo { title: string; bounds: Bounds; monitor: number } // Bounds = { x, y, width, height }, physical desktop pixels
export function listDevices(opts?: { backend?: 'auto' | 'test' }): Promise<{ monitors: Monitor[]; windows: WindowInfo[]; cameras: string[]; mics: string[] }>;
export function record(opts: RecordOptions): { stop(): Promise<Take>; marker(label?: string): void; done: Promise<Take> };
export class RecorderError extends Error {    // CLI exit codes: 1, 2, 2, 2, 2, 130
  code: 'invalid-options' | 'device-not-found' | 'ffmpeg-missing' | 'capture' | 'unsupported-platform' | 'cancelled';
}
export const HOTKEYS: Record<'stop' | 'marker', string>; // Ctrl+Shift+Alt+S, Ctrl+Shift+Alt+M
```

## Things each later plan must verify first (before writing its tasks)

- **All milestones:** packages ship TypeScript source (`exports: ./src/index.ts`, extensionless
  relative imports, `moduleResolution: Bundler`). Plain Node and the Electron main process cannot
  import them without a bundler (or tsx), so M3–M5 need one. M2 needs the DOM lib: move to
  per-package tsconfigs instead of adding DOM to the root config, which would leak DOM globals into
  the pure packages. Since M2 every package has its tsconfig listed explicitly: a new package needs
  its own entry in the root `typecheck` script, or it is silently not typechecked. Code that
  imports `@cuttle/engine` must be bundled with Vite (or another bundler that understands `?url`
  imports; the engine imports its fonts that way).
- **M2:** done; see "Decisions made while planning" and "Changes during execution" in
  `2026-10-16-cuttle-m2-engine.md`.
- **M3:** done; see "Decisions made while planning" in `2026-10-16-cuttle-m3-export.md`.
- **M4:** done; see "Decisions made while planning" and "Changes during execution" in
  `2026-10-17-cuttle-m4-recorder.md`.
- **M5:** done; see "Decisions made while planning" in `2026-10-17-cuttle-m5-cli.md`.
- **M6:** done; see "Decisions made while planning" in `2026-10-17-cuttle-m6-skill.md`.

## Lessons from the manual run (carry into M4–M6)

- Start the recording before asking the user to act; their "done" may come too early.
- A recording on one monitor (`ddagrab output_idx`) at 30 fps with libx264 `ultrafast` kept up in
  real time at 2560×1440.
- Claude Code launched by the user picked up global hooks and plugins; masks were needed for hook
  errors. Suggest `claude --setting-sources "project,local" --strict-mcp-config`.
- Claude must not start Claude Code itself or edit `~/.claude.json`; the auto-mode classifier
  blocks it and the user has to accept the folder's trust dialog.
- PowerShell turns `project,local` into an array; quote comma-separated flag values.
- `drawtext` on Windows needs an explicit `fontfile`.
