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
 * Copies a template of the kit next to a bundle (`bundleUrl`) into the project's `motion/<name>/`,
 * or `motion/<name>-2/` and so on when that folder is taken. Answers the page's path in the project
 * (`motion/<folder>/index.html`).
 */
export async function copyTemplate(projectDir: string, template: string, name: string, bundleUrl: string): Promise<string> {
  const from = join(templatesFolder(bundleUrl), template);
  if (!(await isFolder(from))) throw new MissingTemplateError(`the template ${template} is missing from the motion kit (${from})`);
  let folder = name;
  for (let n = 2; await stat(join(projectDir, 'motion', folder)).then(() => true, () => false); n++) folder = `${name}-${n}`;
  await copyFolder(from, join(projectDir, 'motion', folder));
  return `motion/${folder}/index.html`;
}
