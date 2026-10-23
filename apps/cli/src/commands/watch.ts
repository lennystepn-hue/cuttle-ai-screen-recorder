// `cuttle watch`: keeps a project's previews fresh while its files are written. It watches the
// project folder and, a moment after a file changes, reruns what shows that file: a motion page's
// check (`motion check`), the music page's (`music check`), or the preview's stills (`preview`) for
// cuttle.json and everything else. Each update says what changed and what the run found, its errors
// first; with --json one line of JSON each, for an agent to read as they come. Runs never overlap:
// what changes during one runs after it, once. Ctrl+C stops it.
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { PROJECT_FILE, readProjectFile } from '@cuttle/core';
import type { CuttleProject } from '@cuttle/project';
import { CliError, toCliError } from '../errors';
import type { Output } from '../output';
import { motionCheckCommand } from './motion';
import { musicCheckCommand } from './music';
import { previewCommand } from './preview';

/** What a change reruns. */
export type WatchRun = { check: 'motion'; src: string } | { check: 'music'; src: string } | { check: 'preview' };

/**
 * What Cuttle writes itself, and what no page or still reads: changes there run nothing. Hidden files
 * too: an editor's or sed's temporary copy, Finder's .DS_Store.
 */
const IGNORED = /^(?:out|preview|takes|voiceover|node_modules)(?:\/|$)|(?:^|\/)\.[^/]*$|(?:^|\/)\.[^/]+\/|~$|\.(?:swp|swx|tmp|partial|bak|draft|lock)$|^cuttle\.json\..*$/;

/** Settles this long (ms) after the last change before it runs: an editor's save is several. */
export const WATCH_SETTLE_MS = 300;

/**
 * Watches `dir` and every folder in it, telling each change by its path in `dir`. Windows and macOS
 * watch a tree themselves. On Linux Node watches a tree file by file and loses a file once an editor
 * saves it by rename: there each folder has a watch of its own (inotify reports the changes to its
 * files), and a folder made or moved in gets one too. An error stops the watch of the project
 * itself; a folder that went away is let go.
 */
function watchTree(dir: string, onChange: (path: string | undefined) => void, onError: (error: Error) => void, perFolder = process.platform === 'linux'): { close(): void } {
  if (!perFolder) {
    const tree = watch(dir, { recursive: true }, (_event, filename) => onChange(filename?.toString()));
    tree.on('error', onError);
    return tree;
  }
  const folders = new Map<string, FSWatcher>();
  const add = (folder: string) => {
    const path = relative(dir, folder).split(sep).join('/');
    if (folders.has(folder) || (path !== '' && IGNORED.test(`${path}/`))) return;
    let folderWatch: FSWatcher;
    try {
      folderWatch = watch(folder, (_event, filename) => {
        if (!filename) return onChange(undefined);
        const changed = join(folder, filename.toString());
        onChange(relative(dir, changed));
        if (statSync(changed, { throwIfNoEntry: false })?.isDirectory()) addTree(changed);
      });
    } catch (error) {
      if (folder === dir) throw error;
      return; // gone again
    }
    folderWatch.on('error', (error) => {
      folderWatch.close();
      folders.delete(folder);
      if (folder === dir) onError(error);
    });
    folders.set(folder, folderWatch);
  };
  const addTree = (folder: string) => {
    add(folder);
    if (!folders.has(folder)) return;
    const entries = (() => {
      try {
        return readdirSync(folder, { withFileTypes: true });
      } catch {
        return []; // gone again
      }
    })();
    for (const entry of entries) if (entry.isDirectory()) addTree(join(folder, entry.name));
  };
  addTree(dir);
  return { close: () => folders.forEach((folderWatch) => folderWatch.close()) };
}

/** The pages of the project's motion items (scenes, overlays, transitions). */
function motionPages(project: CuttleProject): string[] {
  const pages = [
    ...project.scenes.flatMap((scene) => [...(scene.type === 'motion' ? [scene.src] : []), ...(scene.transition ? [scene.transition.src] : [])]),
    ...project.overlays.map((overlay) => overlay.src),
  ];
  return [...new Set(pages)];
}

/**
 * Whether `path` belongs to the page `src`: the page itself, or a file in its folder when the page
 * has one of its own (`motion/title/index.html`: everything in `motion/title/`).
 */
function belongsTo(path: string, src: string): boolean {
  if (path === src) return true;
  const folder = posix.dirname(src);
  return posix.basename(src) === 'index.html' && folder !== '.' && folder !== 'motion' && path.startsWith(`${folder}/`);
}

/**
 * What to rerun for files that changed (relative to the project, with `/`), each run with the files
 * it is for: each motion page they belong to its check, the music page its check, and anything else
 * (cuttle.json, a still, a logo, a page no item uses) the preview. Without a project that reads
 * (`undefined`: cuttle.json is broken), the preview, which says what is wrong.
 */
export function runsFor(changed: readonly string[], project: CuttleProject | undefined): (WatchRun & { files: string[] })[] {
  const runs: (WatchRun & { files: string[] })[] = [];
  const add = (run: WatchRun, path: string) => {
    const same = runs.find((each) => each.check === run.check && ('src' in each ? each.src : undefined) === ('src' in run ? run.src : undefined));
    if (same) same.files.push(path);
    else runs.push({ ...run, files: [path] });
  };
  const pages = project ? motionPages(project) : [];
  for (const path of changed) {
    if (IGNORED.test(path)) continue;
    const page = pages.find((src) => belongsTo(path, src));
    if (page) add({ check: 'motion', src: page }, path);
    else if (project?.music && belongsTo(path, project.music.src)) add({ check: 'music', src: project.music.src }, path);
    else add({ check: 'preview' }, path);
  }
  // the pages' checks first: the file being written is most likely one of them
  return [...runs.filter((run) => run.check !== 'preview'), ...runs.filter((run) => run.check === 'preview')];
}

/** What one run came to. */
export interface WatchUpdate {
  /** When it finished (ISO). */
  at: string;
  /** The files that changed, relative to the project. */
  changed: string[];
  check: WatchRun['check'];
  src?: string;
  /** What went wrong, first: the command's failure, the page's errors, the warnings. */
  errors: string[];
  /** The command's result (its stills, its sheet, …), as `--json` gives it; none when it failed. */
  result?: unknown;
  ms: number;
}

/** The errors in a check's result: its own, and its motion items'. */
function errorsOf(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const own = (result as { errors?: unknown }).errors;
  const items = (result as { motion?: { item: string; errors: string[] }[] }).motion ?? [];
  return [...(Array.isArray(own) ? own.map(String) : []), ...items.flatMap((item) => item.errors.map((error) => `${item.item}: ${error}`))];
}

export interface WatchOptions {
  /** Runs one check (the commands in-process by default; a test's own). */
  run?: (projectDir: string, run: WatchRun, signal: AbortSignal) => Promise<{ result?: unknown; errors: string[] }>;
  settleMs?: number;
  /** Called once it watches (a test waits for it). */
  onReady?: () => void;
  /** A watch for each folder, as on Linux (`watchTree`); a test's choice elsewhere. */
  perFolder?: boolean;
}

/** Runs a check as its command does, its result and warnings caught. */
async function runCheck(projectDir: string, run: WatchRun, signal: AbortSignal): Promise<{ result?: unknown; errors: string[] }> {
  let result: unknown;
  const warnings: string[] = [];
  const captured: Output = {
    json: true,
    result: (value) => void (result = value),
    line: () => {},
    info: () => {},
    warn: (text) => void warnings.push(text),
    error: () => {},
  };
  try {
    if (run.check === 'motion') await motionCheckCommand(projectDir, run.src, {}, captured, signal);
    else if (run.check === 'music') await musicCheckCommand(projectDir, { src: run.src }, captured, signal);
    else await previewCommand(projectDir, {}, captured, signal);
    return { result, errors: [...errorsOf(result), ...warnings] };
  } catch (error) {
    if (signal.aborted) throw error;
    const failure = toCliError(error);
    return { errors: [`${failure.code}: ${failure.message}`, ...warnings] };
  }
}

const NAMES = { motion: 'motion check', music: 'music check', preview: 'preview' } as const;

/** What an update says to people: what ran, its errors first, then what it made. */
function said(update: WatchUpdate): string {
  const time = update.at.slice(11, 19);
  const head = `${time} ${NAMES[update.check]}${update.src ? ` ${update.src}` : ''} (${update.changed.join(', ')}), ${(update.ms / 1000).toFixed(1)} s`;
  const sheet = (update.result as { sheet?: string } | undefined)?.sheet;
  return [head, ...(update.errors.length > 0 ? update.errors.map((error) => `  error: ${error}`) : ['  no errors']), ...(sheet ? [`  sheet: ${sheet}`] : [])].join('\n');
}

/**
 * `cuttle watch`: watches the project until `signal` (Ctrl+C) and reruns what each change shows; it
 * resolves with how many updates it made.
 */
export async function watchCommand(projectDir: string, output: Output, signal: AbortSignal, options: WatchOptions = {}): Promise<{ updates: number }> {
  const dir = resolve(projectDir);
  if (!existsSync(join(dir, PROJECT_FILE))) throw new CliError('usage', `${join(dir, PROJECT_FILE)} does not exist; run "cuttle init" in the project folder (or pass -C <dir>)`);
  const run = options.run ?? runCheck;
  const settle = options.settleMs ?? WATCH_SETTLE_MS;
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let updates = 0;

  const flush = async (): Promise<void> => {
    while (pending.size > 0 && !signal.aborted) {
      // files, not the folders around them (a folder made or renamed is reported too); a file gone counts
      const changed = [...pending].filter((path) => !statSync(join(dir, path), { throwIfNoEntry: false })?.isDirectory()).sort();
      pending.clear();
      if (changed.length === 0) continue;
      const project = await readProjectFile(dir).then(
        (file) => file.project,
        () => undefined,
      );
      for (const { files, ...each } of runsFor(changed, project)) {
        if (signal.aborted) return;
        const started = performance.now();
        const { result, errors } = await run(dir, each, signal).catch((error: unknown) => {
          if (signal.aborted) return { errors: [] as string[], result: undefined };
          return { errors: [`internal: ${(error as Error).message}`], result: undefined };
        });
        if (signal.aborted) return;
        const update: WatchUpdate = {
          at: new Date().toISOString(),
          changed: files,
          check: each.check,
          ...('src' in each && { src: each.src }),
          errors,
          ...(result !== undefined && { result }),
          ms: Math.round(performance.now() - started),
        };
        updates++;
        output.line(update, () => said(update));
      }
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      // one run at a time: changes during one wait for it, then run once
      if (running) return;
      running = flush().finally(() => {
        running = undefined;
        if (pending.size > 0 && !signal.aborted) schedule();
      });
    }, settle);
  };

  let stop: (error?: Error) => void = () => {};
  let watcher: { close(): void };
  try {
    watcher = watchTree(
      dir,
      (filename) => {
        // a platform that cannot say which file: the project as a whole
        const path = filename ? filename.split(sep).join('/') : PROJECT_FILE;
        if (IGNORED.test(path)) return;
        pending.add(path);
        schedule();
      },
      (error) => stop(error),
      options.perFolder,
    );
  } catch (error) {
    throw new CliError('usage', `cannot watch ${dir}: ${(error as Error).message}`, { cause: error });
  }
  output.info(`watching ${dir} (Ctrl+C stops)`);
  options.onReady?.();
  await new Promise<void>((done) => {
    stop = (error) => {
      if (error) output.warn(`watching stopped: ${error.message}`);
      done();
    };
    if (signal.aborted) return done();
    signal.addEventListener('abort', () => done(), { once: true });
  });
  watcher.close();
  if (timer) clearTimeout(timer);
  await running?.catch(() => {});
  return { updates };
}
