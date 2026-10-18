import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runCli } from '@cuttle/cli';
import {
  BACKGROUND_PRESETS,
  CLICK_EFFECTS,
  CURSOR_STYLES,
  EASES,
  FRAME_STYLES,
  MASK_STYLES,
  STILL_MOTIONS,
  TEXT_POSITIONS,
  TEXT_STYLES,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
  parseProject,
} from '@cuttle/project';

const SKILL_DIR = fileURLToPath(new URL('../cuttle/', import.meta.url));
const INSTALL = fileURLToPath(new URL('../install.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(SKILL_DIR, 'project.md'), 'utf8');
const motion = readFileSync(join(SKILL_DIR, 'motion.md'), 'utf8');
const music = readFileSync(join(SKILL_DIR, 'music.md'), 'utf8');
const docs = [skill, reference, motion, music];

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-skill-'));
  dirs.push(dir);
  return dir;
};

describe('SKILL.md', () => {
  it('has the frontmatter Claude Code reads: its name and a description that says when to use it', () => {
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
    const fields = Object.fromEntries(frontmatter.split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
    expect(Object.keys(fields)).toEqual(['name', 'description']);
    expect(fields.name).toBe('cuttle');
    expect(fields.description!.length).toBeGreaterThan(200);
    expect(fields.description!.length).toBeLessThanOrEqual(1024); // the Agent Skills limit
    expect(fields.description).toMatch(/^Records the screen/); // third person, what it does first
    expect(fields.description).toMatch(/Use when .*demo.*screencast.*screen recording/);
  });

  it('stays short and links only files that exist', () => {
    expect(skill.split('\n').length).toBeLessThan(500);
    const links = [...docs.join('\n').matchAll(/\]\(([^)#]+)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(existsSync(join(SKILL_DIR, link)), link).toBe(true);
  });
});

/** The program's own options, which may also follow the command. */
const GLOBAL = ['--json', '--project', '--help', '--version'];

/** The help text of a command, from the CLI itself. */
async function help(command: string): Promise<string> {
  let out = '';
  await runCli([...command.split(' '), '--help'], { stdout: (text) => void (out += text), stderr: () => {} });
  return out;
}

/** `--flag` as a whole option in a help text (not `--until` inside `--until-file`). */
const hasFlag = (text: string, flag: string) => new RegExp(`${flag}(?![\\w-])`).test(text);
const COMMANDS = ['devices', 'record', 'suggest', 'transcribe', 'models', 'transcript', 'preview', 'fit', 'frame', 'capture-page', 'motion check', 'motion new', 'motion templates', 'music new', 'music templates', 'music set', 'music check', 'sound add', 'sound list', 'init', 'render', 'recover'];
/** Commands with subcommands: the subcommand is part of the command (`motion check`). */
const GROUPS = ['motion', 'music', 'sound'];

describe('the cuttle commands in the skill', () => {
  // Code blocks and inline code: what Claude runs.
  const code = docs.flatMap((text) => [...text.matchAll(/```[a-z]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map((match) => match[1] ?? match[2]!));
  // `cuttle [-C dir] [--json] <command> … --flags`, up to the end of the line, a `&&`, `;`, `|` or the next cuttle.
  const uses = code.flatMap((snippet) =>
    [...snippet.matchAll(/(?:^|\s)cuttle((?: (?:-C "[^"]*"|-C \S+|--json))*) ([a-z][a-z-]*)((?:(?!&&|;|\||\bcuttle )[^\n])*)/g)].map(
      ([, , group, rest]) => {
        const sub = GROUPS.includes(group!) ? / ([a-z][a-z-]*)/.exec(rest!)?.[1] : undefined;
        return {
          command: sub ? `${group} ${sub}` : group!,
          flags: [...rest!.matchAll(/(?:^|\s)(--[a-z-]+)/g)].map((flag) => flag[1]!).filter((flag) => !GLOBAL.includes(flag)),
        };
      },
    ),
  );
  // An option on its own (`--until-file "<project>/stop"`): it must belong to some command. The
  // motion pages' CSS variables (`--cuttle-accent`, `--u: …`) are not options.
  const loose = code.flatMap((snippet) => (/^--(?!cuttle-)[a-z-]+(?![a-z-]|\s*:)/.exec(snippet)?.[0] ?? []) as string[]);

  it('covers the workflow', () => {
    expect(new Set(uses.map((use) => use.command))).toEqual(new Set(COMMANDS));
    expect(loose.length).toBeGreaterThan(5);
  });

  it('uses only commands and options the CLI has', async () => {
    for (const { command, flags } of uses) {
      const text = await help(command);
      expect(text, `cuttle ${command}`).toContain(`Usage: cuttle ${command}`);
      for (const flag of flags) expect(hasFlag(text, flag), `cuttle ${command} ${flag}`).toBe(true);
    }
    const all = (await Promise.all(COMMANDS.map(help))).join('\n');
    for (const flag of loose.filter((flag) => !GLOBAL.includes(flag))) expect(hasFlag(all, flag), flag).toBe(true);
  });

  it('catches an option the CLI does not have, and a prefix of one', () => {
    expect(hasFlag('  --until-file <path>  stop when …', '--until-file')).toBe(true);
    expect(hasFlag('  --until-file <path>  stop when …', '--until')).toBe(false);
    expect(hasFlag('  --until-file <path>  stop when …', '--until-flie')).toBe(false);
  });
});

describe('project.md', () => {
  it('has a complete example that is a valid project', () => {
    const example = /```json\n([\s\S]*?)\n```/.exec(reference)?.[1] ?? '';
    const parsed = parseProject(JSON.parse(example));
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
  });

  it('lists every value the schema accepts, where its field is described', () => {
    /** The table row or paragraph that starts with `start`. */
    const where = (start: string) => {
      const from = reference.indexOf(start);
      expect(from, start).toBeGreaterThanOrEqual(0);
      const end = reference.indexOf('\n\n', from);
      return reference.slice(from, end < 0 ? undefined : end).split('\n| `').at(0)!;
    };
    const fields: [string, readonly string[]][] = [
      ['| `background.preset`', BACKGROUND_PRESETS],
      ['| `frame` |', FRAME_STYLES],
      ['| `cursor` |', [...CURSOR_STYLES, ...CLICK_EFFECTS]],
      ['| `webcam` |', [...WEBCAM_SHAPES, ...WEBCAM_CORNERS]],
      ['| `still` |', [...STILL_MOTIONS, ...FRAME_STYLES]],
      ['`zooms`:', EASES],
      ['`masks` hide', MASK_STYLES],
      ['`texts`:', [...TEXT_STYLES, ...TEXT_POSITIONS]],
    ];
    for (const [start, values] of fields) {
      const text = where(start);
      for (const value of values) expect(text, `${start}: ${value}`).toContain(`\`${value}\``);
    }
  });
});

describe('skill/install.mjs', () => {
  const install = (config: string, ...args: string[]) =>
    spawnSync('node', [INSTALL, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config } });

  it('installs into the Claude config folder with this repository in SKILL.md, again over itself, and uninstalls', () => {
    const config = temp();
    expect(install(config).status).toBe(0);
    const target = join(config, 'skills', 'cuttle');
    expect(readdirSync(target).sort()).toEqual(['.cuttle-skill.json', 'SKILL.md', 'motion.md', 'music.md', 'project.md']);
    const installed = readFileSync(join(target, 'SKILL.md'), 'utf8');
    expect(installed).not.toContain('{{REPO}}');
    expect(installed).toContain(`(\`${REPO}\`)`);
    expect(readFileSync(join(target, 'project.md'), 'utf8')).toBe(reference);
    expect(install(config).status).toBe(0);
    expect(install(config, '--uninstall').status).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it('never touches a cuttle skill it did not install', () => {
    const config = temp();
    const target = join(config, 'skills', 'cuttle');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), 'mine');
    const refused = install(config);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/was not installed by this script/);
    expect(install(config, '--uninstall').status).toBe(0);
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('mine');
  });

  it('removes only plain Markdown names from its own folder, whatever the marker lists', () => {
    const config = temp();
    const target = join(config, 'skills', 'cuttle');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(config, 'skills', 'victim.md'), 'not ours');
    writeFileSync(join(target, '.cuttle-skill.json'), JSON.stringify({ files: ['../victim.md', 'SKILL.md'] }));
    writeFileSync(join(target, 'SKILL.md'), 'ours');
    expect(install(config, '--uninstall').status).toBe(0);
    expect(readFileSync(join(config, 'skills', 'victim.md'), 'utf8')).toBe('not ours');
    expect(existsSync(target)).toBe(false);
  });
});
