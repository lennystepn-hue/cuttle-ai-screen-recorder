// The tools around the app. ffmpeg is looked for where the OS's PATH has it now (read from the
// registry on Windows, so "Check again" finds it right after `winget install Gyan.FFmpeg` without a
// restart) and in WinGet's links folder; found outside this process's PATH, it is put on it. For
// Claude Code: the cuttle command (shims that run the app's own copy of the CLI with the app as
// Node) and the cuttle skill (copied into Claude's config folder). Nothing that belongs to someone
// else is overwritten: a cuttle command already on PATH and a skill folder Cuttle did not write
// are left as they are.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import type { ToolsStatus } from '../shared/ipc';
import { CHECK } from './check';
import { cliEntry } from './cli-path';
import { mediaWorker } from './media-service';
import { recorderHost } from './recorder-host';

const windows = process.platform === 'win32';

/** Marks the shims this app writes (the repository's `pnpm cli:install` has its own mark). */
const SHIM_MARK = 'cuttle shim (Cuttle app)';
/** Marks a skill folder Cuttle wrote (the app's install and the repository's write the same file). */
const SKILL_MARK = '.cuttle-skill.json';
/** What the skill tells Claude to ask for when the command is missing, for a skill the app installed. */
const APP_INSTALL_HINT = 'ask the user to open Cuttle\'s settings (the tray icon, Settings) and press "Install" under Claude Code';

const run = (file: string, args: string[]) =>
  new Promise<{ ok: boolean; stdout: string }>((resolve) =>
    execFile(file, args, { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout) })),
  );

const splitPath = (value: string | undefined) => (value ?? '').split(delimiter).map((part) => part.trim().replace(/^"(.*)"$/, '$1')).filter((part) => part !== '');
/** `%LOCALAPPDATA%\…` as the shell expands it (process.env is case-insensitive on Windows). */
const expand = (value: string) => value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
const sameDir = (a: string, b: string) => {
  const key = (dir: string) => dir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return windows ? key(a).toLowerCase() === key(b).toLowerCase() : key(a) === key(b);
};
const unique = (dirs: string[]) => dirs.filter((dir, at) => dirs.findIndex((other) => sameDir(other, dir)) === at);

/** A REG_SZ or REG_EXPAND_SZ value from `reg query`'s output. */
export function registryValue(output: string, name: string): string | undefined {
  const line = output.split(/\r?\n/).find((row) => new RegExp(`^\\s*${name}\\s+REG_(EXPAND_)?SZ\\s`, 'i').test(row));
  return line?.replace(new RegExp(`^\\s*${name}\\s+REG_(EXPAND_)?SZ\\s+`, 'i'), '').trim();
}

async function registryPath(key: string): Promise<string | undefined> {
  const { ok, stdout } = await run('reg', ['query', key, '/v', 'Path']);
  return ok ? registryValue(stdout, 'Path') : undefined;
}

const USER_ENVIRONMENT = 'HKCU\\Environment';
const MACHINE_ENVIRONMENT = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
/** WinGet puts links to the commands of the packages it installs here (on PATH for new terminals). */
const wingetLinks = () => join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links');

/**
 * The folders a command is looked for in: the PATH as the OS has it now (Windows: the machine's and
 * the user's from the registry), WinGet's links folder, then this process's PATH. The check gives
 * its own list in a file (CUTTLE_CHECK_PATH_FILE), so it can make ffmpeg appear.
 */
export async function searchPath(): Promise<string[]> {
  const file = CHECK ? process.env.CUTTLE_CHECK_PATH_FILE : undefined;
  if (file) return splitPath(readFileSync(file, 'utf8'));
  if (!windows) return unique(splitPath(process.env.PATH));
  const [machine, user] = await Promise.all([registryPath(MACHINE_ENVIRONMENT), registryPath(USER_ENVIRONMENT)]);
  return unique([...splitPath(expand(machine ?? '')), ...splitPath(expand(user ?? '')), wingetLinks(), ...splitPath(process.env.PATH)]);
}

/** The first file for command `name` in `dirs` (Windows: name.exe, .cmd or .bat; elsewhere the name). */
export function findCommand(name: string, dirs: readonly string[], extensions = windows ? ['.exe', '.cmd', '.bat'] : ['']): string | undefined {
  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = join(dir, `${name}${extension}`);
      if (existsSync(file)) return file;
    }
  }
  return undefined;
}

/** "7.1-full_build-www.gyan.dev" from `ffmpeg -version`'s first line. */
export const ffmpegVersion = (output: string) => /^ffmpeg version (\S+)/m.exec(output)?.[1];

/**
 * Finds ffmpeg and makes this process use it: a folder that is not on its PATH yet (installed since
 * the app started) is put first on it, so the recorder, the media worker and exports find it.
 * `changed` says the PATH changed: helper processes started before must start again.
 */
export async function findFfmpeg(): Promise<{ ffmpeg?: ToolsStatus['ffmpeg']; changed: boolean }> {
  const file = findCommand('ffmpeg', await searchPath(), windows ? ['.exe'] : ['']);
  if (!file) return { changed: false };
  const { ok, stdout } = await run(file, ['-version']);
  const version = ok ? ffmpegVersion(stdout) : undefined;
  if (!version) return { changed: false };
  const dir = join(file, '..');
  const onPath = splitPath(process.env.PATH).some((part) => sameDir(part, dir));
  if (!onPath) {
    process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`;
    // helpers started before look on the old PATH: idle ones start again with this one
    recorderHost.refresh();
    mediaWorker.refresh();
  }
  return { ffmpeg: { path: file, version }, changed: !onPath };
}

// ---- the cuttle command ------------------------------------------------------------------------

/** Where the app writes its shims: CUTTLE_BIN_DIR, else a folder of its own. */
export const binDir = () => process.env.CUTTLE_BIN_DIR || (windows ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Cuttle', 'bin') : join(homedir(), '.local', 'bin'));

const quoteSh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const toPosix = (path: string) => path.replace(/\\/g, '/').replace(/^([A-Za-z]):\//, (_whole, drive: string) => `/${drive.toLowerCase()}/`);

/**
 * The shims: cmd.exe and PowerShell run cuttle.cmd, Git Bash and other shells run `cuttle`. The app
 * runs as Node (ELECTRON_RUN_AS_NODE, only for that command: `setlocal`); a packaged app also runs
 * the CLI's Electron part itself (CUTTLE_ELECTRON), since it has no Electron of its own to download.
 */
export function shims(exe: string, entry: string, packaged: boolean): Record<string, string> {
  const electron = packaged ? exe : undefined;
  return {
    ...(windows && {
      'cuttle.cmd': [`@rem ${SHIM_MARK}`, '@setlocal', '@set ELECTRON_RUN_AS_NODE=1', ...(electron ? [`@set "CUTTLE_ELECTRON=${electron}"`] : []), `@"${exe}" "${entry}" %*`, ''].join('\r\n'),
    }),
    cuttle: [
      '#!/bin/sh',
      `# ${SHIM_MARK}`,
      `ELECTRON_RUN_AS_NODE=1 ${electron ? `CUTTLE_ELECTRON=${quoteSh(electron)} ` : ''}exec ${quoteSh(windows ? toPosix(exe) : exe)} ${quoteSh(windows ? toPosix(entry) : entry)} "$@"`,
      '',
    ].join('\n'),
  };
}

const isOurShim = (file: string) => {
  try {
    return readFileSync(file, 'utf8').includes(SHIM_MARK);
  } catch {
    return false;
  }
};

/** Puts `dir` on the user's PATH for new terminals (Windows: the registry, announced to running programs). */
async function addToUserPath(dir: string): Promise<boolean> {
  if (!windows) return false;
  const current = (await registryPath(USER_ENVIRONMENT)) ?? '';
  if (splitPath(expand(current)).some((part) => sameDir(part, dir))) return false;
  // The check never touches the user's PATH: it says what it would have done.
  if (CHECK) {
    (globalThis as { __pathAdded?: string[] }).__pathAdded = [...((globalThis as { __pathAdded?: string[] }).__pathAdded ?? []), dir];
    return true;
  }
  // .NET writes the value and broadcasts WM_SETTINGCHANGE, so Explorer starts new terminals with it.
  const script = `$p = [Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', ($(if ($p) { $p.TrimEnd(';') + ';' } else { '' }) + $env:CUTTLE_ADD_PATH), 'User')`;
  const done = await new Promise<boolean>((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000, env: { ...process.env, CUTTLE_ADD_PATH: dir } }, (error) => resolve(!error)),
  );
  if (!done) throw new Error(`${dir} could not be put on your PATH`);
  return true;
}

// ---- the skill ---------------------------------------------------------------------------------

/** The skill's files in the app: packaged next to the bundle, else the repository's. */
const skillSource = () => (app.isPackaged ? join(app.getAppPath(), 'skill') : fileURLToPath(new URL('../../../../skill/cuttle/', import.meta.url)));
const skillDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills', 'cuttle');

function skillState(dir: string): ToolsStatus['skill']['state'] {
  if (existsSync(join(dir, SKILL_MARK))) return 'installed';
  return existsSync(dir) ? 'other' : 'missing';
}

/** Only plain Markdown names in the folder itself: a marker's list is never trusted with a path. */
const markdown = (name: unknown): name is string => typeof name === 'string' && /^[^/\\]+\.md$/.test(name);

async function installSkill(): Promise<void> {
  // the check writes only into a Claude folder of its own, never the user's
  if (CHECK && !process.env.CLAUDE_CONFIG_DIR) throw new Error('the check sets no CLAUDE_CONFIG_DIR');
  const target = skillDir();
  const marker = join(target, SKILL_MARK);
  const state = skillState(target);
  if (state === 'other') throw new Error(`${target} holds a cuttle skill Cuttle did not install; it was left as it is`);
  if (state === 'installed') {
    // an older version's files go first
    const previous = JSON.parse(await readFile(marker, 'utf8').catch(() => '{}')) as { files?: unknown };
    for (const name of (Array.isArray(previous.files) ? previous.files : []).filter(markdown)) await rm(join(target, name), { force: true });
  }
  const source = skillSource();
  const files = readdirSync(source).filter(markdown);
  await mkdir(target, { recursive: true });
  // the marker first: an install cut short still belongs to Cuttle
  await writeFile(marker, `${JSON.stringify({ app: true, files }, null, 2)}\n`);
  for (const name of files) {
    const text = await readFile(join(source, name), 'utf8');
    await writeFile(join(target, name), text.replaceAll('{{INSTALL_CLI}}', () => APP_INSTALL_HINT));
  }
}

// ---- status and install ------------------------------------------------------------------------

/** Whether the app put its command folder on the user's PATH in this run (terminals opened before do not see it). */
let pathAdded = false;

export async function toolsStatus(): Promise<ToolsStatus> {
  const dirs = await searchPath();
  const { ffmpeg } = await findFfmpeg();
  // the app's own folder counts once it is written, even before a new terminal sees it
  const command = findCommand('cuttle', [...dirs, binDir()].filter((dir, at, all) => all.findIndex((other) => sameDir(other, dir)) === at));
  return {
    ...(ffmpeg && { ffmpeg }),
    ...(command && { command: { path: command, ours: isOurShim(command) } }),
    skill: { dir: skillDir(), state: skillState(skillDir()) },
    ...(pathAdded && { newTerminal: true }),
  };
}

/**
 * Installs what is missing: the command (unless another cuttle is already on PATH; the app's own
 * shims are written again, so they follow the app when it moved) and the skill (unless a folder
 * Cuttle did not write is there). Says what could not be done, in a sentence.
 */
export async function installTools(): Promise<{ status: ToolsStatus; problem?: string }> {
  const problems: string[] = [];
  const before = await toolsStatus();
  if (!before.command || before.command.ours) {
    try {
      if (CHECK && !process.env.CUTTLE_BIN_DIR) throw new Error('the check sets no CUTTLE_BIN_DIR');
      const entry = cliEntry();
      if (!existsSync(entry)) throw new Error(`the app's copy of the cuttle command is missing (${entry})`);
      const dir = binDir();
      const files = shims(process.execPath, entry, app.isPackaged);
      const foreign = Object.keys(files).filter((name) => existsSync(join(dir, name)) && !isOurShim(join(dir, name)));
      if (foreign.length > 0) throw new Error(`${join(dir, foreign[0]!)} belongs to another program`);
      await mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) {
        await writeFile(join(dir, name), text);
        if (!name.includes('.')) await chmod(join(dir, name), 0o755);
      }
      if (await addToUserPath(dir)) pathAdded = true;
    } catch (error) {
      problems.push(`The cuttle command: ${(error as Error).message}.`);
    }
  }
  if (before.skill.state !== 'other') {
    try {
      await installSkill();
    } catch (error) {
      problems.push(`The skill: ${(error as Error).message}.`);
    }
  } else problems.push(`The skill: ${before.skill.dir} holds a cuttle skill Cuttle did not install; it was left as it is.`);
  return { status: await toolsStatus(), ...(problems.length > 0 && { problem: problems.join(' ') }) };
}
