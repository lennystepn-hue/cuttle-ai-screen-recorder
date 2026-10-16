import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEventsJsonl, parseProjectJson, parseTakeJson, trackOffset, type CuttleProject, type InputEvent, type TakeFile } from '@cuttle/project';
import { ExportError } from '../errors';

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
  stills: Record<number, string>;
  backgroundImage?: string;
  /** Every file the export reads (cuttle.json and take.json included): the output must not replace one. */
  inputs: string[];
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

async function readTake(screen: string): Promise<{ path: string; take: TakeFile } | undefined> {
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
  if (!samePath(resolve(dirname(screen), result.take.tracks.screen.file), screen)) return undefined;
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
  const result: ProjectSources = { project, screen, stills: {}, inputs: [resolve(projectPath), screen] };
  if (takeFile) result.inputs.push(takeFile.path);

  if (look.webcam.enabled && sources.webcam) {
    const path = await existing(projectDir, sources.webcam, 'webcam recording (sources.webcam)');
    result.webcam = { path, offset: offsetFor(take, 'webcam', path, screen) };
    result.inputs.push(path);
  }
  if (look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    result.mic = { path, offset: offsetFor(take, 'mic', path, screen) };
    result.inputs.push(path);
  }
  if (look.cursor.enabled && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    result.events = events.events;
    result.inputs.push(path);
  }
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type !== 'still') continue;
    result.stills[index] = await existing(projectDir, scene.image, `image of scene ${index}`);
    result.inputs.push(result.stills[index]);
  }
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
    result.inputs.push(result.backgroundImage);
  }
  return result;
}
