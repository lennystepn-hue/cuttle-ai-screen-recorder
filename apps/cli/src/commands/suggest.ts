import { copyFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen, grabGray } from '../suggest/media';
import { suggestClips } from '../suggest/plan';
import { changedRegion, zoomRect } from '../suggest/region';
import { transcriptMarkers } from '../suggest/transcript';

export interface SuggestArgs {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
  claude?: string | true;
  /** Print the suggestion without writing cuttle.json. */
  dryRun?: boolean;
  /** Zoom on Claude's final answer (default true). */
  zoom?: boolean;
}

export interface SuggestResult {
  project: string;
  scenes: { type: 'clip'; from: number; to: number; speed?: number }[];
  zooms: { at: number; duration: number; rect: Rect }[];
  notes: string[];
  /** Where the markers came from. */
  markers: { from: 'take' | 'transcript' | 'none'; count: number };
  written: boolean;
  /** The previous cuttle.json. */
  backup?: string;
}

/** Grey pictures this wide are compared to find where Claude's answer appeared. */
const COMPARE_WIDTH = 480;
/** The answer is compared with the screen this long before it. */
const ANSWER_LOOKBACK = 6;
const ZOOM_SECONDS = 4;

/**
 * `cuttle suggest`: scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json (scenes and zooms are replaced;
 * the previous file is kept as cuttle.json.bak).
 */
export async function suggestCommand(projectDir: string, args: SuggestArgs, output: Output): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = join(file.dir, sources.screen);
  output.info('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CliError('invalid-media', `${screen} has no video frames`);
  const events = sources.events ? await readEvents(join(file.dir, sources.events)) : [];
  let markers = sources.markers ? await readMarkers(join(file.dir, sources.markers)) : [];
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some((marker) => marker.kind !== 'manual')) {
    const start = await screenStart(dirname(screen));
    const found = await transcriptMarkers(args.claude === true ? process.cwd() : resolve(args.claude), start, screenInfo.duration);
    if (found.length > 0) {
      markers = [...markers, ...found].sort((a, b) => a.t - b.t);
      from = 'transcript';
    }
  }

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still });
  const scenes = suggestion.clips.map(({ from: start, to, speed }) => ({ type: 'clip' as const, from: start, to, ...(speed !== 1 && { speed }) }));
  const zooms: SuggestResult['zooms'] = [];
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  if (args.zoom !== false && suggestion.answer !== undefined && first && last) {
    const [before, after] = await Promise.all([
      grabGray(screen, Math.max(first.from, suggestion.answer - ANSWER_LOOKBACK), COMPARE_WIDTH),
      grabGray(screen, Math.min(screenInfo.duration - 0.05, suggestion.answer + 0.3), COMPARE_WIDTH),
    ]);
    const region = changedRegion(before, after);
    const rect = region && zoomRect(region, COMPARE_WIDTH, screenInfo);
    const at = Math.max(first.from, suggestion.answer - 0.5);
    const duration = Math.min(ZOOM_SECONDS, last.to - at);
    if (rect && duration > 0.5) {
      zooms.push({ at: Math.round(at * 1000) / 1000, duration: Math.round(duration * 1000) / 1000, rect });
      suggestion.notes.push(`zoom on Claude's answer at ${at.toFixed(1)} s (${rect.join(', ')})`);
    } else {
      suggestion.notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }

  let backup: string | undefined;
  if (!args.dryRun) {
    backup = `${file.path}.bak`;
    await copyFile(file.path, backup);
    file.raw.scenes = scenes;
    file.raw.zooms = zooms;
    await writeProjectFile(file);
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms,
    notes: suggestion.notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
    ...(backup && { backup }),
  };
  output.result(result, () => {
    const seconds = scenes.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...suggestion.notes.map((note) => `- ${note}`),
      `${scenes.length} scene(s), about ${seconds.toFixed(1)} s${zooms.length > 0 ? `, ${zooms.length} zoom` : ''}`,
      args.dryRun ? '(dry run: cuttle.json unchanged)' : `written to ${file.path} (previous version: ${backup})`,
      'next: cuttle preview --sheet',
    ].join('\n');
  });
  return result;
}

async function readEvents(path: string): Promise<InputEvent[]> {
  const text = await readFile(path, 'utf8').catch(() => '');
  return parseEventsJsonl(text).events;
}

async function readMarkers(path: string): Promise<Marker[]> {
  const parsed = parseMarkersJson(await readFile(path, 'utf8').catch(() => ''));
  return parsed.ok ? parsed.markers : [];
}

/** The screen track's start (wall-clock seconds) from the take.json next to it. */
async function screenStart(takeDir: string): Promise<number> {
  const path = join(takeDir, 'take.json');
  const parsed = parseTakeJson(await readFile(path, 'utf8').catch(() => ''));
  if (!parsed.ok) throw new CliError('usage', `--claude needs the take's start time from ${path}, which is missing or invalid`);
  return parsed.take.tracks.screen.start;
}
