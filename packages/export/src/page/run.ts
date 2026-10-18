import { FONT_FAMILY, createRenderer, loadEngineAssets, type Renderer } from '@cuttle/engine';
import { createCursorTrack, createTimeline, type Timeline } from '@cuttle/timeline';
import { planFrames, planStills, shownSourceTime, stillFrames, type FramePlan } from '../frame-plan';
import type { ExportJob, PageJob, PageResult, PageStillsSuccess, PageSuccess, StillsJob } from '../job';
import { host, PageError } from './host';
import { loadImage } from './images';
import { openVideo, type VideoFile } from './media';
import { SceneSources } from './scene-sources';
import { createVideoOutput } from './video-output';

/** Seconds before a scene first shows that its decoders start. */
const LOOKAHEAD_SECONDS = 1;
/** A clip may end this far past the last frame of the recording (rounding of recorded durations). */
const END_TOLERANCE_SECONDS = 0.05;

function gpuName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/**
 * MAX_TEXTURE_SIZE from a throwaway context: the background image must be decoded before
 * createRenderer, and the canvas's own context must be created by createRenderer (its attributes).
 */
function probeMaxTextureSize(): number {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not available');
  const size = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return size;
}

function checkClipRanges(job: PageJob, screen: VideoFile | undefined): void {
  job.project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && !screen) throw new PageError('invalid-project', `scenes[${index}] is a clip, but the project has no screen recording`);
    if (scene.type === 'clip' && screen && scene.to > screen.end + END_TOLERANCE_SECONDS) {
      throw new PageError(
        'invalid-project',
        `scenes[${index}] ends at ${scene.to} s, but the screen recording ends at ${screen.end.toFixed(3)} s`,
      );
    }
  });
}

/** What a video and a stills job share: the timeline, the renderer on its canvas and the scene sources. */
interface Rendering {
  timeline: Timeline;
  plan: FramePlan;
  renderer: Renderer;
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  sources: SceneSources;
}

/**
 * Opens the job's media, builds the timeline and the plan (`makePlan`), creates the renderer and the
 * scene sources, runs `body` and frees everything afterwards.
 */
async function withRendering<T>(job: PageJob, makePlan: (timeline: Timeline) => FramePlan, lookahead: number, body: (rendering: Rendering) => Promise<T>): Promise<T> {
  const { project } = job;
  const [assets, screen, webcam] = await Promise.all([
    loadEngineAssets(),
    job.screen ? openVideo(job.screen, 'the screen recording') : undefined,
    job.webcam ? openVideo(job.webcam.path, 'the webcam recording') : undefined,
  ]);
  const canvas = new OffscreenCanvas(1, 1);
  let background: ImageBitmap | undefined;
  let sources: SceneSources | undefined;
  let renderer: Renderer | undefined;
  try {
    checkClipRanges(job, screen);
    // without a take, the output's size stands in for the screen's (no clip shows it)
    const screenSize = screen?.size ?? { width: project.output.width, height: project.output.height };
    const timeline = createTimeline(project, {
      screenSize,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
      ...(job.transcript && { transcript: job.transcript }),
      ...(job.captions !== undefined && { captions: job.captions }),
    });
    const plan = makePlan(timeline);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    renderer = createRenderer(canvas, project, { assets, screenSize, backgroundImage: background });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, maxTextureSize },
      lookahead,
      { project, spans: timeline.spans, stateAt: (frame) => timeline.frameAt(frame / plan.fps), ahead: job.kind === 'video' },
    );
    return await body({ timeline, plan, renderer, canvas, gl, sources });
  } finally {
    await sources?.close();
    renderer?.dispose();
    // Free the context now instead of waiting for GC (browsers keep only ~16 live WebGL contexts).
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    background?.close();
    screen?.input.dispose();
    webcam?.input.dispose();
  }
}

async function exportVideo(job: ExportJob): Promise<PageSuccess> {
  const started = performance.now();
  const fps = job.project.output.fps;
  return withRendering(job, (timeline) => planFrames(timeline, fps), Math.round(LOOKAHEAD_SECONDS * fps), async ({ timeline, plan, renderer, canvas, gl, sources }) => {
    const output = await createVideoOutput(canvas, job.project.output, job.encoder);
    const timings = { decodeMs: 0, renderMs: 0, encodeMs: 0, finalizeMs: 0, totalMs: 0 };
    try {
      for (let frame = 0; frame < plan.frames; frame++) {
        const t0 = performance.now();
        const state = timeline.frameAt(frame / fps);
        const frameSources = await sources.sourcesFor(frame, state);
        await sources.transition(state, () => renderer.layerPixels(state, frameSources));
        const t1 = performance.now();
        renderer.render(state, frameSources);
        // render() throws on a lost context too; this catches a loss between render and capture.
        if (gl.isContextLost()) throw new Error('the WebGL context was lost during the export');
        const t2 = performance.now();
        await output.add(frame / fps, 1 / fps);
        const t3 = performance.now();
        await sources.release(frame);
        host().progress(frame + 1, plan.frames);
        timings.decodeMs += t1 - t0;
        timings.renderMs += t2 - t1;
        timings.encodeMs += t3 - t2;
      }
      const t4 = performance.now();
      await output.finalize();
      timings.finalizeMs = performance.now() - t4;
    } catch (error) {
      await output.cancel().catch(() => {}); // the original error matters, not a failed cleanup
      throw error;
    }
    timings.totalMs = performance.now() - started;
    for (const key of Object.keys(timings) as (keyof typeof timings)[]) timings[key] = Math.round(timings[key]);
    return {
      ok: true,
      frames: plan.frames,
      codec: output.codec,
      hardwareAcceleration: output.hardwareAcceleration,
      bitrate: output.bitrate,
      gpu: gpuName(gl),
      timings,
    };
  });
}

/** Contact sheet: each still this wide, its time below it. */
const SHEET_CELL_WIDTH = 480;
const SHEET_LABEL_HEIGHT = 34;
const SHEET_GAP = 12;

async function png(canvas: OffscreenCanvas): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

async function renderStills(job: StillsJob): Promise<PageStillsSuccess> {
  const started = performance.now();
  const { fps, width, height } = job.project.output;
  /** The output frame of each of `job.times`, set when the plan is made. */
  let byTime: number[] = [];
  return withRendering(
    job,
    (timeline) => {
      // The output frame on screen at each time; times past the end show the last frame.
      byTime = stillFrames(timeline.duration, fps, job.times);
      return planStills(timeline, fps, byTime);
    },
    0,
    async ({ timeline, renderer, canvas, gl, sources }) => {
      const columns = job.sheet ? Math.max(1, Math.min(job.sheet.columns, job.times.length)) : 0;
      const cellHeight = Math.round((SHEET_CELL_WIDTH * height) / width);
      const sheet = job.sheet
        ? new OffscreenCanvas(
            SHEET_GAP + columns * (SHEET_CELL_WIDTH + SHEET_GAP),
            SHEET_GAP + Math.ceil(job.times.length / columns) * (cellHeight + SHEET_LABEL_HEIGHT + SHEET_GAP),
          )
        : undefined;
      const context = sheet?.getContext('2d');
      if (context) {
        context.fillStyle = '#16161a';
        context.fillRect(0, 0, sheet!.width, sheet!.height);
        context.font = `500 20px "${FONT_FAMILY}", sans-serif`;
        context.textBaseline = 'middle';
      }
      const unique = [...new Set(byTime)].sort((a, b) => a - b);
      for (const [done, frame] of unique.entries()) {
        const state = timeline.frameAt(frame / fps);
        const frameSources = await sources.sourcesFor(frame, state);
        await sources.transition(state, () => renderer.layerPixels(state, frameSources));
        renderer.render(state, frameSources);
        if (gl.isContextLost()) throw new Error('the WebGL context was lost while rendering stills');
        const image = await png(canvas);
        for (const [n, frameOfTime] of byTime.entries()) {
          if (frameOfTime !== frame) continue;
          await host().writeStill(`still-${n}`, image);
          if (context) {
            const x = SHEET_GAP + (n % columns) * (SHEET_CELL_WIDTH + SHEET_GAP);
            const y = SHEET_GAP + Math.floor(n / columns) * (cellHeight + SHEET_LABEL_HEIGHT + SHEET_GAP);
            context.drawImage(canvas, x, y, SHEET_CELL_WIDTH, cellHeight);
            context.fillStyle = '#e8e8ea';
            context.fillText(`${job.times[n]!.toFixed(2)} s`, x, y + cellHeight + SHEET_LABEL_HEIGHT / 2);
          }
        }
        await sources.release(frame);
        host().progress(done + 1, unique.length);
      }
      if (sheet) await host().writeStill('sheet', await png(sheet));
      // The source second each still shows, from the frame it really is (null on a still or card).
      const shown = byTime.map((frame) => shownSourceTime(timeline.frameAt(frame / fps)) ?? null);
      return { ok: true, stills: job.times.length, sources: shown, width, height, gpu: gpuName(gl), totalMs: Math.round(performance.now() - started) };
    },
  );
}

/** Runs the job the main process prepared; never throws, failures come back as `{ ok: false }`. */
export async function run(): Promise<PageResult> {
  try {
    const job = await host().job();
    return job.kind === 'stills' ? await renderStills(job) : await exportVideo(job);
  } catch (error) {
    // Unexpected errors keep their stack on stderr. The main process forwards page errors as text, so
    // spell them out (a DOMException would print as "[object DOMException]"); a V8 stack starts with
    // "Name: message", a DOMException may have none.
    if (!(error instanceof PageError)) {
      console.error(error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error));
    }
    return {
      ok: false,
      code: error instanceof PageError ? error.code : 'render',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
