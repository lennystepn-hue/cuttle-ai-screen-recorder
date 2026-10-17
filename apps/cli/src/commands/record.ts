import { resolve } from 'node:path';
import { HOTKEYS, listDevices, record, type Backend, type CaptureSource, type Take } from '@cuttle/recorder';
import type { Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, readProjectFile, writeProjectFile } from '../project-file';
import { useTake } from '../use-take';

export interface RecordArgs {
  monitor?: number;
  /** "x,y,w,h" in pixels of `monitor` (default: the primary monitor); PowerShell passes it split at the commas. */
  region?: string | string[];
  window?: string;
  /** A camera name, or true for the first camera. */
  webcam?: string | true;
  mic?: string | true;
  /** The folder Claude Code runs in, or true for the current folder. */
  untilClaude?: string | true;
  untilFile?: string;
  untilIdle?: number;
  max?: number;
  countdown?: number;
  drawMouse?: boolean;
  backend: Backend;
}

export interface RecordResult {
  project: string;
  take: Take;
  /** The previous cuttle.json, when the take replaced scenes or overlays. */
  backup?: string;
}

/**
 * `cuttle record`: records a take into the project (created when missing) and points the project at
 * it. Ctrl+C (`signal`) stops the recording like the stop hotkey; the take is kept.
 */
export async function recordCommand(projectDir: string, args: RecordArgs, output: Output, signal: AbortSignal): Promise<RecordResult> {
  const devices = await listDevices({ backend: args.backend });
  const source = captureSource(args, devices.monitors.find((monitor) => monitor.primary)?.index ?? devices.monitors[0]?.index ?? 0);
  const webcam = deviceName('camera', args.webcam, devices.cameras);
  const mic = deviceName('microphone', args.mic, devices.mics);
  const file = projectExists(projectDir) ? await readProjectFile(projectDir) : await writeProjectFile(newProjectFile(projectDir));
  if (signal.aborted) throw new CliError('cancelled', 'stopped before the recording started');

  const recording = record({
    projectDir: file.dir,
    source,
    ...(webcam !== undefined && { webcam }),
    ...(mic !== undefined && { mic }),
    stop: {
      ...(args.max !== undefined && { maxSeconds: args.max }),
      ...(args.untilFile !== undefined && { untilFile: args.untilFile }),
      ...(args.untilIdle !== undefined && { untilIdleSeconds: args.untilIdle }),
      ...(args.untilClaude !== undefined && { untilClaude: args.untilClaude === true ? process.cwd() : resolve(args.untilClaude) }),
    },
    ...(args.countdown !== undefined && { countdownSeconds: args.countdown }),
    drawMouse: args.drawMouse ?? false,
    backend: args.backend,
    onEvent(event) {
      if (event.type === 'countdown') output.info(`recording in ${event.seconds} …`);
      if (event.type === 'recording') output.info(`recording ${event.dir}; stop: Ctrl+C or ${HOTKEYS.stop}, marker: ${HOTKEYS.marker}`);
      if (event.type === 'marker') output.info(`marker ${event.marker.kind}${event.marker.label ? ` ${event.marker.label}` : ''} at ${event.marker.t.toFixed(2)} s`);
      if (event.type === 'warning') output.warn(event.message);
      if (event.type === 'stopping') output.info(`stopping (${event.reason}) …`);
    },
  });
  const stop = () => void recording.stop().catch(() => {});
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop(); // Ctrl+C while the recorder was being set up
  let take: Take;
  try {
    take = await recording.done;
  } finally {
    signal.removeEventListener('abort', stop);
  }

  const backup = await useTake(file, take);
  if (args.drawMouse) {
    // The real pointer is in the video: the engine's cursor would be a second one.
    const look = (file.raw.look ?? {}) as Record<string, unknown>;
    file.raw.look = { ...look, cursor: { ...((look.cursor as Record<string, unknown> | undefined) ?? {}), enabled: false } };
  } else if (!file.project.look.cursor.enabled) {
    // Left from an earlier --draw-mouse take, this take would show no pointer at all.
    output.warn('look.cursor.enabled is false (from an earlier --draw-mouse take?): this take has no pointer in the video, so set it to true to show one');
  }
  await writeProjectFile(file);
  const result: RecordResult = { project: file.path, take, ...(backup && { backup }) };
  output.result(result, () =>
    [
      `recorded ${take.dir}: ${take.seconds.toFixed(1)} s, ${take.screenSize.width}×${take.screenSize.height} (${take.stopReason})`,
      ...take.warnings.map((warning) => `warning: ${warning}`),
      `${file.path} now uses this take${backup ? ` (previous version: ${backup})` : ''}`,
      ...(args.drawMouse ? ['look.cursor.enabled is now false: the pointer is in the video'] : []),
      'next: cuttle suggest, then cuttle preview',
    ].join('\n'),
  );
  return result;
}

function captureSource(args: RecordArgs, primary: number): CaptureSource {
  if (args.window !== undefined) {
    if (args.region !== undefined || args.monitor !== undefined) throw new CliError('usage', '--window cannot be combined with --monitor or --region');
    return { kind: 'window', title: args.window };
  }
  const monitor = args.monitor ?? primary;
  if (args.region === undefined) return { kind: 'monitor', index: monitor };
  const region = [args.region].flat().join(',');
  const parts = region.split(/[\s,]+/).filter((part) => part !== '').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new CliError('usage', `--region needs x,y,w,h in pixels of the monitor, e.g. 0,0,1920,1080 (got "${region}")`);
  }
  return { kind: 'region', rect: parts as Rect, monitor };
}

function deviceName(kind: 'camera' | 'microphone', wanted: string | true | undefined, available: string[]): string | undefined {
  if (wanted === undefined || wanted !== true) return wanted;
  const first = available[0];
  if (first === undefined) throw new CliError('device-not-found', `no ${kind} found; "cuttle devices" lists them`);
  return first;
}
