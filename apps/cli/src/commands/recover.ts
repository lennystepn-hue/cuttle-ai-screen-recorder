import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, parseEventsJsonl, parseMarkersJson, parseTakeJson, type TakeFile } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { backupFile, newProjectFile, projectExists, readProjectFile, writeProjectFile } from '../project-file';
import { streamSeconds } from '../suggest/media';
import { samePath, useTake } from '../use-take';

export interface RecoverResult {
  project: string;
  /** The take folder, relative to the project. */
  take: string;
  seconds: number;
  tracks: string[];
  /** What was repaired, for people; empty when the take was fine. */
  repaired: string[];
  /** Whether the project's scenes and overlays were kept (the take was already the project's). */
  keptEdit: boolean;
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

/**
 * `cuttle recover <take>` (a folder relative to the project, e.g. takes/3): makes a take usable after
 * a crash (the recorder's fragmented MP4s stay readable up to their last fragment): checks every
 * track, drops a cut-off events.jsonl line, rewrites markers.json and take.json when they are missing
 * or broken (every changed file is backed up first), and points the project at the take. When the
 * project already uses that take, its scenes and overlays stay.
 */
export async function recoverCommand(projectDir: string, takeDir: string, output: Output): Promise<RecoverResult> {
  const project = resolve(projectDir);
  const dir = resolve(project, takeDir);
  const rel = relative(project, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new CliError('usage', `the take ${dir} must be a folder inside the project ${project}`);
  // A broken cuttle.json stops the command before anything in the take changes.
  const file = projectExists(project) ? await readProjectFile(project) : newProjectFile(project);
  const path = (name: string) => join(dir, name);
  const source = (name: string) => `${rel.split(sep).join('/')}/${name}`;
  const repaired: string[] = [];

  const seconds = await streamSeconds(path(FILES.screen), 'v');
  if (seconds <= 0) throw new CliError('invalid-media', `${path(FILES.screen)} is missing or has no readable video; nothing to recover`);
  const webcam = existsSync(path(FILES.webcam)) && (await streamSeconds(path(FILES.webcam), 'v')) > 0;
  const mic = existsSync(path(FILES.mic)) && (await streamSeconds(path(FILES.mic), 'a')) > 0;
  for (const [ok, name] of [[webcam, FILES.webcam], [mic, FILES.mic]] as const) {
    if (!ok && existsSync(path(name))) repaired.push(`left out ${name}: it has nothing readable`);
  }

  // events.jsonl: keep the valid lines as they are (a crash cuts off the last one).
  if (existsSync(path(FILES.events))) {
    const text = await readFile(path(FILES.events), 'utf8');
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const kept = lines.filter((line) => {
      const { events, issues } = parseEventsJsonl(`${line}\n`);
      return events.length === 1 && issues.length === 0;
    });
    if (kept.length < lines.length || (text !== '' && !text.endsWith('\n'))) {
      const backup = await backupFile(path(FILES.events));
      await writeFile(path(FILES.events), kept.map((line) => `${line}\n`).join(''));
      repaired.push(`events.jsonl: kept ${kept.length} events, dropped ${lines.length - kept.length} broken or cut-off line(s) (old file: ${relative(dir, backup)})`);
    }
  } else {
    await writeFile(path(FILES.events), '');
    repaired.push('events.jsonl was missing: written empty (no cursor, clicks or keys)');
  }

  const markersText = existsSync(path(FILES.markers)) ? await readFile(path(FILES.markers), 'utf8') : undefined;
  if (markersText === undefined || !parseMarkersJson(markersText).ok) {
    const backup = markersText === undefined ? undefined : await backupFile(path(FILES.markers));
    await writeFile(path(FILES.markers), `${JSON.stringify({ version: MARKERS_VERSION, markers: [] }, null, 2)}\n`);
    repaired.push(backup === undefined ? 'markers.json was missing: written empty' : `markers.json was broken: written empty (old file: ${relative(dir, backup)})`);
  }

  const takeText = existsSync(path(FILES.take)) ? await readFile(path(FILES.take), 'utf8') : undefined;
  const parsed = takeText === undefined ? undefined : parseTakeJson(takeText);
  if (!parsed?.ok) {
    const backup = takeText === undefined ? undefined : await backupFile(path(FILES.take));
    // Start times that can still be read are kept: they sync webcam and mic and place Claude's markers.
    const starts = readableStarts(takeText);
    const screenStart = starts.screen ?? 0;
    const take: TakeFile = {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenStart },
        ...(webcam && { webcam: { file: FILES.webcam, start: starts.webcam ?? screenStart } }),
        ...(mic && { mic: { file: FILES.mic, start: starts.mic ?? screenStart } }),
      },
    };
    await writeFile(path(FILES.take), `${JSON.stringify(take, null, 2)}\n`);
    const what = backup === undefined ? 'take.json was missing' : `take.json was broken (old file: ${relative(dir, backup)})`;
    const guessed = (webcam && starts.webcam === undefined) || (mic && starts.mic === undefined);
    repaired.push(
      starts.screen === undefined
        ? `${what}: written with the tracks starting together at an unknown time${webcam || mic ? ' (webcam and mic may be off by up to a second)' : ''}`
        : `${what}: rewritten with the screen's start time${guessed ? '; webcam and mic start with it (may be off by up to a second)' : ''}`,
    );
  }

  const keepEdit = file.project.scenes.length > 0 && samePath(resolve(file.dir, file.project.sources.screen), path(FILES.screen));
  const backup = await useTake(
    file,
    {
      screen: source(FILES.screen),
      ...(webcam && { webcam: source(FILES.webcam) }),
      ...(mic && { mic: source(FILES.mic) }),
      events: source(FILES.events),
      markers: source(FILES.markers),
      seconds,
    },
    keepEdit,
  );
  await writeProjectFile(file);
  const result: RecoverResult = {
    project: file.path,
    take: rel.split(sep).join('/'),
    seconds,
    tracks: ['screen', ...(webcam ? ['webcam'] : []), ...(mic ? ['mic'] : [])],
    repaired,
    keptEdit: keepEdit,
    ...(backup && { backup }),
  };
  output.result(result, () =>
    [
      `${result.take}: ${seconds.toFixed(1)} s, tracks: ${result.tracks.join(', ')}`,
      ...(repaired.length > 0 ? repaired.map((note) => `- ${note}`) : ['nothing needed repair']),
      keepEdit
        ? `${file.path} already used this take: scenes and overlays kept`
        : `${file.path} now uses this take${backup ? ` (previous version: ${backup})` : ''}`,
    ].join('\n'),
  );
  return result;
}

/** The track start times in a take.json that fails the schema but is still JSON. */
function readableStarts(text: string | undefined): Partial<Record<'screen' | 'webcam' | 'mic', number>> {
  try {
    const tracks = (JSON.parse(text ?? '') as { tracks?: Record<string, { start?: unknown } | undefined> }).tracks ?? {};
    const starts: Partial<Record<'screen' | 'webcam' | 'mic', number>> = {};
    for (const track of ['screen', 'webcam', 'mic'] as const) {
      const start = tracks[track]?.start;
      if (typeof start === 'number' && Number.isFinite(start) && start >= 0) starts[track] = start;
    }
    return starts;
  } catch {
    return {};
  }
}
