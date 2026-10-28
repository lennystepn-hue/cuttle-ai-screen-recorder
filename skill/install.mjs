// Installs the Claude skill: copies skill/cuttle/ to <Claude's config folder>/skills/cuttle/
// (CLAUDE_CONFIG_DIR, default ~/.claude), with {{REPO}} in SKILL.md replaced by this repository's
// path. A file .cuttle-skill.json in the installed folder marks it as ours; a cuttle skill without
// it belongs to someone else and is never touched. `--uninstall` removes our files. `--refresh`
// (pnpm install and cli:install run it) installs again only a skill this checkout installed, so it
// follows the repository: one the app installed, another checkout's (a worktree on another branch)
// or none stays as it is.
//   node skill/install.mjs [--uninstall | --refresh]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = '.cuttle-skill.json';
const source = fileURLToPath(new URL('./cuttle/', import.meta.url));
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const target = join(configDir, 'skills', 'cuttle');
const marker = join(target, MARK);

/** What a previous install wrote, or undefined when the folder is not ours (or does not exist). */
function installed() {
  if (!existsSync(marker)) return undefined;
  try {
    return JSON.parse(readFileSync(marker, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Only plain Markdown names in the folder itself: the marker's list is never trusted with a path. */
const ours = (name) => typeof name === 'string' && /^[^/\\]+\.md$/.test(name);

function removeFiles(previous) {
  for (const name of (Array.isArray(previous.files) ? previous.files : []).filter(ours)) rmSync(join(target, name), { force: true });
}

if (process.argv.includes('--uninstall')) {
  const previous = installed();
  if (previous) {
    removeFiles(previous);
    rmSync(marker, { force: true });
    if (readdirSync(target).length === 0) rmSync(target, { recursive: true });
  }
  console.log(previous ? `removed the cuttle skill from ${target}` : `no cuttle skill installed by this script in ${target}`);
  process.exit(0);
}

/** The same folder, as Windows compares paths (ignoring case) and POSIX does. */
const samePath = (a, b) => {
  const key = (path) => resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? key(a).toLowerCase() === key(b).toLowerCase() : key(a) === key(b);
};
const refresh = process.argv.includes('--refresh');
const previous = installed();
if (refresh && (typeof previous?.repo !== 'string' || !samePath(previous.repo, repo))) process.exit(0);
if (existsSync(target) && !previous) {
  console.error(`${target} exists and was not installed by this script; move it away first`);
  process.exit(1);
}
if (previous) removeFiles(previous); // files of an older version
mkdirSync(target, { recursive: true });
const files = readdirSync(source).filter(ours);
// The marker first: an install cut short still belongs to us (install again, or uninstall).
writeFileSync(marker, `${JSON.stringify({ repo, files }, null, 2)}\n`);
const repoPath = repo.replace(/\\/g, '/');
for (const name of files) {
  // A function, so `$&` or `$'` in the path stays as it is.
  const text = readFileSync(join(source, name), 'utf8').replaceAll('{{INSTALL_CLI}}', () => `ask the user to run \`pnpm cli:install\` in the cuttle repository (\`${repoPath}\`)`);
  writeFileSync(join(target, name), text.replaceAll('{{REPO}}', () => repoPath));
}
if (refresh) {
  console.log(`refreshed the cuttle skill in ${target} (${files.join(', ')})`);
  process.exit(0);
}
console.log(`installed the cuttle skill in ${target} (${files.join(', ')})`);
console.log('Claude Code uses it when you ask for a demo or type /cuttle (a session that was already running may need /reload-skills); it needs the cuttle command: pnpm cli:install');
