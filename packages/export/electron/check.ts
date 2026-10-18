// End-to-end check of the export (M3 done criterion): builds a testsrc fixture project in a temp
// folder whose path has spaces and umlauts, exports it to 16:9, 1:1 and 9:16, and checks each file
// with ffprobe: duration (±1 frame), frame count, size, H.264 High and AAC 48 kHz stereo.
//   pnpm export:check [--seconds 10] [--layout showcase|long|speedup] [--formats 16:9,1:1,9:16]
//                     [--encoder auto|hardware|software] [--keep <dir>] [--frames t1,t2,...]
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { parseProjectJson } from '@cuttle/project';
import { sceneSpans, totalDuration } from '@cuttle/timeline';
import { BrowserWindow, app, protocol } from 'electron';
import { frameCount } from '../src/frame-plan';
import { EXPORT_FORMATS, MOTION_SCHEME_PRIVILEGES, exportProject, isExportFormat, type EncoderPreference, type ExportError, type ExportErrorCode, type ExportFormat } from '../src/index';
import { createFixtureProject, type FixtureLayout } from '../test/fixture';

const run = promisify(execFile);

interface ProbeStream {
  codec_type: string;
  codec_name: string;
  profile?: string;
  width?: number;
  height?: number;
  nb_frames?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function probe(file: string): Promise<{ streams: ProbeStream[]; format: { duration: string } }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,profile,width,height,nb_frames,duration,sample_rate,channels:format=duration',
    '-of', 'json', file,
  ]);
  return JSON.parse(stdout);
}

/** Samples the working set of every Electron process once a second; returns the peak per process type in MB. */
function sampleMemory(): () => Record<string, number> {
  const peak: Record<string, number> = {};
  const sample = () => {
    const byType: Record<string, number> = {};
    for (const metric of app.getAppMetrics()) byType[metric.type] = (byType[metric.type] ?? 0) + metric.memory.workingSetSize / 1024;
    for (const [type, mb] of Object.entries(byType)) peak[type] = Math.max(peak[type] ?? 0, Math.round(mb));
  };
  const timer = setInterval(sample, 1000);
  return () => {
    clearInterval(timer);
    sample();
    return peak;
  };
}

async function check(): Promise<boolean> {
  const seconds = Number(option('--seconds') ?? 10);
  const layout = (option('--layout') ?? 'showcase') as FixtureLayout;
  const formats = (option('--formats') ?? '16:9,1:1,9:16').split(',');
  const encoder = (option('--encoder') ?? 'auto') as EncoderPreference;
  const keep = option('--keep');
  const frameTimes = option('--frames')?.split(',').map(Number) ?? [];
  if (!formats.every(isExportFormat)) throw new Error(`unknown format in ${formats.join(',')}`);

  const root = keep ?? (await mkdtemp(join(tmpdir(), 'cuttle export Grüße ')));
  const projectDir = join(root, 'Projekt mit Ümlaut');
  const started = performance.now();
  await createFixtureProject(projectDir, { seconds, layout });
  console.log(`fixture (${layout}, ${seconds} s) in ${Math.round(performance.now() - started)} ms: ${projectDir}`);

  const parsed = parseProjectJson(await readFile(join(projectDir, 'cuttle.json'), 'utf8'));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const fps = parsed.project.output.fps;
  const expectedFrames = frameCount(totalDuration(sceneSpans(parsed.project.scenes, parsed.project.cuts)), fps);
  const expectedSeconds = expectedFrames / fps;

  let failures = 0;
  for (const format of formats as ExportFormat[]) {
    const out = join(root, 'out', `${format.replace(':', 'x')}.mp4`);
    const stopSampling = sampleMemory();
    const result = await exportProject({ projectDir, format, out, encoder });
    const memory = stopSampling();
    const { streams, format: container } = await probe(out);
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const { width, height } = EXPORT_FORMATS[format];
    const near = (value: string | undefined, target: number) => value !== undefined && Math.abs(Number(value) - target) <= 1 / fps + 1e-6;
    const problems = [
      video?.codec_name === 'h264' || `video codec ${video?.codec_name}`,
      video?.profile === 'High' || `video profile ${video?.profile}`,
      (video?.width === width && video?.height === height) || `size ${video?.width}x${video?.height}`,
      Number(video?.nb_frames) === expectedFrames || `video frames ${video?.nb_frames}, expected ${expectedFrames}`,
      near(video?.duration, expectedSeconds) || `video duration ${video?.duration}`,
      audio?.codec_name === 'aac' || `audio codec ${audio?.codec_name}`,
      audio?.sample_rate === '48000' || `audio sample rate ${audio?.sample_rate}`,
      audio?.channels === 2 || `audio channels ${audio?.channels}`,
      near(audio?.duration, expectedSeconds) || `audio duration ${audio?.duration}`,
      near(container.duration, expectedSeconds) || `container duration ${container.duration}`,
    ].filter((entry): entry is string => entry !== true);
    const total = result.stats.totalMs / 1000;
    console.log(
      `${problems.length === 0 ? 'ok  ' : 'FAIL'} ${format} ${width}x${height}: ${video?.nb_frames} frames, video ${video?.duration} s, ` +
        `audio ${audio?.duration} s, container ${container.duration} s (expected ${expectedSeconds} s)`,
    );
    console.log(
      `     ${total.toFixed(1)} s total = ${(total / expectedSeconds).toFixed(2)}× the video's duration, ` +
        `${(result.frames / (result.stats.page.totalMs / 1000)).toFixed(1)} frames/s in the page; ${JSON.stringify(result.stats)}; peak MB ${JSON.stringify(memory)}`,
    );
    for (const problem of problems) console.log(`     ${problem}`);
    failures += problems.length > 0 ? 1 : 0;
    for (const t of frameTimes) {
      const png = join(root, 'out', `${format.replace(':', 'x')}-${t.toFixed(2)}s.png`);
      // Explicit BT.709: the export is tagged so, but ffmpeg's PNG conversion does not always honour the tag.
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', out, '-vf', 'scale=in_color_matrix=bt709:in_range=tv,format=rgb24', '-frames:v', '1', png]);
      console.log(`     frame at ${t} s: ${png}`);
    }
  }
  await mkdir(join(root, 'out'), { recursive: true });
  const failurePaths = await checkFailurePaths(projectDir, join(root, 'out'));
  if (!keep) await rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? `all ${formats.length} formats pass` : `${failures} of ${formats.length} formats fail`);
  console.log(failurePaths === 0 ? 'all failure paths behave' : `${failurePaths} failure paths misbehave`);
  return failures === 0 && failurePaths === 0;
}

/** Work folders of exports in the temp folder (each export must remove its own). */
async function workFolders(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('cuttle-export-'));
}

/**
 * The failures M5 and the app rely on: each must reject with its code within seconds, leave no
 * output, no partial file and no work folder, and never touch the project's files.
 */
async function checkFailurePaths(projectDir: string, outDir: string): Promise<number> {
  const project = join(projectDir, 'cuttle.json');
  const cases: { name: string; code: ExportErrorCode; run(out: string): Promise<unknown> }[] = [
    { name: 'the output is the project file', code: 'invalid-project', run: () => exportProject({ projectDir, out: project }) },
    {
      name: 'cancelled after 10 frames',
      code: 'cancelled',
      run(out) {
        const cancel = new AbortController();
        return exportProject({ projectDir, out, signal: cancel.signal, onProgress: (done) => done === 10 && cancel.abort() });
      },
    },
    {
      name: 'the export window closed from outside after 10 frames',
      code: 'render',
      run: (out) =>
        exportProject({
          projectDir,
          out,
          onProgress: (done) => done === 10 && BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
        }),
    },
  ];
  const before = await readFile(project, 'utf8');
  const folders = await workFolders();
  let failures = 0;
  for (const { name, code, run } of cases) {
    const out = join(outDir, `failure-${cases.findIndex((entry) => entry.name === name)}.mp4`);
    const started = performance.now();
    const error = await run(out).then(
      () => undefined,
      (failure: ExportError) => failure,
    );
    const seconds = (performance.now() - started) / 1000;
    const leftovers = (await readdir(outDir)).filter((file) => file.startsWith(`.${basename(out)}.`) || file === basename(out));
    const problems = [
      error?.code === code || `expected ${code}, got ${error ? `${error.code}: ${error.message}` : 'success'}`,
      seconds < 30 || `took ${seconds.toFixed(1)} s`,
      leftovers.length === 0 || `left ${leftovers.join(', ')}`,
      (await readFile(project, 'utf8')) === before || 'changed cuttle.json',
      (await workFolders()).length === folders.length || 'left a work folder in the temp folder',
    ].filter((entry): entry is string => entry !== true);
    console.log(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${name}: ${error?.code} after ${seconds.toFixed(1)} s (${error?.message.split('\n')[0]})`);
    for (const problem of problems) console.log(`     ${problem}`);
    failures += problems.length > 0 ? 1 : 0;
  }
  return failures;
}

process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([MOTION_SCHEME_PRIVILEGES]);
app.whenReady().then(async () => {
  let ok = false;
  try {
    ok = await check();
  } catch (error) {
    console.error(error);
  }
  app.exit(ok ? 0 : 1);
});
