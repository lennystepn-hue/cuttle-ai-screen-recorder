// Where the kit's files are on disk (Node only).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KIT_FOLDER } from './index';

/** The templates in this package (a checkout of the repository). */
export const SOURCE_TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

/** The templates of the kit next to a bundle (`bundleUrl`: its `import.meta.url`), else this package's own. */
export function templatesFolder(bundleUrl: string): string {
  const built = fileURLToPath(new URL(`./${KIT_FOLDER}/templates/`, bundleUrl));
  return existsSync(built) ? built : SOURCE_TEMPLATES;
}
