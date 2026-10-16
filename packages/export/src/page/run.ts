import { createRenderer, loadEngineAssets } from '@cuttle/engine';
import { createCursorTrack, createTimeline } from '@cuttle/timeline';
import type { VideoSinkDecoderOptions } from 'mediabunny';
import { planFrames } from '../frame-plan';
import type { ExportJob, PageResult, PageSuccess } from '../job';
import { host, PageError } from './host';
import { loadImage } from './images';
import { openVideo, type VideoFile } from './media';
import { SceneSources } from './scene-sources';
import { createVideoOutput } from './video-output';

/** Seconds before a scene first shows that its decoders start. */
const LOOKAHEAD_SECONDS = 1;
/**
 * Decode in software: Chromium's software H.264 decoder is multi-threaded and keeps the GPU's video
 * engine free for the encoder. On the reference PC it made a 12× speed-up export 2.1× faster and a
 * plain 60 s export 1.2× faster than hardware decoding.
 */
const DECODER: VideoSinkDecoderOptions = { hardwareAcceleration: 'prefer-software' };
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

function checkClipRanges(job: ExportJob, screen: VideoFile): void {
  job.project.scenes.forEach((scene, index) => {
    if (scene.type === 'clip' && scene.to > screen.end + END_TOLERANCE_SECONDS) {
      throw new PageError(
        'invalid-project',
        `scenes[${index}] ends at ${scene.to} s, but the screen recording ends at ${screen.end.toFixed(3)} s`,
      );
    }
  });
}

async function exportVideo(job: ExportJob): Promise<PageSuccess> {
  const started = performance.now();
  const { project } = job;
  const fps = project.output.fps;
  const [assets, screen, webcam] = await Promise.all([
    loadEngineAssets(),
    openVideo(job.screen, 'the screen recording'),
    job.webcam ? openVideo(job.webcam.path, 'the webcam recording') : undefined,
  ]);
  const canvas = new OffscreenCanvas(1, 1);
  let background: ImageBitmap | undefined;
  let sources: SceneSources | undefined;
  let renderer: ReturnType<typeof createRenderer> | undefined;
  try {
    checkClipRanges(job, screen);
    const timeline = createTimeline(project, {
      screenSize: screen.size,
      cursor: job.events ? createCursorTrack(job.events) : undefined,
    });
    const plan = planFrames(timeline, fps);
    if (job.backgroundImage) background = await loadImage(job.backgroundImage, probeMaxTextureSize(), 'the background image');
    renderer = createRenderer(canvas, project, { assets, screenSize: screen.size, backgroundImage: background });
    const gl = canvas.getContext('webgl2')!;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const output = await createVideoOutput(canvas, project.output, job.encoder);
    sources = new SceneSources(
      plan,
      { screen, webcam: webcam && job.webcam ? { ...webcam, offset: job.webcam.offset } : undefined, stills: job.stills, maxTextureSize, decoder: DECODER },
      Math.round(LOOKAHEAD_SECONDS * fps),
    );

    const timings = { decodeMs: 0, renderMs: 0, encodeMs: 0, finalizeMs: 0, totalMs: 0 };
    try {
      for (let frame = 0; frame < plan.frames; frame++) {
        const t0 = performance.now();
        const state = timeline.frameAt(frame / fps);
        const frameSources = await sources.sourcesFor(frame, state);
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
  } finally {
    await sources?.close();
    renderer?.dispose();
    // Free the context now instead of waiting for GC (browsers keep only ~16 live WebGL contexts).
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    background?.close();
    screen.input.dispose();
    webcam?.input.dispose();
  }
}

/** Runs the export the main process prepared; never throws, failures come back as `{ ok: false }`. */
export async function run(): Promise<PageResult> {
  try {
    return await exportVideo(await host().job());
  } catch (error) {
    // Unexpected errors keep their stack on stderr (the main process forwards page errors).
    if (!(error instanceof PageError)) console.error(error);
    return {
      ok: false,
      code: error instanceof PageError ? error.code : 'render',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
