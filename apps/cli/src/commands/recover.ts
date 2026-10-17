import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, parseEventsJsonl, parseMarkersJson, parseTakeJson, type TakeFile } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, readProjectFile, writeProjectFile } from '../project-file';
import { streamSeconds } from '../suggest/media';
import { useTake } from '../use-take';

export interface RecoverResult {
  project: string;
  /** The take folder, relative to the project. */
  take: string;
  seconds: number;
  tracks: string[];
  /** What was repaired, for people; empty when the take was fine. */
  repaired: string[];
  backup?: string;
}

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

/**
 * `cuttle recover <take>`: makes a take usable after a crash (the recorder's fragmented MP4s stay
 * readable up to their last fragment): checks every track, drops a cut-off events.jsonl line, writes
 * markers.json and take.json when they are missing or broken, and points the project at the take.
 */
export async function recoverCommand(projectDir: string, takeDir: string, output: Output): Promise<RecoverResult> {
  const project = resolve(projectDir);
  const dir = resolve(project, takeDir);
  const rel = relative(project, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new CliError('usage', `the take ${dir} must be a folder inside the project ${project}`);
  const path = (file: string) => join(dir, file);
  const source = (file: string) => `${rel.split(sep).join('/')}/${file}`;
  const repaired: string[] = [];

  const seconds = await streamSeconds(path(FILES.screen), 'v');
  if (seconds <= 0) throw new CliError('invalid-media', `${path(FILES.screen)} is missing or has no readable video; nothing to recover`);
  const webcam = existsSync(path(FILES.webcam)) && (await streamSeconds(path(FILES.webcam), 'v')) > 0;
  const mic = existsSync(path(FILES.mic)) && (await streamSeconds(path(FILES.mic), 'a')) > 0;
  for (const [ok, file] of [[webcam, FILES.webcam], [mic, FILES.mic]] as const) {
    if (!ok && existsSync(path(file))) repaired.push(`left out ${file}: it has nothing readable`);
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
      await copyFile(path(FILES.events), `${path(FILES.events)}.bak`);
      await writeFile(path(FILES.events), kept.map((line) => `${line}\n`).join(''));
      repaired.push(`events.jsonl: kept ${kept.length} events, dropped ${lines.length - kept.length} broken or cut-off line(s) (old file: events.jsonl.bak)`);
    }
  } else {
    await writeFile(path(FILES.events), '');
    repaired.push('events.jsonl was missing: written empty (no cursor, clicks or keys)');
  }

  const markersText = existsSync(path(FILES.markers)) ? await readFile(path(FILES.markers), 'utf8') : undefined;
  if (markersText === undefined || !parseMarkersJson(markersText).ok) {
    if (markersText !== undefined) await copyFile(path(FILES.markers), `${path(FILES.markers)}.bak`);
    await writeFile(path(FILES.markers), `${JSON.stringify({ version: MARKERS_VERSION, markers: [] }, null, 2)}\n`);
    repaired.push(markersText === undefined ? 'markers.json was missing: written empty' : 'markers.json was broken: written empty (old file: markers.json.bak)');
  }

  const takeText = existsSync(path(FILES.take)) ? await readFile(path(FILES.take), 'utf8') : undefined;
  const parsed = takeText === undefined ? undefined : parseTakeJson(takeText);
  if (!parsed?.ok) {
    // The start times were lost with the crash: the tracks are taken to start together.
    const take: TakeFile = {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: 0 },
        ...(webcam && { webcam: { file: FILES.webcam, start: 0 } }),
        ...(mic && { mic: { file: FILES.mic, start: 0 } }),
      },
    };
    await writeFile(path(FILES.take), `${JSON.stringify(take, null, 2)}\n`);
    repaired.push(
      `take.json was ${takeText === undefined ? 'missing' : 'broken'}: written with the tracks starting together${webcam || mic ? ' (webcam and mic may be off by up to a second)' : ''}`,
    );
  }

  const file = projectExists(project) ? await readProjectFile(project) : await writeProjectFile(newProjectFile(project));
  const backup = await useTake(file, {
    screen: source(FILES.screen),
    ...(webcam && { webcam: source(FILES.webcam) }),
    ...(mic && { mic: source(FILES.mic) }),
    events: source(FILES.events),
    markers: source(FILES.markers),
    seconds,
  });
  await writeProjectFile(file);
  const result: RecoverResult = {
    project: file.path,
    take: rel.split(sep).join('/'),
    seconds,
    tracks: ['screen', ...(webcam ? ['webcam'] : []), ...(mic ? ['mic'] : [])],
    repaired,
    ...(backup && { backup }),
  };
  output.result(result, () =>
    [
      `${result.take}: ${seconds.toFixed(1)} s, tracks: ${result.tracks.join(', ')}`,
      ...(repaired.length > 0 ? repaired.map((note) => `- ${note}`) : ['nothing needed repair']),
      `${file.path} now uses this take${backup ? ` (previous version: ${backup})` : ''}`,
    ].join('\n'),
  );
  return result;
}
