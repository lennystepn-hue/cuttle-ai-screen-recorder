// What `cuttle blocks` reads from the network: only from the hosts of the collections and the CDNs
// their pages load from, each file at most so large, within a time. CUTTLE_BLOCKS_PROXY (the tests'
// local server) gets every request instead, as `<proxy>/<host><path>`.
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { brandsDir } from '../brands';
import { CoreError } from '../errors';

/** The hosts blocks come from, and what their pages load (scripts, modules, fonts, images, previews). */
export const BLOCK_HOSTS: readonly string[] = [
  'raw.githubusercontent.com',
  'api.github.com',
  'static.heygen.ai',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'lottie.host',
  'assets.lottiefiles.com',
  'assets-v2.lottiefiles.com',
  'api.iconify.design',
  // stock footage, photographs and sounds (media.ts), with the person's own keys
  'api.pexels.com',
  'videos.pexels.com',
  'images.pexels.com',
  'pixabay.com',
  'cdn.pixabay.com',
  'freesound.org',
  'cdn.freesound.org',
];

/** The largest file a block may bring. */
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
/** A browser's name: Google Fonts answers it with woff2 files. */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Where downloaded catalogues are kept: CUTTLE_BLOCKS_CACHE, else beside the brand kits (Cuttle's user data). */
export function blocksCache(): string {
  return process.env.CUTTLE_BLOCKS_CACHE || join(dirname(brandsDir()), 'blocks');
}

/** Whether a block may load `url` (https from one of BLOCK_HOSTS). */
export function allowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && BLOCK_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** `url` as it may be said: an API key in its query left out. */
export const sayable = (url: string): string => url.replace(/([?&](?:key|token)=)[^&]+/gi, '$1…');

/** The bytes at `url` (from an allowed host, with `headers`), or a `download` error that says why not. */
export async function fetchBytes(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<Uint8Array> {
  if (!allowedUrl(url)) throw new CoreError('download', `${sayable(url)} is not on a host blocks come from (${BLOCK_HOSTS.join(', ')})`);
  const proxy = process.env.CUTTLE_BLOCKS_PROXY;
  const parsed = new URL(url);
  const target = proxy ? `${proxy.replace(/\/+$/, '')}/${parsed.hostname}${parsed.pathname}${parsed.search}` : url;
  let response: Response;
  try {
    response = await fetch(target, { redirect: 'follow', headers: { 'user-agent': USER_AGENT, ...headers }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (signal?.aborted) throw new CoreError('cancelled', 'cancelled');
    throw new CoreError('download', `${sayable(url)} could not be fetched: ${sayable((error as Error).message)}`);
  }
  if (response.status === 401 || response.status === 403) throw new CoreError('media-key', `${sayable(url)} refused the key (HTTP ${response.status})`);
  if (!response.ok) throw new CoreError('download', `${sayable(url)} answered HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new CoreError('download', `${sayable(url)} is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  return bytes;
}

export async function fetchText(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<string> {
  return new TextDecoder().decode(await fetchBytes(url, signal, headers));
}

export async function fetchJson<T>(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
  const text = await fetchText(url, signal, headers);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CoreError('download', `${sayable(url)} is not JSON`);
  }
}

/** A file name for what `url` holds: readable, short, unique (a hash of the whole URL), with `extension`. */
export function fileNameOf(url: string, extension: string): string {
  const parsed = new URL(url);
  const stem = `${parsed.hostname.split('.').slice(-2, -1)[0] ?? 'file'}-${parsed.pathname}`
    .toLowerCase()
    .replace(/\.(m?js|css|woff2?|ttf|otf|json|png|jpe?g|svg|webp|gif)$/, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-48);
  return `${stem}-${createHash('sha256').update(url).digest('hex').slice(0, 8)}${extension}`;
}

/** Runs `job` over `items`, at most `limit` at once, in their order. */
export async function inBatches<T, R>(items: readonly T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await job(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
