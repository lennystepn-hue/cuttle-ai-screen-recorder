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
}

const issuesText = (issues: readonly { path: string; message: string }[]): string =>
  issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

/**
 * Absolute path of a project file that exists. Media must not be empty (a recorder killed at once
 * leaves 0 bytes); an empty events.jsonl is fine (no input events).
 */
async function existing(projectDir: string, relative: string, what: string, media = true): Promise<string> {
  const path = resolve(projectDir, relative);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new ExportError('missing-file', `${what} not found: ${path}`);
  }
  if (media && size === 0) throw new ExportError('invalid-media', `${what} is empty (0 bytes): ${path}`);
  return path;
}

async function readTake(screen: string): Promise<TakeFile | undefined> {
  const path = join(dirname(screen), TAKE_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined; // no take.json: the tracks are taken as already lined up
  }
  const result = parseTakeJson(text);
  if (!result.ok) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(result.issues)}`);
  return result.take;
}

/** Offset of a track from take.json, only when take.json describes that very file. */
function offsetFor(take: TakeFile | undefined, track: 'webcam' | 'mic', path: string, screen: string): number {
  const entry = take?.tracks[track];
  if (!take || !entry || resolve(dirname(screen), entry.file) !== path) return 0;
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
  const take = await readTake(screen);
  const result: ProjectSources = { project, screen, stills: {} };

  if (look.webcam.enabled && sources.webcam) {
    const path = await existing(projectDir, sources.webcam, 'webcam recording (sources.webcam)');
    result.webcam = { path, offset: offsetFor(take, 'webcam', path, screen) };
  }
  if (look.audio.enabled && sources.mic) {
    const path = await existing(projectDir, sources.mic, 'mic recording (sources.mic)');
    result.mic = { path, offset: offsetFor(take, 'mic', path, screen) };
  }
  if (look.cursor.enabled && sources.events) {
    const path = await existing(projectDir, sources.events, 'input events (sources.events)', false);
    const events = parseEventsJsonl(await readFile(path, 'utf8'));
    if (events.issues.length > 0) throw new ExportError('invalid-project', `${path} is invalid:\n${issuesText(events.issues)}`);
    result.events = events.events;
  }
  for (const [index, scene] of project.scenes.entries()) {
    if (scene.type === 'still') result.stills[index] = await existing(projectDir, scene.image, `image of scene ${index}`);
  }
  if (look.background.preset === 'image' && look.background.image) {
    result.backgroundImage = await existing(projectDir, look.background.image, 'background image (look.background.image)');
  }
  return result;
}
