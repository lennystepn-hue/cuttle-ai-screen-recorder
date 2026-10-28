// Iconify's icon sets (api.iconify.design): over 200,000 icons in about 200 sets (Phosphor, Tabler,
// Material Design, brand logos…), each set under its own licence, found by words and brought in as
// SVG files.
import { CoreError } from '../errors';
import { fetchJson, fetchText } from './net';

const API = 'https://api.iconify.design';

/** An icon set's licence and author, as Iconify names them. */
export interface IconSet {
  name: string;
  license: string;
  licenseUrl?: string;
  author?: string;
  authorUrl?: string;
}

interface SetInfo {
  name?: string;
  license?: { title?: string; spdx?: string; url?: string };
  author?: { name?: string; url?: string };
}

const setOf = (info: SetInfo | undefined, prefix: string): IconSet => ({
  name: info?.name ?? prefix,
  license: info?.license?.spdx ?? info?.license?.title ?? 'see the set',
  ...(info?.license?.url && { licenseUrl: info.license.url }),
  ...(info?.author?.name && { author: info.author.name }),
  ...(info?.author?.url && { authorUrl: info.author.url }),
});

/** `set:icon`, checked: Iconify's names are lower-case letters, digits and dashes. */
export function iconName(name: string): { prefix: string; icon: string } {
  const match = /^(?:icons:|iconify:)?([a-z0-9-]+):([a-z0-9-]+)$/.exec(name);
  if (!match) throw new CoreError('usage', `"${name}" is not an icon of Iconify's (set:name, e.g. icons:ph:rocket-launch)`);
  return { prefix: match[1]!, icon: match[2]! };
}

/** Icons that show `words`, at most `limit`, each with its set's licence. */
export async function searchIconify(words: readonly string[], limit = 30, signal?: AbortSignal): Promise<{ name: string; set: IconSet }[]> {
  const query = words.join(' ').trim();
  if (query === '') throw new CoreError('usage', 'say what the icon shows');
  const found = await fetchJson<{ icons?: string[]; collections?: Record<string, SetInfo> }>(`${API}/search?query=${encodeURIComponent(query)}&limit=${Math.max(32, limit)}`, signal);
  return (found.icons ?? []).slice(0, limit).map((name) => ({ name: `icons:${name}`, set: setOf(found.collections?.[name.split(':')[0]!], name.split(':')[0]!) }));
}

/** An icon's SVG and its set's licence. */
export async function iconifyIcon(name: string, signal?: AbortSignal): Promise<{ svg: string; set: IconSet; url: string }> {
  const { prefix, icon } = iconName(name);
  const url = `${API}/${prefix}/${icon}.svg`;
  const svg = await fetchText(url, signal);
  if (!/^\s*<svg\b/.test(svg)) throw new CoreError('download', `there is no icon ${prefix}:${icon} on Iconify`);
  const sets = await fetchJson<Record<string, SetInfo>>(`${API}/collections?prefixes=${prefix}`, signal).catch(() => ({}) as Record<string, SetInfo>);
  return { svg, set: setOf(sets[prefix], prefix), url };
}
