import { existsSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, parseEventsJsonl, parseMarkersJson, parseSegmentsJson, parseTakeJson, type Segment, type TakeFile } from '@cuttle/project';
import { joinSegments } from '@cuttle/recorder';
import { CoreError } from './errors';
import { backupFile, newProjectFile, projectExists, readProjectFile, writeProjectFile } from './project-file';
import { streamSeconds } from './suggest/media';
import { samePath, useTake } from './use-take';

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

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', system: 'system.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json', transcript: 'transcript.json', cleanMic: 'mic.clean.m4a' };

/**
 * Recovers a take (a folder relative to the project, e.g. takes/3): makes it usable after
 * a crash (the recorder's fragmented MP4s stay readable up to their last fragment): checks every
 * track, drops a cut-off events.jsonl line, rewrites markers.json and take.json when they are missing
 * or broken (every changed file is backed up first), and points the project at the take. When the
 * project already uses that take, its scenes and overlays stay.
 */
export async function recoverTake(projectDir: string, takeDir: string): Promise<RecoverResult> {
  const project = resolve(projectDir);
  const dir = resolve(project, takeDir);
  const rel = relative(project, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new CoreError('usage', `the take ${dir} must be a folder inside the project ${project}`);
  // A broken cuttle.json stops the command before anything in the take changes.
  const file = projectExists(project) ? await readProjectFile(project) : newProjectFile(project);
  const path = (name: string) => join(dir, name);
  const source = (name: string) => `${rel.split(sep).join('/')}/${name}`;
  const repaired: string[] = [];

  await joinPaused(dir, repaired);
  const seconds = await streamSeconds(path(FILES.screen), 'v');
  if (seconds <= 0) throw new CoreError('invalid-media', `${path(FILES.screen)} is missing or has no readable video; nothing to recover`);
  const webcam = existsSync(path(FILES.webcam)) && (await streamSeconds(path(FILES.webcam), 'v')) > 0;
  const mic = existsSync(path(FILES.mic)) && (await streamSeconds(path(FILES.mic), 'a')) > 0;
  const system = existsSync(path(FILES.system)) && (await streamSeconds(path(FILES.system), 'a')) > 0;
  for (const [ok, name] of [[webcam, FILES.webcam], [mic, FILES.mic], [system, FILES.system]] as const) {
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
    // Start times that can still be read are kept: they sync webcam and mic and place Claude's
    // markers. Without the screen's, the others mean nothing (they are relative to it): all start at 0.
    const readable = readableStarts(takeText);
    const starts: typeof readable = readable.screen === undefined ? {} : readable;
    const screenStart = starts.screen ?? 0;
    const take: TakeFile = {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenStart },
        ...(webcam && { webcam: { file: FILES.webcam, start: starts.webcam ?? screenStart } }),
        ...(mic && { mic: { file: FILES.mic, start: starts.mic ?? screenStart } }),
        ...(system && { system: { file: FILES.system, start: starts.system ?? screenStart } }),
      },
    };
    await writeFile(path(FILES.take), `${JSON.stringify(take, null, 2)}\n`);
    const what = backup === undefined ? 'take.json was missing' : `take.json was broken (old file: ${relative(dir, backup)})`;
    const guessed = (webcam && starts.webcam === undefined) || (mic && starts.mic === undefined) || (system && starts.system === undefined);
    repaired.push(
      starts.screen === undefined
        ? `${what}: written with the tracks starting together at an unknown time${webcam || mic ? ' (webcam and mic may be off by up to a second)' : ''}`
        : `${what}: rewritten with the screen's start time${guessed ? '; webcam and mic start with it (may be off by up to a second)' : ''}`,
    );
  }

  const { scenes, zooms, masks, texts, cuts } = file.project;
  const sameTake = samePath(resolve(file.dir, file.project.sources.screen), path(FILES.screen));
  const keepEdit = sameTake && scenes.length + zooms.length + masks.length + texts.length + cuts.length > 0;
  const hadEdit = useTake(
    file,
    {
      screen: source(FILES.screen),
      ...(webcam && { webcam: source(FILES.webcam) }),
      ...(mic && { mic: source(FILES.mic) }),
      ...(system && { system: source(FILES.system) }),
      events: source(FILES.events),
      markers: source(FILES.markers),
      ...(existsSync(path(FILES.transcript)) && { transcript: source(FILES.transcript) }),
      ...(mic && existsSync(path(FILES.cleanMic)) && { cleanMic: source(FILES.cleanMic) }),
      seconds,
    },
    sameTake,
  );
  const { backup } = await writeProjectFile(file, 'recover', { backup: hadEdit });
  const result: RecoverResult = {
    project: file.path,
    take: rel.split(sep).join('/'),
    seconds,
    tracks: ['screen', ...(webcam ? ['webcam'] : []), ...(mic ? ['mic'] : []), ...(system ? ['system'] : [])],
    repaired,
    keptEdit: keepEdit,
    ...(backup && { backup }),
  };
  return result;
}

/**
 * A take that was paused and never joined (the recorder ended during it): its segments are joined
 * from segments.json as the recorder would have, lined up by their stamps. A segment without
 * readable video is left out, a track without readable media is left out of its segment, and the
 * last segment's length is measured (it was still recording).
 */
async function joinPaused(dir: string, repaired: string[]): Promise<void> {
  const manifest = join(dir, FILES.segments);
  const parsed = existsSync(manifest) ? parseSegmentsJson(await readFile(manifest, 'utf8')) : undefined;
  if (!parsed?.ok || parsed.segments.joined) return;
  const segments: Segment[] = [];
  for (const [index, segment] of parsed.segments.segments.entries()) {
    const seconds = await streamSeconds(join(dir, segment.screen.file), 'v');
    if (seconds <= 0) {
      repaired.push(`left out segment ${index + 1} of the paused take: ${segment.screen.file} has no readable video`);
      continue;
    }
    const kept: Segment = { ...segment, duration: segment.duration ?? seconds };
    for (const [track, stream] of [['webcam', 'v'], ['mic', 'a'], ['system', 'a']] as const) {
      const entry = kept[track];
      if (entry && (await streamSeconds(join(dir, entry.file), stream)) <= 0) {
        delete kept[track];
        repaired.push(`left out ${entry.file}: it has nothing readable`);
      }
    }
    segments.push(kept);
  }
  if (segments.length === 0) return;
  const has = await joinSegments(dir, segments, { screen: FILES.screen, webcam: FILES.webcam, mic: FILES.mic, system: FILES.system });
  const start = segments[0]!.screen.start;
  const take: TakeFile = {
    version: TAKE_VERSION,
    tracks: {
      screen: { file: FILES.screen, start },
      ...(has.webcam && { webcam: { file: FILES.webcam, start } }),
      ...(has.mic && { mic: { file: FILES.mic, start } }),
      ...(has.system && { system: { file: FILES.system, start } }),
    },
  };
  await writeFile(join(dir, FILES.take), `${JSON.stringify(take, null, 2)}\n`);
  await writeFile(manifest, `${JSON.stringify({ ...parsed.segments, segments, joined: true }, null, 2)}\n`);
  // the pieces, also those a resume started but the manifest never listed (a crash): their files go;
  // one that cannot be removed now (held) is left, the take is joined all the same
  const pieces = (await readdir(dir).catch(() => [] as string[])).filter((name) => /^(screen|webcam|mic|system)\.\d+\.(mp4|m4a)$/.test(name));
  for (const name of [...pieces, 'segments.txt']) await rm(join(dir, name), { force: true }).catch(() => {});
  repaired.push(`joined the ${segments.length} segments of the paused take`);
}

/** The track start times in a take.json that fails the schema but is still JSON. */
function readableStarts(text: string | undefined): Partial<Record<'screen' | 'webcam' | 'mic' | 'system', number>> {
  try {
    const tracks = (JSON.parse(text ?? '') as { tracks?: Record<string, { start?: unknown } | undefined> }).tracks ?? {};
    const starts: Partial<Record<'screen' | 'webcam' | 'mic' | 'system', number>> = {};
    for (const track of ['screen', 'webcam', 'mic', 'system'] as const) {
      const start = tracks[track]?.start;
      if (typeof start === 'number' && Number.isFinite(start) && start >= 0) starts[track] = start;
    }
    return starts;
  } catch {
    return {};
  }
}
