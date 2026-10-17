import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, parseTranscriptJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile, type TranscriptWord } from '@cuttle/project';
import { ExportError } from '../errors';
import type { MotionPages } from '../job';

/** cuttle.json inside the project folder. */
export const PROJECT_FILE = 'cuttle.json';
/** take.json next to the screen track. */
export const TAKE_FILE = 'take.json';

/** The project's files resolved and checked, ready for an export. */
export interface ProjectSources {
  project: CuttleProject;
  screen: string;
  webcam?: { path: string; offset: number };
  mic?: { path: string; offset: number };
  events?: InputEvent[];
  /** The take's key counts, for the typing sounds (loaded whether the cursor shows or not). */
  keys?: InputEvent[];
  /** The take's transcript (source seconds), for captions and subtitle files. */
  transcript?: TranscriptWord[];
  stills: Record<number, string>;
  backgroundImage?: string;
  /** The motion items' pages, when the project has any. */
  motion?: MotionPages;
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
  const pages: MotionPages = { root, scenes: {}, overlays: {} };
  const page = async (src: string, name: string): Promise<string> => {
    const rel = relative(root, resolve(root, src));
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new ExportError('invalid-project', `${name}.src must be a file in the project folder, not ${src}`);
    }
    return existing(root, src, `page of ${name}`);
  };
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'motion') pages.scenes[index] = await page(scene.src, `scenes[${index}]`);
  }
  for (const [index, overlay] of project.overlays.entries()) pages.overlays[index] = await page(overlay.src, `overlays[${index}]`);
  return Object.keys(pages.scenes).length + Object.keys(pages.overlays).length > 0 ? pages : undefined;
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
function offsetFor(take: TakeFile | undefined, track: 'webcam' | 'mic', path: string, screen: string): number {
  const entry = take?.tracks[track];
  if (!take || !entry || !samePath(resolve(dirname(screen), entry.file), path)) return 0;
  return trackOffset(take, track) ?? 0;
}

/**
 * Reads and validates cuttle.json, take.json and events.jsonl and checks that every file the
 * export reads exists. Sources that the look switches off are left out.
 */
export async function loadSources(projectDir: string): Promise<ProjectSources> {
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

  const screen = await existing(projectDir, sources.screen, 'screen recording (sources.screen)');
  const takeFile = await readTake(screen);
  const take = takeFile?.take;
  // Every file the project names, including sources the look switches off: the output must not
  // replace a recording just because this export does not read it.
  const named = [sources.webcam, sources.mic, sources.cleanMic, sources.events, sources.markers, sources.transcript, look.background.image].filter((path) => path !== undefined);
  const inputs = [resolve(projectPath), screen, join(dirname(screen), TAKE_FILE), ...named.map((path) => resolve(projectDir, path))];
  const result: ProjectSources = { project, screen, stills: {}, inputs, warnings: takeFile?.warning ? [takeFile.warning] : [] };

  if (look.webcam.enabled && sources.webcam) {
    const path = await existing(projectDir, sources.webcam, 'webcam recording (sources.webcam)');
    result.webcam = { path, offset: offsetFor(take, 'webcam', path, screen) };
  }
  if (look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    // the cleaned-up mic plays in its place, in step with it (take.json describes the mic itself)
    const clean = look.audio.cleanup && sources.cleanMic ? await existing(projectDir, sources.cleanMic, 'cleaned-up mic (sources.cleanMic)') : undefined;
    result.mic = { path: clean ?? path, offset: offsetFor(take, 'mic', path, screen) };
  }
  const typing = look.audio.enabled && look.audio.typing;
  if ((look.cursor.enabled || typing) && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    // the page draws the cursor from them only while it shows
    if (look.cursor.enabled) result.events = events.events;
    if (typing) result.keys = events.events.filter((event) => event.type === 'keys');
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
  const motion = await motionPages(projectDir, project);
  if (motion) {
    result.motion = motion;
    result.inputs.push(...Object.values(motion.scenes), ...Object.values(motion.overlays));
  }
  return result;
}
