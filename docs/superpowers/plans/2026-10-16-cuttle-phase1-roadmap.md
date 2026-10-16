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
mp4box.js, mp4-muxer, ffmpeg, uiohook-napi, commander.

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
| M2 | `@cuttle/engine` (WebGL2 compositor + presets) | write before starting | Golden-image tests for each preset, frame style, mask style, text style, the badge and all six cursor styles (with click ripple) pass in headless Electron |
| M3 | `@cuttle/export` (decode → render → encode → mux, audio via ffmpeg) | write before starting | A 10 s `testsrc` fixture renders to 16:9, 1:1 and 9:16; ffprobe shows the expected duration (±1 frame), size, H.264 and AAC |
| M4 | `@cuttle/recorder` (devices, ffmpeg backends, events, triggers, markers) | write before starting | The `test` backend records a 3 s take with all tracks; `untilFile` and `untilClaude` (fake transcript) stop it; a manual Windows run records a monitor |
| M5 | `apps/cli` (`cuttle …`) | write before starting | Every spec command exists with `--json`; snapshot tests pass; the treg demo can be rebuilt from its takes with `cuttle suggest`, a few JSON edits and `cuttle render` |
| M6 | `skill/` + installer | write before starting | `pnpm skill:install` writes `~/.claude/skills/cuttle/SKILL.md`; a fresh Claude Code session follows it end to end |

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
export type InputEvent = z.output<typeof InputEventSchema>;   // one line of events.jsonl
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
  sourceTime?: number;  // clip scenes: seconds into the screen track
  zoom?: Rect;          // clip scenes: crop rect in source pixels
  masks: Mask[];        // clip scenes: active masks
  texts: ActiveText[];  // clip scenes: active texts with fade opacity
  badge?: string;       // clip scenes: e.g. "12× speed"
  cursor?: CursorFrame; // clip scenes: when look.cursor.enabled and a cursor track was given
}
export interface CursorFrame { x: number; y: number; shape: CursorShape; clicks: { x: number; y: number; progress: number }[] }
export interface RenderState { t: number; layers: SceneFrame[] } // back to front
export interface Timeline { duration: number; spans: SceneSpan[]; frameAt(t: number): RenderState }
export function createCursorTrack(events: readonly InputEvent[]): CursorTrack;
export function createTimeline(
  project: CuttleProject,
  opts: { screenSize: { width: number; height: number }; cursor?: CursorTrack },
): Timeline;
```

Interfaces the later milestones introduce (their detailed plans must keep these names):

```ts
// @cuttle/engine (M2)
export interface FrameSources {
  screen?: TexImageSource;                 // decoded VideoFrame for SceneFrame.sourceTime
  stills: Map<number, ImageBitmap>;        // scene index → image for still scenes
  webcam?: TexImageSource;
}
export interface Renderer { render(state: RenderState, sources: FrameSources): void; dispose(): void }
export function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, project: CuttleProject): Renderer;

// @cuttle/export (M3)
export interface ExportOptions { projectDir: string; format: '16:9' | '1:1' | '9:16'; out: string; onProgress?: (done: number, total: number) => void }
export function exportProject(opts: ExportOptions): Promise<{ out: string; frames: number; seconds: number }>;

// @cuttle/recorder (M4)
export interface RecordOptions {
  projectDir: string;
  source: { kind: 'monitor'; index: number } | { kind: 'region'; rect: Rect; monitor: number } | { kind: 'window'; title: string };
  webcam?: string; mic?: string;           // device names from listDevices()
  stop: { maxSeconds?: number; untilFile?: string; untilIdleSeconds?: number; untilClaude?: string /* cwd */ };
  countdownSeconds?: number; drawMouse?: boolean;
  backend?: 'auto' | 'test';
}
export interface Take { dir: string; screen: string; webcam?: string; mic?: string; events: string; markers: string; screenSize: { width: number; height: number }; seconds: number }
export function listDevices(): Promise<{ monitors: Monitor[]; windows: WindowInfo[]; cameras: string[]; mics: string[] }>;
export function record(opts: RecordOptions): { stop(): Promise<Take>; done: Promise<Take> };
```

## Things each later plan must verify first (before writing its tasks)

- **M2:** WebGL2 in Electron's hidden `BrowserWindow` with `show: false` and `offscreen: true`
  (preserveDrawingBuffer for readback); how to load a golden PNG in the test harness; pixelmatch
  tolerance that survives GPU differences between Windows and macOS CI. Cursor art: the `system`
  style needs redistributable pointer images per shape (draw our own lookalikes as SVG rather than
  copying OS cursor files, whose license is unclear); the five designed cursors are SVG too.
- **M3:** Electron's WebCodecs H.264 encoder availability (`VideoEncoder.isConfigSupported` with
  `avc1.640028`, 1920×1080) on Windows and macOS; fallback is piping RGBA frames to an ffmpeg
  child on stdin. Current mp4-muxer and mp4box.js APIs. Decoding strategy: sequential decode with
  a frame queue, not per-frame seeking.
- **M4:** Mapping from Electron `screen.getAllDisplays()` to ffmpeg `ddagrab output_idx` (on the
  user's PC, `output_idx=0` was the 2560×1440 primary and `1` a 1920×1080 secondary; match by
  size and position, never by order). Graceful ffmpeg stop by writing `q` to stdin. Fragmented MP4
  flags `-movflags +frag_keyframe+empty_moov+default_base_moof`. `uiohook-napi` prebuilt binaries for
  the Electron ABI. Cursor shape on Windows: poll `GetCursorInfo` (user32, via koffi) at ~30 Hz and
  compare `hCursor` with `LoadCursor(NULL, IDC_ARROW | IDC_IBEAM | IDC_HAND | IDC_WAIT | IDC_CROSS |
  IDC_SIZEALL | IDC_NO)`; write a `shape` event only when it changes; unknown handles map to `arrow`.
  macOS: best effort, `arrow` fallback. Claude transcripts live in `~/.claude/projects/<cwd with : \ / replaced by ->/`
  and have `timestamp`, `type` and `message.stop_reason`.
- **M5:** commander version; how the CLI starts the bundled Electron for `render`, `preview` and
  `capture-page`; `pnpm link --global` on Windows.
- **M6:** current Claude skill frontmatter (`name`, `description`) and the user-level skill folder.

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
