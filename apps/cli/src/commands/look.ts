import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PROJECT_FILE, brandsDir, newProjectFile, readProjectFile, writeProjectFile } from '@cuttle/core';
import { LOOKS, type Look } from '@cuttle/motion-kit';
import { looksFolder } from '@cuttle/motion-kit/files';
import { CliError } from '../errors';
import { createOutput, type Output } from '../output';
import { addMotionPage, motionCheckCommand } from './motion';

// `cuttle look`: art directions built from one medium each, as the `motion/shared.css` and
// `motion/shared.js` every page of a video imports. The kit's are examples of how a look is made (a
// ground, inks, type, and how things come in and leave in that medium), to start from and change
// beyond recognition; `look new` writes the frame of a look of the video's own, which is what most
// videos should have, so no two look alike.

/** What `look list` says before the looks. */
const EXAMPLES =
  "These are examples of how a look is built from a medium, not a menu: give a video a look of its own, from its subject (story.md), with `cuttle look new`, or take one of these as a start and change its medium, palette, type and motion until it is this video's.";

const named = (name: string): Look => {
  const look = LOOKS.find((candidate) => candidate.name === name);
  if (!look) throw new CliError('usage', `no look "${name}" (${LOOKS.map((candidate) => candidate.name).join(', ')}); cuttle look new starts one of your own`);
  return look;
};

/** `cuttle look list`: the kit's looks. */
export async function lookListCommand(output: Output): Promise<{ looks: readonly Look[]; note: string }> {
  const result = { looks: LOOKS, note: EXAMPLES };
  output.result(result, () => [EXAMPLES, '', ...LOOKS.map((look) => `${look.name.padEnd(11)}${look.description}`)].join('\n'));
  return result;
}

/**
 * `cuttle look show <name>`: the look's sample page rendered (eight frames on a sheet) in a project
 * of its own, the sheet kept in the project's preview/looks/ (or Cuttle's user data without one).
 */
export async function lookShowCommand(projectDir: string, name: string, output: Output, signal: AbortSignal): Promise<{ look: Look; sheet: string; stills: string[] }> {
  const look = named(name);
  const from = join(looksFolder(import.meta.url), look.name);
  const scratch = await mkdtemp(join(tmpdir(), 'cuttle-look-'));
  try {
    const file = newProjectFile(scratch);
    await writeProjectFile(file, 'look show');
    await mkdir(join(scratch, 'motion', 'sample'), { recursive: true });
    for (const shared of ['shared.css', 'shared.js']) await copyFile(join(from, shared), join(scratch, 'motion', shared));
    await copyFile(join(from, 'sample.html'), join(scratch, 'motion', 'sample', 'index.html'));
    await addMotionPage(scratch, 'motion/sample/index.html', {}, 4);
    output.info(`rendering the look ${look.name} …`);
    const quiet = createOutput(true, { stdout: () => {}, stderr: () => {} });
    const checked = await motionCheckCommand(scratch, 'motion/sample/index.html', {}, quiet, signal);
    if (checked.errors.length > 0) throw new CliError('render', `the look's sample threw: ${checked.errors.join('; ')}`);
    const keep = (await stat(join(projectDir, PROJECT_FILE)).then(() => true, () => false)) ? join(projectDir, 'preview', 'looks') : join(dirname(brandsDir()), 'looks');
    await mkdir(keep, { recursive: true });
    const sheet = join(keep, `${look.name}.png`);
    await copyFile(checked.sheet!, sheet);
    const result = { look, sheet, stills: [] as string[] };
    output.result(result, () => `${look.name}: ${look.description}\nsheet: ${sheet}`);
    return result;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export interface LookApplyArgs {
  /** Also its sample page, as a scene at the start. */
  sample?: boolean;
  /** Replace a motion/shared.css or shared.js that is there. */
  force?: boolean;
}

export interface LookApplyResult {
  look: string;
  /** What it wrote, from the project folder. */
  files: string[];
  /** The scene of its sample, with --sample. */
  sample?: string;
  /** What goes with it: the transition and the music to start from. */
  suggest: { transition: string; music: string };
}

/** The look's files into motion/, refusing to replace a shared.css or shared.js already there unless `force`. */
async function writeShared(dir: string, from: string, force: boolean): Promise<string[]> {
  const written: string[] = [];
  for (const shared of ['shared.css', 'shared.js']) {
    const target = join(dir, 'motion', shared);
    const there = await readFile(target, 'utf8').catch(() => undefined);
    const fresh = await readFile(join(from, shared), 'utf8');
    if (there !== undefined && there !== fresh && !force) throw new CliError('usage', `motion/${shared} is there already (the video's look): --force replaces it`);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(from, shared), target);
    written.push(`motion/${shared}`);
  }
  return written;
}

/**
 * `cuttle look apply <name>`: the kit's look as the project's `motion/shared.css` and `shared.js`, its
 * ground as the background around the pages, hard cuts where it has them; with `sample` its sample
 * page as the first scene.
 */
export async function lookApplyCommand(projectDir: string, name: string, args: LookApplyArgs, output: Output): Promise<LookApplyResult> {
  const look = named(name);
  const file = await readProjectFile(projectDir);
  const from = join(looksFolder(import.meta.url), look.name);
  const files = await writeShared(file.dir, from, args.force ?? false);
  const raw = file.raw as { look?: { background?: unknown; transition?: Record<string, unknown> } };
  raw.look = { ...raw.look, background: { preset: 'solid', color: look.ground }, ...(look.hardCuts && { transition: { ...raw.look?.transition, enabled: false } }) };
  await writeProjectFile(file, 'look apply');
  let sample: string | undefined;
  if (args.sample) {
    const folder = `${look.name}-sample`;
    await mkdir(join(file.dir, 'motion', folder), { recursive: true });
    await copyFile(join(from, 'sample.html'), join(file.dir, 'motion', folder, 'index.html'));
    sample = `motion/${folder}/index.html`;
    await addMotionPage(file.dir, sample, { first: true }, 4);
    files.push(sample);
  }
  const result: LookApplyResult = { look: look.name, files, ...(sample && { sample }), suggest: { transition: look.transition, music: look.music } };
  output.result(result, () =>
    [
      `the look ${look.name}: ${files.join(', ')} (every page imports ../shared.js and ../shared.css)`,
      `the background is its ground${look.hardCuts ? ', the scenes cut hard' : ''}`,
      `goes with it: cuttle motion new ${look.transition} --into <scene>, cuttle music new ${look.music}`,
      'make it this video\'s own: its palette, type and motion from the subject (it is an example, not the look)',
    ].join('\n'),
  );
  return result;
}

/** `cuttle look new`: the frame of a look of the video's own (the same functions as the kit's, nothing decided). */
export async function lookNewCommand(projectDir: string, args: { force?: boolean }, output: Output): Promise<{ files: string[] }> {
  const file = await readProjectFile(projectDir);
  const files = await writeShared(file.dir, join(looksFolder(import.meta.url), 'blank'), args.force ?? false);
  const result = { files };
  output.result(result, () => `${files.join(', ')}: the frame of this video's own look; write its medium into them (motion.md, "Looks")`);
  return result;
}
