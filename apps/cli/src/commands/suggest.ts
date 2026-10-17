import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';
import { backupFile, readProjectFile, writeProjectFile } from '../project-file';
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

type ClipScene = { type: 'clip'; from: number; to: number; speed?: number };

export interface SuggestResult {
  project: string;
  /** The suggested clips, then the project's still and card scenes, which are kept at the end. */
  scenes: (ClipScene | Record<string, unknown>)[];
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
 * sped up) and a zoom on Claude's answer, written to cuttle.json. The clip scenes and the zooms are
 * replaced; still and card scenes move to the end, masks and texts stay; the previous file is kept
 * as cuttle.json.bak.
 */
export async function suggestCommand(projectDir: string, args: SuggestArgs, output: Output): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  output.info('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CliError('invalid-media', `${screen} has no video frames`);
  const notes: string[] = [];
  let events: InputEvent[] = [];
  if (sources.events) {
    const read = await readEvents(resolve(file.dir, sources.events));
    if (read === undefined) notes.push(`${sources.events} cannot be read: only screen changes and markers count as activity`);
    else events = read;
  }
  let markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some((marker) => marker.kind !== 'manual')) {
    const cwd = args.claude === true ? process.cwd() : resolve(args.claude);
    const start = await screenStart(dirname(screen));
    const found = await transcriptMarkers(cwd, start, screenInfo.duration);
    if (found.length > 0) {
      markers = [...markers, ...found].sort((a, b) => a.t - b.t);
      from = 'transcript';
    } else {
      notes.push(
        start === 0
          ? "no Claude markers: take.json has no start time (it was rebuilt by recover), so the transcript cannot be matched"
          : `no Claude markers: no Claude Code session in ${cwd} prompted, called a tool or answered during the take`,
      );
    }
  }

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still });
  notes.push(...suggestion.notes);
  const clips: ClipScene[] = suggestion.clips.map(({ from: start, to, speed }) => ({ type: 'clip', from: start, to, ...(speed !== 1 && { speed }) }));
  // A page capture or an end card stays: they do not depend on the take's times.
  const kept = ((file.raw.scenes as Record<string, unknown>[] | undefined) ?? []).filter((scene) => scene.type !== 'clip');
  if (kept.length > 0) notes.push(`kept ${kept.length} still or card scene(s) after the clips`);
  const scenes = [...clips, ...kept];
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
      notes.push(`zoom on Claude's answer at ${at.toFixed(1)} s (${rect.join(', ')})`);
    } else {
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }

  let backup: string | undefined;
  if (!args.dryRun) {
    backup = await backupFile(file.path);
    file.raw.scenes = scenes;
    file.raw.zooms = zooms;
    await writeProjectFile(file);
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
    ...(backup && { backup }),
  };
  output.result(result, () => {
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...notes.map((note) => `- ${note}`),
      `${clips.length} clip(s), about ${seconds.toFixed(1)} s${zooms.length > 0 ? `, ${zooms.length} zoom` : ''}`,
      args.dryRun ? '(dry run: cuttle.json unchanged)' : `written to ${file.path} (previous version: ${backup})`,
      'next: cuttle preview',
    ].join('\n');
  });
  return result;
}

/** The events of events.jsonl; undefined when the file cannot be read. */
async function readEvents(path: string): Promise<InputEvent[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseEventsJsonl(text).events;
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
