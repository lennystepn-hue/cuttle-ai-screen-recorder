import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, parseProjectJson, parseTakeJson, parseTranscriptJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile, type TranscriptWord, speaks } from '@cuttle/project';
import { shortcutsOf, type Shortcut } from '@cuttle/timeline';
import { ExportError } from '../errors';
import { loadNarration, type NarrationLine } from './narration';
import type { MotionPages } from '../job';
import type { TakeInputs } from '../motion/take';

/** cuttle.json inside the project folder. */
export const PROJECT_FILE = 'cuttle.json';
/** take.json next to the screen track. */
export const TAKE_FILE = 'take.json';

/** The project's files resolved and checked, ready for an export. */
export interface ProjectSources {
  project: CuttleProject;
  /** The screen recording; absent in a project without clips (motion, stills and cards only), which needs no take. */
  screen?: string;
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  /** What the computer played (`sources.system`), while `look.audio.system` is on. */
  system?: { path: string; offset: number };
  /** The narration's enabled lines as rendered (`cuttle voice render`), while the audio is on. */
  narration?: NarrationLine[];
  events?: InputEvent[];
  /** The take's key counts, for the typing sounds (loaded whether the cursor shows or not). */
  keys?: InputEvent[];
  /** The take's shortcuts, for their badges (`look.keys`). */
  shortcuts?: Shortcut[];
  /** The take's transcript (source seconds), for captions and subtitle files. */
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** The watermark's image, when it is on: its own, else the brand's logo. */
  watermarkImage?: string;
  /** The motion items' pages, when the project has any, and the take as they see it. */
  motion?: MotionPages;
  motionTake?: TakeInputs;
  /** Every file the project names (cuttle.json and take.json included): the output must not replace one. */
  inputs: string[];
  /** Things the export goes on without, but the user should know (e.g. a take.json that does not apply). */
  warnings: string[];
}

/** At most this many issues are listed; a file broken on every line would otherwise make a huge message. */
const MAX_ISSUES = 20;

const issuesText = (issues: readonly { path: string; message: string }[]): string =>
  [
    ...issues.slice(0, MAX_ISSUES).map((issue) => `  ${issue.path}: ${issue.message}`),
    ...(issues.length > MAX_ISSUES ? [`  … and ${issues.length - MAX_ISSUES} more`] : []),
  ].join('\n');

/** Whether two absolute paths name the same file, by the rules of this platform's usual file system. */
export function samePath(a: string, b: string): boolean {
  const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
  return caseInsensitive ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}

/**
 * Absolute path of a project file that exists. Media must not be empty (a recorder killed at once
 * leaves 0 bytes); an empty events.jsonl is fine (no input events).
 */
async function existing(projectDir: string, relative: string, what: string, media = true): Promise<string> {
  const path = resolve(projectDir, relative);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch {
    throw new ExportError('missing-file', `${what} not found: ${path}`);
  }
  if (!info.isFile()) throw new ExportError('missing-file', `${what} is a folder, not a file: ${path}`);
  if (media && info.size === 0) throw new ExportError('invalid-media', `${what} is empty (0 bytes): ${path}`);
  return path;
}

/**
 * The pages of the project's motion scenes and overlays, checked: each a file inside the project
 * folder (the only files a page may read). Undefined when the project has none.
 */
export async function motionPages(projectDir: string, project: CuttleProject): Promise<MotionPages | undefined> {
  const root = resolve(projectDir);
  const pages: MotionPages = { root, scenes: {}, overlays: {}, transitions: {} };
  const page = async (src: string, name: string): Promise<string> => {
    const rel = relative(root, resolve(root, src));
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new ExportError('invalid-project', `${name}.src must be a file in the project folder, not ${src}`);
    }
    return existing(root, src, `page of ${name}`);
  };
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'motion') pages.scenes[index] = await page(scene.src, `scenes[${index}]`);
    if (scene.transition?.enabled) pages.transitions[index] = await page(scene.transition.src, `scenes[${index}].transition`);
  }
  for (const [index, overlay] of project.overlays.entries()) pages.overlays[index] = await page(overlay.src, `overlays[${index}]`);
  const count = Object.keys(pages.scenes).length + Object.keys(pages.overlays).length + Object.keys(pages.transitions).length;
  return count > 0 ? pages : undefined;
}

/**
 * The take as motion pages see it: all its input events (whether the cursor shows or not), its words
 * and Claude's markers. A file that is missing or does not read leaves its list empty: a page that
 * follows the take shows nothing there, the video still renders.
 */
export async function motionTake(projectDir: string, project: CuttleProject): Promise<TakeInputs> {
  const read = async (path: string | undefined) => (path === undefined ? undefined : readFile(resolve(projectDir, path), 'utf8').catch(() => undefined));
  const [events, transcript, markers] = await Promise.all([read(project.sources.events), read(project.sources.transcript), read(project.sources.markers)]);
  const words = transcript === undefined ? undefined : parseTranscriptJson(transcript);
  const marks = markers === undefined ? undefined : parseMarkersJson(markers);
  return {
    events: events === undefined ? [] : parseEventsJsonl(events).events,
    words: words?.ok ? words.transcript.words : [],
    markers: marks?.ok ? marks.markers : [],
  };
}

async function readTake(screen: string): Promise<{ path: string; take?: TakeFile; warning?: string } | undefined> {
  const path = join(dirname(screen), TAKE_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    // No take.json: the tracks are taken as already lined up. Any other error (a lock, no
    // permission) must not silently drop the sync.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ExportError('missing-file', `cannot read ${path}: ${(error as Error).message}`);
  }
  const result = parseTakeJson(text);
  if (!result.ok) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(result.issues)}`);
  // A take.json of another recording (its screen entry names a different file) says nothing about these tracks.
  const described = result.take.tracks.screen.file;
  if (!samePath(resolve(dirname(screen), described), screen)) {
    return { path, warning: `${path} describes another screen recording (${described}); webcam and mic are taken as lined up` };
  }
  return { path, take: result.take };
}

/** Offset of a track from take.json, only when take.json describes that very file. */
function offsetFor(take: TakeFile | undefined, track: 'webcam' | 'mic' | 'system', path: string, screen: string): number {
  const entry = take?.tracks[track];
  if (!take || !entry || !samePath(resolve(dirname(screen), entry.file), path)) return 0;
  return trackOffset(take, track) ?? 0;
}

/**
 * Reads and validates cuttle.json, take.json and events.jsonl and checks that every file the
 * export reads exists. Sources that the look switches off are left out. The narration's lines must
 * all be spoken (`cuttle voice render`), unless `narration` is `spoken`: then those not yet are left out.
 */
export async function loadSources(projectDir: string, options: { narration?: 'whole' | 'spoken' } = {}): Promise<ProjectSources> {
  const projectPath = join(projectDir, PROJECT_FILE);
  let text: string;
  try {
    text = await readFile(projectPath, 'utf8');
  } catch {
    throw new ExportError('missing-file', `no ${PROJECT_FILE} in ${projectDir}`);
  }
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new ExportError('invalid-project', `${projectPath} is invalid:\n${issuesText(parsed.issues)}`);
  const project = parsed.project;
  if (project.scenes.length === 0) throw new ExportError('invalid-project', `${projectPath} has no scenes`);
  const { look, sources } = project;

  // A video of motion scenes, stills and cards shows nothing of a take: it needs no recording.
  const clips = project.scenes.some((scene) => scene.type === 'clip');
  const screen = clips ? await existing(projectDir, sources.screen, 'screen recording (sources.screen)') : undefined;
  const takeFile = screen ? await readTake(screen) : undefined;
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.screen, sources.webcam, sources.mic, sources.system, sources.cleanMic, sources.events, sources.markers, sources.transcript, look.background.image, look.watermark.image, project.theme.logo].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), ...(screen ? [join(dirname(screen), TAKE_FILE)] : []), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, ...(screen && { screen }), stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };

  if (screen && look.webcam.enabled && sources.webcam) {
    const path = await existing(projectDir, sources.webcam, 'webcam recording (sources.webcam)');
    result.webcam = { path, offset: offsetFor(take, 'webcam', path, screen) };
  }
  if (screen && look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    // the cleaned-up mic plays in its place, in step with it (take.json describes the mic itself)
    const clean = look.audio.cleanup && sources.cleanMic ? await existing(projectDir, sources.cleanMic, 'cleaned-up mic (sources.cleanMic)') : undefined;
    result.mic = { path: clean ?? path, offset: offsetFor(take, 'mic', path, screen) };
  }
  if (look.audio.enabled && project.voiceover.lines.some(speaks)) {
    // stills show the words of the lines spoken so far; a video needs every line
    result.narration = await loadNarration(projectDir, project, options.narration === 'spoken');
    result.inputs.push(...result.narration.map((line) => line.sound), ...project.voiceover.lines.flatMap((line) => (line.file === undefined ? [] : [resolve(projectDir, line.file)])));
  }
  if (screen && look.audio.enabled && look.audio.system && sources.system) {
    const path = await existing(projectDir, sources.system, "the computer's sound (sources.system)");
    result.system = { path, offset: offsetFor(take, 'system', path, screen) };
  }
  const typing = look.audio.enabled && look.audio.typing;
  if (screen && (look.cursor.enabled || typing || look.keys.enabled) && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    // the page draws the cursor from them only while it shows
    if (look.cursor.enabled) result.events = events.events;
    if (typing) result.keys = events.events.filter((event) => event.type === 'keys');
    const shortcuts = look.keys.enabled ? shortcutsOf(events.events) : [];
    if (shortcuts.length > 0) result.shortcuts = shortcuts;
  }
  if (sources.transcript) {
    // without it the video has no captions: worth a warning, not a failed export
    const path = resolve(projectDir, sources.transcript);
    const text = await readFile(path, 'utf8').catch(() => undefined);
    const parsed = text === undefined ? undefined : parseTranscriptJson(text);
    if (parsed?.ok) result.transcript = parsed.transcript.words;
    else result.warnings.push(`${sources.transcript} ${parsed ? 'is invalid' : 'cannot be read'}: no captions`);
  }
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type !== 'still') continue;
    result.stills[index] = await existing(projectDir, scene.image, `image of scene ${index}`);
    result.inputs.push(result.stills[index]);
  }
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
  }
  const mark = look.watermark.enabled ? (look.watermark.image ?? project.theme.logo) : undefined;
  if (mark) result.watermarkImage = await existing(projectDir, mark, look.watermark.image ? 'watermark image (look.watermark.image)' : 'the brand logo (theme.logo), shown as the watermark');
  const motion = await motionPages(projectDir, project);
  if (motion) {
    result.motion = motion;
    result.motionTake = await motionTake(projectDir, project);
    result.inputs.push(...Object.values(motion.scenes), ...Object.values(motion.overlays));
  }
  return result;
}
