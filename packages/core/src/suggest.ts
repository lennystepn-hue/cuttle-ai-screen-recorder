import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { newId, parseEventsJsonl, parseMarkersJson, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect } from '@cuttle/project';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { analyseScreen, grabGray } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { takeClock, transcriptMarkers } from './suggest/transcript';

export interface SuggestOptions {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
  claude?: string | true;
  /** Print the suggestion without writing cuttle.json. */
  dryRun?: boolean;
  /** Zoom on Claude's final answer (default true). */
  zoom?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
}

type ClipScene = { type: 'clip'; id: string; label?: string; from: number; to: number; speed?: number };

export interface SuggestResult {
  project: string;
  /** The suggested clips, with the project's still and card scenes before (those that were before the first clip) and after them. */
  scenes: (ClipScene | Record<string, unknown>)[];
  zooms: { id: string; label: string; at: number; duration: number; rect: Rect }[];
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
 * Suggests scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json. The clip scenes and the zooms are
 * replaced; still and card scenes keep their place before or after the clips, masks and texts stay;
 * the previous file is kept as cuttle.json.bak. The new clips and zoom get ids no kept item uses and
 * labels from Claude's markers.
 */
export async function suggestProject(projectDir: string, args: SuggestOptions = {}): Promise<SuggestResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  args.onStatus?.('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CoreError('invalid-media', `${screen} has no video frames`);
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
    await screenStart(dirname(screen)); // refuses a take without take.json
    const clock = await takeClock(dirname(screen));
    const found = clock ? await transcriptMarkers(cwd, clock, screenInfo.duration) : [];
    if (found.length > 0) {
      markers = [...markers, ...found].sort((a, b) => a.t - b.t);
      from = 'transcript';
    } else {
      notes.push(
        clock === undefined
          ? "no Claude markers: take.json has no start time (it was rebuilt by recover), so the transcript cannot be matched"
          : `no Claude markers: no Claude Code session in ${cwd} prompted, called a tool or answered during the take`,
      );
    }
  }

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still });
  notes.push(...suggestion.notes);
  // Page captures and cards stay where they were: before the first clip (a title card) or after it.
  const previous = (file.raw.scenes as Record<string, unknown>[] | undefined) ?? [];
  const firstClip = previous.findIndex((scene) => scene.type === 'clip');
  const before = firstClip < 0 ? [] : previous.slice(0, firstClip).filter((scene) => scene.type !== 'clip');
  const after = previous.slice(Math.max(0, firstClip)).filter((scene) => scene.type !== 'clip');
  // Every id of the file as read, also those of the clips and zoom being replaced: an id that an
  // editor or an undo step still holds must never name a different item.
  const taken = usedIds(file.raw);
  const clips: ClipScene[] = suggestion.clips.map(({ from: start, to, speed, label }) => ({
    type: 'clip',
    id: newId('scenes', taken),
    ...(label !== undefined && { label }),
    from: start,
    to,
    ...(speed !== 1 && { speed }),
  }));
  if (before.length + after.length > 0) {
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
  const scenes = [...before, ...clips, ...after];
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
      zooms.push({ id: newId('zooms', taken), label: 'Answer', at: Math.round(at * 1000) / 1000, duration: Math.round(duration * 1000) / 1000, rect });
      notes.push(`zoom on Claude's answer at ${at.toFixed(1)} s (${rect.join(', ')})`);
    } else {
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }

  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = zooms;
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
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
  if (!parsed.ok) throw new CoreError('usage', `Claude's markers from the transcript (--claude) need the take's start time from ${path}, which is missing or invalid`);
  return parsed.take.tracks.screen.start;
}
