// HyperFrames' registry (heygen-com/hyperframes, Apache-2.0): about 200 blocks, each an HTML page
// with a paused GSAP timeline in `window.__timelines` and its variables declared. Its catalogue (the
// blocks' titles, tags and previews) is read once a day at most and kept in Cuttle's user data; a
// block comes in at the commit the catalogue was read at, so it is the same every time.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CoreError } from '../errors';
import { blocksCache, fetchBytes, fetchJson, inBatches } from './net';

const REPO = 'heygen-com/hyperframes';
/** How long a catalogue is kept before the registry is asked again. */
const KEEP_MS = 24 * 60 * 60 * 1000;

/** A variable a block declares: its value comes from the page (`window.__hfVariables`), its default here. */
export interface BlockVariable {
  id: string;
  type: string;
  label?: string;
  default?: unknown;
  min?: number;
  max?: number;
  options?: unknown[];
}

export interface BlockItem {
  name: string;
  title: string;
  description: string;
  tags: string[];
  /** Seconds it plays. */
  duration: number;
  width: number;
  height: number;
  /** Its preview picture and video, where the registry has them. */
  poster?: string;
  video?: string;
  /** Its files in the registry's folder of the block: the page first. */
  files: string[];
  variables: BlockVariable[];
}

export interface BlockCatalog {
  source: 'hyperframes';
  /** The commit the blocks are read at. */
  ref: string;
  /** When it was read (ISO). */
  at: string;
  items: BlockItem[];
}

const raw = (ref: string, path: string) => `https://raw.githubusercontent.com/${REPO}/${ref}/registry/${path}`;
const catalogFile = () => join(blocksCache(), 'hyperframes.json');

interface RegistryItem {
  name?: string;
  title?: string;
  description?: string;
  tags?: unknown;
  duration?: number;
  dimensions?: { width?: number; height?: number };
  preview?: { poster?: string; video?: string };
  files?: { path?: string; type?: string }[];
  variables?: BlockVariable[];
}

function itemOf(name: string, item: RegistryItem): BlockItem | undefined {
  const files = (item.files ?? []).filter((file) => typeof file.path === 'string' && !file.path.includes('..')).sort((a, b) => Number(b.type === 'hyperframes:composition') - Number(a.type === 'hyperframes:composition'));
  if (files[0]?.type !== 'hyperframes:composition') return undefined;
  return {
    name,
    title: item.title ?? name,
    description: item.description ?? '',
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    duration: typeof item.duration === 'number' && item.duration > 0 ? item.duration : 5,
    width: item.dimensions?.width ?? 1920,
    height: item.dimensions?.height ?? 1080,
    ...(item.preview?.poster && { poster: item.preview.poster }),
    ...(item.preview?.video && { video: item.preview.video }),
    files: files.map((file) => file.path!),
    variables: Array.isArray(item.variables) ? item.variables.filter((variable) => typeof variable?.id === 'string') : [],
  };
}

/** The blocks of HyperFrames' registry: the kept catalogue, or (a day after it was read, or `refresh`) the registry's newest. */
export async function hyperframesCatalog(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<BlockCatalog> {
  const kept = await readFile(catalogFile(), 'utf8').then((text) => JSON.parse(text) as BlockCatalog, () => undefined);
  const age = kept ? Date.now() - (await stat(catalogFile())).mtimeMs : Infinity;
  if (kept && age < KEEP_MS && !options.refresh) return kept;
  const ref = await fetchJson<{ sha?: string }>(`https://api.github.com/repos/${REPO}/commits/main`, options.signal).then((commit) => commit.sha ?? 'main', () => 'main');
  if (kept && kept.ref === ref && ref !== 'main') {
    await keep({ ...kept, at: new Date().toISOString() });
    return kept;
  }
  const registry = await fetchJson<{ items?: { name?: string; type?: string }[] }>(raw(ref, 'registry.json'), options.signal);
  const names = (registry.items ?? []).filter((item) => item.type === 'hyperframes:block' && typeof item.name === 'string' && /^[a-z0-9-]+$/.test(item.name)).map((item) => item.name!);
  const items = await inBatches(names, 16, (name) => fetchJson<RegistryItem>(raw(ref, `blocks/${name}/registry-item.json`), options.signal).then((item) => itemOf(name, item), () => undefined));
  const catalog: BlockCatalog = { source: 'hyperframes', ref, at: new Date().toISOString(), items: items.filter((item): item is BlockItem => item !== undefined) };
  if (catalog.items.length === 0) throw new CoreError('download', `HyperFrames' registry (${REPO}) lists no blocks`);
  await keep(catalog);
  return catalog;
}

async function keep(catalog: BlockCatalog): Promise<void> {
  await mkdir(blocksCache(), { recursive: true });
  const temporary = `${catalogFile()}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(catalog));
  await rename(temporary, catalogFile());
}

/**
 * The blocks that fit `words` best, at most `limit`: a word in the name counts most, then a tag that
 * is the word, the title, a tag that holds it, the description; every word has to fit somewhere.
 * `tag` keeps only blocks with that tag.
 */
export function findBlocks(items: readonly BlockItem[], words: readonly string[], options: { tag?: string; limit?: number } = {}): BlockItem[] {
  const wanted = words.flatMap((word) => word.toLowerCase().split(/[\s,]+/)).filter((word) => word !== '');
  const scored: { item: BlockItem; score: number }[] = [];
  for (const item of items) {
    if (options.tag && !item.tags.some((tag) => tag.toLowerCase() === options.tag!.toLowerCase())) continue;
    let score = 0;
    for (const word of wanted) {
      const tags = item.tags.map((tag) => tag.toLowerCase());
      const fit = item.name.split('-').includes(word)
        ? 8
        : item.name.includes(word)
          ? 6
          : tags.includes(word)
            ? 5
            : item.title.toLowerCase().includes(word)
              ? 4
              : tags.some((tag) => tag.includes(word))
                ? 2
                : item.description.toLowerCase().includes(word)
                  ? 1
                  : 0;
      if (fit === 0) {
        score = 0;
        break;
      }
      score += fit;
    }
    if (score > 0 || wanted.length === 0) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, options.limit ?? 20)
    .map(({ item }) => item);
}

/** A block by its name (`glitch` or `hyperframes:glitch`), or a `usage` error that names the closest. */
export function blockNamed(catalog: BlockCatalog, name: string): BlockItem {
  const plain = name.replace(/^hyperframes:/, '');
  const item = catalog.items.find((candidate) => candidate.name === plain);
  if (item) return item;
  const close = findBlocks(catalog.items, plain.split('-'), { limit: 3 }).map((candidate) => candidate.name);
  throw new CoreError('usage', `there is no block "${plain}" in HyperFrames' registry${close.length > 0 ? ` (close: ${close.join(', ')})` : ''}: cuttle blocks search <words> finds one`);
}

/** A block's files from the registry, at the catalogue's commit. */
export async function blockFiles(catalog: BlockCatalog, item: BlockItem, signal?: AbortSignal): Promise<{ path: string; bytes: Uint8Array }[]> {
  return inBatches(item.files, 6, async (path) => ({ path, bytes: await fetchBytes(raw(catalog.ref, `blocks/${item.name}/${path}`), signal) }));
}

/** A block's variable as a Cuttle param: text, a number in its range, a colour, a switch or a choice. */
function paramOf(variable: BlockVariable): Record<string, unknown> {
  const options = Array.isArray(variable.options) ? variable.options.map(String) : undefined;
  const type = options && options.length > 0 ? 'select' : variable.type === 'number' ? 'number' : variable.type === 'color' ? 'color' : variable.type === 'boolean' ? 'bool' : 'text';
  const fallback = type === 'number' ? 0 : type === 'bool' ? false : type === 'select' ? options![0] : '';
  const value = variable.default;
  const fits = type === 'number' ? typeof value === 'number' : type === 'bool' ? typeof value === 'boolean' : typeof value === 'string';
  return {
    name: variable.id,
    label: variable.label ?? variable.id,
    type,
    default: fits ? value : type === 'number' ? Number(value) || fallback : fallback,
    ...(options && options.length > 0 && { options }),
    ...(type === 'number' && typeof variable.min === 'number' && { min: variable.min }),
    ...(type === 'number' && typeof variable.max === 'number' && { max: variable.max }),
  };
}

/**
 * A block's page made a Cuttle motion page: its variables declared as the item's params (the app's
 * inspector shows them) and handed to the block as HyperFrames' runtime would (`__hfVariables`), and
 * its fixed frame fitted to the video's (`fit`: all of it, or filling the frame). Its timeline in
 * `window.__timelines` follows the video's clock (the motion runtime sets it).
 */
export function adaptBlock(html: string, item: BlockItem): string {
  const params = [
    ...item.variables.map(paramOf),
    { name: 'fit', label: 'Fit into the frame', type: 'select', default: 'contain', options: ['contain', 'cover'] },
  ];
  const head = [
    `<!-- HyperFrames' block "${item.name}" (Apache-2.0), brought in by cuttle blocks add: see block.json. -->`,
    `<script type="application/json" id="cuttle-params">${JSON.stringify(params).replace(/</g, '\\u003c')}</script>`,
    `<script>
      // Cuttle: the block's variables are the item's params, and its ${item.width}×${item.height} frame fits the video's
      (function () {
        var params = (window.cuttle && window.cuttle.params) || {};
        window.__hfVariables = Object.assign({}, params);
        function fit() {
          var w = ${item.width}, h = ${item.height};
          var s = params.fit === 'cover' ? Math.max(innerWidth / w, innerHeight / h) : Math.min(innerWidth / w, innerHeight / h);
          if (innerWidth === w && innerHeight === h) return;
          document.documentElement.style.overflow = 'hidden';
          document.body.style.transformOrigin = '0 0';
          document.body.style.transform = 'translate(' + (innerWidth - w * s) / 2 + 'px, ' + (innerHeight - h * s) / 2 + 'px) scale(' + s + ')';
        }
        document.addEventListener('DOMContentLoaded', fit);
      })();
    </script>`,
  ].join('\n');
  const opened = /<head\b[^>]*>/i.exec(html);
  if (opened) return `${html.slice(0, opened.index + opened[0].length)}\n${head}${html.slice(opened.index + opened[0].length)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  return `${doctype}\n${head}${html.slice(doctype.length)}`;
}
