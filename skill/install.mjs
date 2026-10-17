// Installs the Claude skill: copies skill/cuttle/ to <Claude's config folder>/skills/cuttle/
// (CLAUDE_CONFIG_DIR, default ~/.claude), with {{REPO}} in SKILL.md replaced by this repository's
// path. A file .cuttle-skill.json in the installed folder marks it as ours; a cuttle skill without
// it belongs to someone else and is never touched. `--uninstall` removes our files.
//   node skill/install.mjs [--uninstall]
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

function removeOurs() {
  const previous = installed();
  if (!previous) return false;
  for (const name of previous.files ?? []) rmSync(join(target, name), { force: true });
  rmSync(marker, { force: true });
  if (readdirSync(target).length === 0) rmSync(target, { recursive: true });
  return true;
}

if (process.argv.includes('--uninstall')) {
  console.log(removeOurs() ? `removed the cuttle skill from ${target}` : `no cuttle skill installed by this script in ${target}`);
  process.exit(0);
}

if (existsSync(target) && !installed()) {
  console.error(`${target} exists and was not installed by this script; move it away first`);
  process.exit(1);
}
removeOurs(); // files of an older version
mkdirSync(target, { recursive: true });
const files = readdirSync(source).filter((name) => name.endsWith('.md'));
for (const name of files) {
  const text = readFileSync(join(source, name), 'utf8').replaceAll('{{REPO}}', repo.replace(/\\/g, '/'));
  writeFileSync(join(target, name), text);
}
writeFileSync(marker, `${JSON.stringify({ repo, files }, null, 2)}\n`);
console.log(`installed the cuttle skill in ${target} (${files.join(', ')})`);
console.log('Claude Code uses it when you ask for a demo or type /cuttle (a session that was already running may need /reload-skills); it needs the cuttle command: pnpm cli:install');
