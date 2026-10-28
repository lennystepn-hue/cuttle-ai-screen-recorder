// Where the kit's files are on disk (Node only).
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER } from './index';

/** The templates in this package (a checkout of the repository). */
export const SOURCE_TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

/** The templates of the kit next to a bundle (`bundleUrl`: its `import.meta.url`), else this package's own. */
export function templatesFolder(bundleUrl: string): string {
  const built = fileURLToPath(new URL(`./${KIT_FOLDER}/templates/`, bundleUrl));
  return existsSync(built) ? built : SOURCE_TEMPLATES;
}

/** The template's folder is not in the kit (a build without it). */
export class MissingTemplateError extends Error {}

const isFolder = (path: string) => stat(path).then((info) => info.isDirectory(), () => false);

/** A folder's files into another, folder by folder (reads and writes only: the kit may sit in the app's archive). */
async function copyFolder(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyFolder(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile()) await writeFile(join(to, entry.name), await readFile(join(from, entry.name)));
  }
}

/**
 * Copies a template of the kit next to a bundle (`bundleUrl`) into the project's `<into>/<name>/`
 * (`motion`, or `music` for a music page), or `<name>-2/` and so on when that folder is taken.
 * Answers the page's path in the project (`motion/<folder>/index.html`).
 */
export async function copyTemplate(projectDir: string, template: string, name: string, bundleUrl: string, into: 'motion' | 'music' = 'motion'): Promise<string> {
  const from = join(templatesFolder(bundleUrl), template);
  if (!(await isFolder(from))) throw new MissingTemplateError(`the template ${template} is missing from the motion kit (${from})`);
  let folder = name;
  for (let n = 2; await stat(join(projectDir, into, folder)).then(() => true, () => false); n++) folder = `${name}-${n}`;
  await copyFolder(from, join(projectDir, into, folder));
  return `${into}/${folder}/index.html`;
}

/**
 * The project's page of a template, for items that share one (the script's step titles): its
 * `motion/<template>/index.html` when the project has it already (as the person may have changed
 * it), else a copy of the kit's (`copyTemplate`). Undefined when the kit does not have it.
 */
export async function templatePage(projectDir: string, template: string, bundleUrl: string): Promise<string | undefined> {
  const page = `motion/${template}/index.html`;
  if (await stat(join(projectDir, page)).then((info) => info.isFile(), () => false)) return page;
  return copyTemplate(projectDir, template, template, bundleUrl).catch((error: unknown) => {
    if (error instanceof MissingTemplateError) return undefined;
    throw error;
  });
}

/**
 * Lucide's icons with the words they are found by (their tags): the kit's next to a bundle
 * (`bundleUrl`: its `import.meta.url`), else this package's dependency.
 */
export async function iconWords(bundleUrl: string): Promise<Record<string, string[]>> {
  const built = fileURLToPath(new URL(`./${KIT_FOLDER}/icons/tags.json`, bundleUrl));
  const file = existsSync(built) ? built : fileURLToPath(new URL('../node_modules/lucide-static/tags.json', import.meta.url));
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, string[]>;
}

/**
 * The icons that fit `words` best, at most `limit`: a word in the name counts most, a tag that is the
 * word next, a tag that holds it least; every word has to fit somewhere.
 */
export function findIcons(icons: Readonly<Record<string, readonly string[]>>, words: readonly string[], limit = 30): { name: string; tags: readonly string[] }[] {
  const wanted = words.flatMap((word) => word.toLowerCase().split(/[\s,]+/)).filter((word) => word !== '');
  const scored: { name: string; tags: readonly string[]; score: number }[] = [];
  for (const [name, tags] of Object.entries(icons)) {
    let score = 0;
    for (const word of wanted) {
      const parts = name.split('-');
      const fit = parts.includes(word) ? 6 : name.includes(word) ? 4 : tags.some((tag) => tag.toLowerCase() === word) ? 3 : tags.some((tag) => tag.toLowerCase().includes(word)) ? 1 : 0;
      if (fit === 0) {
        score = 0;
        break;
      }
      score += fit;
    }
    if (score > 0) scored.push({ name, tags, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name, tags }) => ({ name, tags }));
}
