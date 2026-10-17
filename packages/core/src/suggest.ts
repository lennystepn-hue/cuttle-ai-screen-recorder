import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { newId, parseEventsJsonl, parseProject, parseTakeJson, usedIds, type InputEvent, type Marker, type Rect, type ScreenTextFrame, type TranscriptFile } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks } from '@cuttle/timeline';
import { CoreError } from './errors';
import { readProjectFile, writeProjectFile } from './project-file';
import { areaStretches, bandCrop, cropPieces, type CropStretch } from './suggest/crop';
import { dialogZooms } from './suggest/dialogs';
import { readScreenText, withPrivacyMasks, type RawMask } from './privacy/apply';
import { SCREEN_TEXT_FILE, framesToRead, readFrames, writeScreenText } from './privacy/read';
import { analyseScreen, grabGray, grayFrames, screenBands } from './suggest/media';
import { suggestClips } from './suggest/plan';
import { changedRegion, zoomRect } from './suggest/region';
import { union } from './suggest/spans';
import { screenStretches, typingZooms, type ScreenChange } from './suggest/typing';
import { takeClock, transcriptMarkers } from './suggest/transcript';
import { readMarkers, speechActivity, withSpeechCuts, wordStretches } from './speech/apply';
import type { RawCut } from './speech/edits';
import { chooseModel } from './speech/models';
import { readTranscript, transcribeTake } from './speech/transcribe';
import { hasWhisper, NO_WHISPER } from './speech/whisper';

export interface SuggestOptions {
  /** The folder Claude Code ran in (true: the current folder), for a take without Claude markers. */
  claude?: string | true;
  /** Print the suggestion without writing cuttle.json. */
  dryRun?: boolean;
  /** Zooms at all: on Claude's final answer and on the clicks (default true). */
  zoom?: boolean;
  /** Zooms that follow the clicks (default true; `zoom: false` turns them off too). */
  clickZooms?: boolean;
  /** Zooms that follow typing (default true; `zoom: false` turns them off too). */
  typingZooms?: boolean;
  /** Zooms on dialogs (default true; `zoom: false` turns them off too). */
  dialogZooms?: boolean;
  /** Crops each clip to the content (default true): the window's content area, else the picture's still edges. */
  crop?: boolean;
  /** Masks what the screen showed that is private (default true): its text is read first where it was not yet. */
  privacy?: boolean;
  /** Words to mask wherever the screen shows them (a name, an address), kept in cuttle.json's `privacy.words`. */
  maskWords?: string[];
  /**
   * The mic's speech (default true): it is kept and never sped up, and the transcript's filler words
   * and pauses are cut where the picture rests.
   */
  speech?: boolean;
  /** Transcribe the mic first when it has no transcript and a speech model is downloaded (default true). */
  transcribe?: boolean;
  /** Status for people while it runs. */
  onStatus?: (text: string) => void;
  /** The transcription's progress, 0 to 1. */
  onProgress?: (fraction: number) => void;
}

/** A clip's crop as written to cuttle.json. */
type ClipCrop = { rect: Rect; enabled?: boolean; auto?: 'crop' };
type ClipScene = { type: 'clip'; id: string; label?: string; from: number; to: number; speed?: number; crop?: ClipCrop };

export interface SuggestResult {
  project: string;
  /** The suggested clips, with the project's still and card scenes before (those that were before the first clip) and after them. */
  scenes: (ClipScene | Record<string, unknown>)[];
  /** Every zoom of the file afterwards: those kept (made by hand) and the new automatic ones, by start. */
  zooms: SuggestedZoom[];
  /** Every cut of the file afterwards, when the speech edits were made (a transcript was there). */
  cuts?: RawCut[];
  /** Where the speech came from: the transcript, the mic's loudness, or none; and the cuts made for it. */
  speech: { from: 'transcript' | 'mic' | 'none'; fillers: number; pauses: number; retakes: number };
  /** Whether the screen's text was there to mask from, and how many privacy and notification masks were made. */
  privacy: { read: boolean; masks: number; notifications: number };
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
/** Typing is read at this rate and width: typed letters are a few pixels at this size. */
const TYPING_RATE = 2;
const TYPING_WIDTH = 640;
/** A change of fewer pixels is noise. */
const TYPING_MIN_PIXELS = 8;

/**
 * Suggests scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up), a zoom on Claude's answer and zooms on clicks, written to cuttle.json. The clip scenes
 * are replaced; still and card scenes keep their place before or after the clips; masks, texts and
 * cuts stay. Of the zooms, only those suggest made before (tagged `auto`: "answer" or "click")
 * are replaced: zooms without a tag (made or changed by hand) stay, and the new ones keep clear of
 * them. A kind switched off in `autoEdits` is not made; a new zoom where one of its kind was
 * switched off stays off. The previous file is kept as cuttle.json.bak. The new clips and zooms get
 * ids no kept item uses and labels from Claude's markers.
 */
export async function suggestProject(projectDir: string, args: SuggestOptions = {}): Promise<SuggestResult> {
  const notes: string[] = [];
  if (args.speech !== false && args.transcribe !== false && !args.dryRun) await transcribeFirst(projectDir, args, notes);
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  const screen = resolve(file.dir, sources.screen);
  args.onStatus?.('reading the screen recording …');
  const screenInfo = await analyseScreen(screen);
  if (screenInfo.duration <= 0) throw new CoreError('invalid-media', `${screen} has no video frames`);
  let transcript: TranscriptFile | undefined;
  let speech: { spans: { from: number; to: number }[]; from: SuggestResult['speech']['from'] } = { spans: [], from: 'none' };
  if (args.speech !== false) {
    const read = await readTranscript(file.dir, sources.transcript);
    if (read.note) notes.push(read.note);
    transcript = read.transcript;
    speech = await speechActivity(file.dir, sources, transcript);
    if (speech.from === 'mic' && speech.spans.length > 0) notes.push(`speech (${speech.spans.length} stretches, from the mic's loudness) is kept and never sped up`);
  }
  let events: InputEvent[] = [];
  if (sources.events) {
    const read = await readEvents(resolve(file.dir, sources.events));
    if (read === undefined) notes.push(`${sources.events} cannot be read: only screen changes and markers count as activity`);
    else events = read;
  }
  let markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  let from: SuggestResult['markers']['from'] = markers.length > 0 ? 'take' : 'none';
  if (args.claude !== undefined && !markers.some(fromClaude)) {
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

  const suggestion = suggestClips({ duration: screenInfo.duration, events, markers, still: screenInfo.still, speech: speech.spans });
  notes.push(...suggestion.notes);
  // Page captures and cards stay where they were: before the first clip (a title card) or after it.
  const previous = (file.raw.scenes as Record<string, unknown>[] | undefined) ?? [];
  const firstClip = previous.findIndex((scene) => scene.type === 'clip');
  const before = firstClip < 0 ? [] : previous.slice(0, firstClip).filter((scene) => scene.type !== 'clip');
  const after = previous.slice(Math.max(0, firstClip)).filter((scene) => scene.type !== 'clip');
  // Every id of the file as read, also those of the clips and zoom being replaced: an id that an
  // editor or an undo step still holds must never name a different item.
  const taken = usedIds(file.raw);
  // The crop: what each clip shows of the screen; a clip is cut where the content area changes for good.
  const crops = args.crop !== false && file.project.autoEdits.crop ? await cropsFor(screen, events, screenInfo, previous, notes) : undefined;
  const pieces = crops ? cropPieces(suggestion.clips, crops.stretches) : suggestion.clips.map((clip) => ({ clip, from: clip.from, to: clip.to }));
  const clips: ClipScene[] = pieces.map(({ clip: { speed, label }, from: start, to, ...piece }) => {
    const rect = (piece as { rect?: Rect }).rect;
    const crop = rect ? crops?.crop(rect, start, to) : crops?.kept(start, to);
    return {
      type: 'clip',
      id: newId('scenes', taken),
      ...(label !== undefined && { label }),
      from: start,
      to,
      ...(speed !== 1 && { speed }),
      ...(crop && { crop }),
    };
  });
  if (before.length + after.length > 0) {
    notes.push(`kept ${before.length + after.length} still or card scene(s)${before.length > 0 ? `, ${before.length} before the clips` : ''}`);
  }
  const scenes = [...before, ...clips, ...after];
  // The retakes, then the filler words and pauses inside the new 1× clips, where the picture rests.
  let cuts: RawCut[] | undefined;
  let made = { fillers: 0, pauses: 0, retakes: 0 };
  const hasRetakes = markers.some((marker) => marker.kind === 'retake') || ((file.raw.cuts as RawCut[] | undefined) ?? []).some((cut) => cut.auto === 'retake');
  // the mistake key's retakes are cut even with the speech left out (then 5 s back)
  if (transcript || hasRetakes) {
    // the pauses before a slip: between the words, or between the mic's loud stretches
    const pauses = transcript ? wordStretches(transcript) : speech.from === 'mic' ? speech.spans : [];
    const clips = suggestion.clips.map(({ from: start, to, speed }) => ({ from: start, to, speed }));
    const result = withSpeechCuts(file.raw, file.project, { ...(transcript && { transcript }), markers, speech: pauses, still: screenInfo.still, events, clips }, taken);
    notes.push(...result.notes);
    cuts = result.cuts;
    made = { fillers: result.fillers, pauses: result.pauses, retakes: result.retakes };
  }
  // The zooms suggest made before are replaced; the others stay, and the new ones avoid them.
  const rawZooms = (file.raw.zooms as SuggestedZoom[] | undefined) ?? [];
  const isOurs = (zoom: { auto?: string }) => zoom.auto === 'answer' || zoom.auto === 'dialog' || zoom.auto === 'typing' || zoom.auto === 'click';
  const kept = rawZooms.filter((zoom) => !isOurs(zoom));
  const switchedOff = file.project.zooms.filter((zoom) => isOurs(zoom) && !zoom.enabled);
  if (kept.length > 0) notes.push(`kept ${kept.length} zoom${kept.length === 1 ? '' : 's'} made or changed by hand`);
  const zooms: SuggestedZoom[] = [];
  const add = (zoom: SuggestedZoom & { auto: 'answer' | 'dialog' | 'typing' | 'click' }) => zooms.push(staysOff(zoom, switchedOff) ? { ...zoom, enabled: false } : zoom);
  const first = suggestion.clips[0];
  const last = suggestion.clips.at(-1);
  const keptOverlaps = (at: number, end: number) => kept.some((zoom) => at < zoom.at + zoom.duration && zoom.at < end);
  if (args.zoom !== false && file.project.autoEdits.answerZoom && suggestion.answer !== undefined && first && last) {
    const [before, after] = await Promise.all([
      grabGray(screen, Math.max(first.from, suggestion.answer - ANSWER_LOOKBACK), COMPARE_WIDTH),
      grabGray(screen, Math.min(screenInfo.duration - 0.05, suggestion.answer + 0.3), COMPARE_WIDTH),
    ]);
    const region = changedRegion(before, after);
    const rect = region && zoomRect(region, COMPARE_WIDTH, screenInfo);
    const at = Math.max(first.from, suggestion.answer - 0.5);
    const duration = Math.min(ZOOM_SECONDS, last.to - at);
    if (rect && duration > 0.5 && keptOverlaps(at, at + duration)) {
      notes.push('no zoom on the answer: a zoom made by hand is there');
    } else if (rect && duration > 0.5) {
      add({ id: newId('zooms', taken), label: 'Answer', at: Math.round(at * 1000) / 1000, duration: Math.round(duration * 1000) / 1000, rect, auto: 'answer' });
      notes.push(`zoom on Claude's answer at ${at.toFixed(1)} s (${rect.join(', ')})`);
    } else {
      notes.push(region ? 'no zoom: most of the screen changed with the answer (add one by hand)' : 'no zoom: nothing changed around the answer');
    }
  }
  // where each clip piece starts in the output, with the cards and pages around the clips and the cuts counted
  const parsed = parseProject({ ...file.raw, scenes, ...(cuts && { cuts }), zooms: [] });
  const spans = parsed.ok ? sceneSpans(parsed.project.scenes, parsed.project.cuts) : [];
  const shown = spans.flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  if (args.zoom !== false && args.dialogZooms !== false && file.project.autoEdits.dialogZooms && events.some((event) => event.type === 'window')) {
    const opened = dialogZooms(events, shown, screenInfo, [...kept, ...zooms]);
    for (const zoom of opened) add({ id: newId('zooms', taken), label: 'Dialog', at: zoom.at, duration: zoom.duration, rect: zoom.rect, auto: 'dialog' });
    if (opened.length > 0) notes.push(`${opened.length} zoom${opened.length === 1 ? '' : 's'} on a dialog`);
  }
  if (args.zoom !== false && args.typingZooms !== false && file.project.autoEdits.typingZooms && events.some((event) => event.type === 'keys')) {
    // where the text goes: the caret, else what the screen changes while keys are typed
    const changes = await typingChanges(screen, screenStretches(events, shown, screenInfo), screenInfo);
    const typed = typingZooms({ events, clips: shown, screen: screenInfo, avoid: [...kept, ...zooms], changes });
    for (const zoom of typed) {
      add({ id: newId('zooms', taken), label: 'Typing', at: zoom.at, duration: zoom.duration, rect: zoom.rect, ...(zoom.moves.length > 0 && { moves: zoom.moves }), auto: 'typing' });
    }
    if (typed.length > 0) {
      const moves = typed.reduce((sum, zoom) => sum + zoom.moves.length, 0);
      const caret = typed.filter((zoom) => zoom.follows === 'caret').length;
      notes.push(
        `${typed.length} zoom${typed.length === 1 ? '' : 's'} while typing, ${moves} move${moves === 1 ? '' : 's'} following the text (${caret === typed.length ? 'the caret' : caret === 0 ? 'what the screen changed' : `the caret in ${caret}, the screen in the others`})`,
      );
    }
  }
  if (args.zoom !== false && args.clickZooms !== false && file.project.autoEdits.clickZooms && events.length > 0) {
    const there = [...kept, ...zooms];
    const followed = clickZooms(events, shown, screenInfo, there);
    // the clicks the zooms there do not show, less those the click zooms follow
    const left = shownClicks(events, shown, there) - followed.reduce((sum, zoom) => sum + zoom.clicks, 0);
    for (const zoom of followed) {
      add({ id: newId('zooms', taken), label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect, ...(zoom.moves && { moves: zoom.moves }), auto: 'click' });
    }
    if (followed.length > 0) notes.push(`${followed.length} zoom${followed.length === 1 ? '' : 's'} on clicks`);
    if (left > 0) notes.push(`${left} click${left === 1 ? '' : 's'} got no zoom: sped up, or near a cut or another zoom`);
  }

  // The privacy masks: what the screen showed that is private, from its text (read inside the new
  // clips where it was not yet) and the person's words; and the notifications while they were open.
  const words = [...new Set([...file.project.privacy.words, ...(args.maskWords ?? []).map((word) => word.trim()).filter(Boolean)])];
  let masks: RawMask[] | undefined;
  let privacy = { read: false, masks: 0, notifications: 0 };
  if (args.privacy !== false && file.project.autoEdits.privacy) {
    const text = await screenTextFor(file.dir, screen, sources.screenText, clips, screenInfo, args, notes);
    const result = withPrivacyMasks(file.raw, file.project, { ...(text && { frames: text.frames }), events, screen: screenInfo, words }, taken);
    notes.push(...result.notes);
    masks = result.masks;
    privacy = { read: text !== undefined, masks: result.made, notifications: result.notifications };
    if (text?.made) file.raw.sources = { ...(file.raw.sources as object), screenText: text.made };
  }

  const allZooms = [...kept, ...zooms].sort((a, b) => a.at - b.at);
  let backup: string | undefined;
  if (!args.dryRun) {
    file.raw.scenes = scenes;
    file.raw.zooms = allZooms;
    if (cuts && (cuts.length > 0 || file.raw.cuts !== undefined)) file.raw.cuts = cuts;
    if (masks) file.raw.masks = masks;
    if (words.length > file.project.privacy.words.length) file.raw.privacy = { ...(file.raw.privacy as object), words };
    ({ backup } = await writeProjectFile(file, 'suggest', { backup: true }));
  }
  const result: SuggestResult = {
    project: file.path,
    scenes,
    zooms: allZooms,
    ...(cuts && { cuts }),
    speech: { from: speech.from, ...made },
    privacy,
    notes,
    markers: { from, count: markers.length },
    written: !args.dryRun,
    ...(backup && { backup }),
  };
  return result;
}

/**
 * The screen's text: what was read before (`sources.screenText`), else read now inside `clips`
 * (not in a dry run) and written next to the screen track, which `made` names. Says why not where it
 * cannot be read: the masks from text are then left as they are.
 */
async function screenTextFor(
  dir: string,
  screen: string,
  linked: string | undefined,
  clips: readonly { from: number; to: number }[],
  size: { width: number; height: number },
  args: SuggestOptions,
  notes: string[],
): Promise<{ frames: ScreenTextFrame[]; made?: string } | undefined> {
  if (linked) {
    const frames = await readScreenText(resolve(dir, linked));
    if (frames) return { frames };
    notes.push(`${linked} cannot be read: it is read again`);
  }
  if (args.dryRun) {
    notes.push("the screen's text was not read (a dry run): no privacy masks from it");
    return undefined;
  }
  try {
    args.onStatus?.('reading the screen …');
    const spans = union(clips.map(({ from: start, to }) => ({ from: start, to })));
    const times = await framesToRead(screen, spans, size);
    let shown = 0;
    const { frames, language } = await readFrames(screen, times, size, {
      onProgress: (fraction) => {
        const percent = Math.floor(fraction * 10) * 10;
        if (percent > shown) args.onStatus?.(`reading the screen … ${(shown = percent)} %`);
      },
    });
    const path = join(dirname(screen), SCREEN_TEXT_FILE);
    writeScreenText(path, frames);
    notes.push(`read the screen's text in ${frames.length} frame${frames.length === 1 ? '' : 's'} (${language}), into ${relative(dir, path).split(sep).join('/')}`);
    return { frames, made: relative(dir, path).split(sep).join('/') };
  } catch (error) {
    if (!(error instanceof CoreError) || error.code !== 'ocr-missing') throw error;
    notes.push(`the screen's text was not read: ${error.message}; no privacy masks from it, so look for private things yourself`);
    return undefined;
  }
}

/**
 * Transcribes the mic before the cut when the take has one, it has no transcript yet, and a speech
 * model is downloaded; says why not otherwise. A failed transcription is noted, not thrown: the
 * cut goes on without the speech edits.
 */
async function transcribeFirst(projectDir: string, args: SuggestOptions, notes: string[]): Promise<void> {
  const { project } = await readProjectFile(projectDir);
  if (project.sources.mic === undefined || project.sources.transcript !== undefined) return;
  if ((await chooseModel()) === undefined) {
    notes.push('the mic was not transcribed: no speech model is downloaded ("cuttle models download small"), so filler words and pauses stay');
    return;
  }
  if (!(await hasWhisper())) {
    notes.push(`the mic was not transcribed: ${NO_WHISPER}`);
    return;
  }
  try {
    const done = await transcribeTake(projectDir, { ...(args.onStatus && { onStatus: args.onStatus }), ...(args.onProgress && { onProgress: args.onProgress }) });
    notes.push(`transcribed the mic with the ${done.model} model: ${done.words} words (${done.language}), in ${done.transcript}`, ...done.notes);
  } catch (error) {
    if (error instanceof CoreError && (error.code === 'cancelled' || error.code === 'conflict' || error.code === 'ffmpeg-missing')) throw error;
    notes.push(`the mic could not be transcribed: ${(error as Error).message.split('\n')[0]}`);
  }
}

/** A zoom as written to cuttle.json (kept ones as they were, with whatever fields they had). */
export interface SuggestedZoom {
  id?: string;
  label?: string;
  at: number;
  duration: number;
  rect: Rect;
  auto?: string;
  enabled?: boolean;
  [field: string]: unknown;
}

/**
 * Whether a new automatic zoom takes the place of one of its kind the person switched off: the
 * same kind, overlapping at least half of the shorter in time, and their rects at least half alike
 * (intersection over union).
 */
function staysOff(zoom: SuggestedZoom, off: readonly { at: number; duration: number; rect: Rect; auto?: string }[]): boolean {
  return off.some((other) => {
    if (other.auto !== zoom.auto) return false;
    const overlap = Math.min(zoom.at + zoom.duration, other.at + other.duration) - Math.max(zoom.at, other.at);
    if (overlap < 0.5 * Math.min(zoom.duration, other.duration)) return false;
    const [ax, ay, aw, ah] = zoom.rect;
    const [bx, by, bw, bh] = other.rect;
    const w = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    const h = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    const inter = w > 0 && h > 0 ? w * h : 0;
    return inter / (aw * ah + bw * bh - inter) >= 0.5;
  });
}

/**
 * The crops of the new clips. From the recorder's content areas where the take has them, else one
 * from the picture's still edges for all clips. A crop the person made on an old clip stays on the
 * new ones it overlaps (and none is made there); one of Cuttle's they switched off stays off.
 */
async function cropsFor(
  screen: string,
  events: readonly InputEvent[],
  screenInfo: { width: number; height: number; duration: number },
  previous: readonly Record<string, unknown>[],
  notes: string[],
): Promise<{ stretches: CropStretch[]; crop: (rect: Rect, from: number, to: number) => ClipCrop | undefined; kept: (from: number, to: number) => ClipCrop | undefined }> {
  type Old = { from: number; to: number; crop: ClipCrop };
  const old = previous.filter((scene): scene is Record<string, unknown> & Old => scene.type === 'clip' && typeof scene.crop === 'object' && scene.crop !== null);
  const over = (from: number, to: number) => old.filter((scene) => scene.from < to && from < scene.to);
  /** A crop made by hand on a clip that showed this stretch. */
  const kept = (from: number, to: number) => over(from, to).find((scene) => scene.crop.auto === undefined)?.crop;
  const crop = (rect: Rect, from: number, to: number): ClipCrop | undefined => {
    const mine = kept(from, to);
    if (mine) return mine;
    const off = over(from, to).some((scene) => scene.crop.auto === 'crop' && scene.crop.enabled === false && alike(scene.crop.rect, rect));
    return { rect, auto: 'crop', ...(off && { enabled: false }) };
  };
  let stretches = areaStretches(events, screenInfo.duration, screenInfo);
  if (stretches.length > 0) {
    const cropped = stretches.filter((stretch) => stretch.rect).length;
    notes.push(cropped > 0 ? `cropped to the window's content area (${cropped} stretch${cropped === 1 ? '' : 'es'}, from the recorder)` : 'no crop: the windows shown had no content area to crop to');
  } else {
    const rect = bandCrop(await screenBands(screen, screenInfo), screenInfo);
    stretches = [{ from: 0, to: screenInfo.duration, ...(rect && { rect }) }];
    notes.push(rect ? `cropped to ${rect.join(', ')}: the screen's edges that hardly change (tabs, bars, a taskbar) are left out` : 'no crop: no still edges around what changes');
  }
  return { stretches, crop, kept };
}

/** Two rects at least half alike (intersection over union). */
function alike(a: Rect, b: Rect): boolean {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter) >= 0.5;
}

/** What the screen changed in each stretch, frame by frame (`TYPING_RATE` a second), in screen pixels. */
async function typingChanges(screen: string, stretches: readonly { from: number; to: number }[], size: { width: number; height: number; duration: number }): Promise<ScreenChange[]> {
  const height = 2 * Math.round((TYPING_WIDTH * size.height) / size.width / 2);
  const scale = size.width / TYPING_WIDTH;
  const changes: ScreenChange[] = [];
  for (const stretch of stretches) {
    const from = Math.max(0, stretch.from);
    const to = Math.min(size.duration, stretch.to);
    if (!(to > from)) continue;
    const frames = await grayFrames(screen, from, to, TYPING_RATE, TYPING_WIDTH, height);
    for (let k = 1; k < frames.length; k++) {
      const box = changedRegion(frames[k - 1]!, frames[k]!, TYPING_MIN_PIXELS);
      if (box) changes.push({ t: frames[k]!.t, box: { x: box.x * scale, y: box.y * scale, width: box.width * scale, height: box.height * scale } });
    }
  }
  return changes;
}

/** A marker Claude Code's session made (not the person's own, nor the mistake key's). */
const fromClaude = (marker: Marker) => marker.kind === 'prompt' || marker.kind === 'tool' || marker.kind === 'answer';

/** The events of events.jsonl; undefined when the file cannot be read. */
async function readEvents(path: string): Promise<InputEvent[] | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : parseEventsJsonl(text).events;
}

/** The screen track's start (wall-clock seconds) from the take.json next to it. */
async function screenStart(takeDir: string): Promise<number> {
  const path = join(takeDir, 'take.json');
  const parsed = parseTakeJson(await readFile(path, 'utf8').catch(() => ''));
  if (!parsed.ok) throw new CoreError('usage', `Claude's markers from the transcript (--claude) need the take's start time from ${path}, which is missing or invalid`);
  return parsed.take.tracks.screen.start;
}
