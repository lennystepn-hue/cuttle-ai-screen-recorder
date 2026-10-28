// Stock media for what a browser cannot draw: footage and photographs from Pexels and Pixabay,
// sound effects from Freesound, with the person's own free keys (PEXELS_API_KEY, PIXABAY_API_KEY,
// FREESOUND_API_KEY, never written anywhere), each with its author and licence. An item is named
// `<source>:<kind>:<id>` (`pexels:video:857195`, `pixabay:photo:2178`, `freesound:sound:41579`).
import { CoreError } from '../errors';
import { fetchJson } from './net';

export const STOCK_KINDS = ['video', 'photo', 'sound'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export const STOCK_SOURCES = ['pexels', 'pixabay', 'freesound'] as const;
export type StockSource = (typeof STOCK_SOURCES)[number];

/** Which sources have which kinds. */
const KINDS: Record<StockSource, readonly StockKind[]> = { pexels: ['video', 'photo'], pixabay: ['video', 'photo'], freesound: ['sound'] };

export interface StockItem {
  /** `<source>:<kind>:<id>`. */
  id: string;
  source: StockSource;
  kind: StockKind;
  title: string;
  width?: number;
  height?: number;
  /** Seconds (a video or a sound). */
  duration?: number;
  author: string;
  /** Its page on the service. */
  page: string;
  /** A picture to look at it by (a video's or a photo's), or a sound's preview to hear. */
  preview?: string;
  license: string;
  licenseUrl: string;
  /** Its licence asks to name its author where it is used (CC-BY), or forbids commercial use (NC). */
  attribution: boolean;
  nonCommercial: boolean;
  /** The file to bring in: the best size for a video of `longSide` px. */
  file: string;
}

/** Each service's key, from the environment, and where to get a free one. */
const KEYS: Record<StockSource, { env: string; signup: string }> = {
  pexels: { env: 'PEXELS_API_KEY', signup: 'https://www.pexels.com/api/' },
  pixabay: { env: 'PIXABAY_API_KEY', signup: 'https://pixabay.com/api/docs/' },
  freesound: { env: 'FREESOUND_API_KEY', signup: 'https://freesound.org/apiv2/apply/' },
};

function keyOf(source: StockSource): string {
  const key = process.env[KEYS[source].env]?.trim();
  if (!key) throw new CoreError('media-key', `${source} needs a key: set ${KEYS[source].env} (a free one at ${KEYS[source].signup}); Cuttle never writes it into a file`);
  return key;
}

/** The sources that have `kind`, in the order they are asked. */
export const sourcesOf = (kind: StockKind): StockSource[] => STOCK_SOURCES.filter((source) => KINDS[source].includes(kind));

/** `<source>:<kind>:<id>` read, or a `usage` error. */
export function stockName(name: string): { source: StockSource; kind: StockKind; id: string } {
  const match = /^(pexels|pixabay|freesound):(video|photo|sound):(\d+)$/.exec(name);
  if (!match || !KINDS[match[1] as StockSource].includes(match[2] as StockKind)) throw new CoreError('usage', `"${name}" is not stock media (pexels:video:<id>, pixabay:photo:<id>, freesound:sound:<id>; media search finds them)`);
  return { source: match[1] as StockSource, kind: match[2] as StockKind, id: match[3]! };
}

const PEXELS_LICENSE = { license: 'Pexels License (free to use, no attribution required)', licenseUrl: 'https://www.pexels.com/license/', attribution: false, nonCommercial: false };
const PIXABAY_LICENSE = { license: 'Pixabay Content License (free to use, no attribution required)', licenseUrl: 'https://pixabay.com/service/license-summary/', attribution: false, nonCommercial: false };

/** A Creative Commons licence by its URL: its name, and whether it asks for the author's name or forbids commercial use. */
function creativeCommons(url: string): Pick<StockItem, 'license' | 'licenseUrl' | 'attribution' | 'nonCommercial'> {
  const zero = /publicdomain\/zero/.test(url);
  const kind = /licenses\/([a-z-]+)\//.exec(url)?.[1] ?? '';
  return { license: zero ? 'CC0 (no rights reserved)' : `CC ${kind.toUpperCase() || 'licence'}`, licenseUrl: url, attribution: !zero, nonCommercial: /nc/.test(kind) };
}

/** The file of `files` (width, height, url) that fits a video `longSide` px across best: the smallest that covers it, else the largest. */
function bestFile<T extends { width: number; height: number; url: string }>(files: readonly T[], longSide: number): T | undefined {
  const sorted = [...files].filter((file) => file.url).sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height));
  return sorted.find((file) => Math.max(file.width, file.height) >= longSide) ?? sorted.at(-1);
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image?: string;
  user?: { name?: string };
  video_files?: { width?: number; height?: number; link?: string; file_type?: string }[];
}
interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt?: string;
  photographer?: string;
  src?: { original?: string; large2x?: string; large?: string; medium?: string };
}
interface PixabayHit {
  id: number;
  pageURL: string;
  tags?: string;
  user?: string;
  duration?: number;
  imageWidth?: number;
  imageHeight?: number;
  webformatURL?: string;
  largeImageURL?: string;
  videos?: Record<string, { url?: string; width?: number; height?: number; thumbnail?: string }>;
}
interface FreesoundSound {
  id: number;
  name?: string;
  duration?: number;
  license?: string;
  username?: string;
  url?: string;
  previews?: Record<string, string>;
}

const FREESOUND_FIELDS = 'id,name,duration,license,username,url,previews';
const titleOfUrl = (url: string) => decodeURIComponent(url.replace(/\/+$/, '').split('/').at(-1) ?? '').replace(/-\d+$/, '').replace(/-/g, ' ');

function pexelsVideo(video: PexelsVideo, longSide: number): StockItem {
  const file = bestFile((video.video_files ?? []).filter((candidate) => !candidate.file_type || candidate.file_type === 'video/mp4').map((candidate) => ({ width: candidate.width ?? 0, height: candidate.height ?? 0, url: candidate.link ?? '' })), longSide);
  return { id: `pexels:video:${video.id}`, source: 'pexels', kind: 'video', title: titleOfUrl(video.url), width: video.width, height: video.height, duration: video.duration, author: video.user?.name ?? 'unknown', page: video.url, ...(video.image && { preview: video.image }), ...PEXELS_LICENSE, file: file?.url ?? '' };
}
function pexelsPhoto(photo: PexelsPhoto): StockItem {
  return { id: `pexels:photo:${photo.id}`, source: 'pexels', kind: 'photo', title: photo.alt || titleOfUrl(photo.url), width: photo.width, height: photo.height, author: photo.photographer ?? 'unknown', page: photo.url, ...(photo.src?.medium && { preview: photo.src.medium }), ...PEXELS_LICENSE, file: photo.src?.large2x ?? photo.src?.original ?? '' };
}
function pixabayHit(hit: PixabayHit, kind: 'video' | 'photo', longSide: number): StockItem {
  const base = { source: 'pixabay' as const, kind, title: hit.tags ?? `${kind} ${hit.id}`, author: hit.user ?? 'unknown', page: hit.pageURL, ...PIXABAY_LICENSE };
  if (kind === 'photo') return { ...base, id: `pixabay:photo:${hit.id}`, width: hit.imageWidth ?? 0, height: hit.imageHeight ?? 0, ...(hit.webformatURL && { preview: hit.webformatURL }), file: hit.largeImageURL ?? hit.webformatURL ?? '' };
  const files = Object.values(hit.videos ?? {}).map((video) => ({ width: video.width ?? 0, height: video.height ?? 0, url: video.url ?? '', thumbnail: video.thumbnail }));
  const file = bestFile(files, longSide);
  return { ...base, id: `pixabay:video:${hit.id}`, ...(file && { width: file.width, height: file.height }), ...(hit.duration !== undefined && { duration: hit.duration }), ...(files.find((candidate) => candidate.thumbnail)?.thumbnail && { preview: files.find((candidate) => candidate.thumbnail)!.thumbnail! }), file: file?.url ?? '' };
}
function freesoundSound(sound: FreesoundSound): StockItem {
  const preview = sound.previews?.['preview-hq-mp3'] ?? sound.previews?.['preview-lq-mp3'] ?? '';
  return { id: `freesound:sound:${sound.id}`, source: 'freesound', kind: 'sound', title: sound.name ?? `sound ${sound.id}`, ...(sound.duration !== undefined && { duration: Math.round(sound.duration * 100) / 100 }), author: sound.username ?? 'unknown', page: sound.url ?? `https://freesound.org/s/${sound.id}/`, ...(preview && { preview }), ...creativeCommons(sound.license ?? ''), file: preview };
}

export interface StockSearch {
  kind?: StockKind;
  source?: StockSource;
  orientation?: 'landscape' | 'portrait' | 'square';
  /** A video's or a sound's length in seconds, at least or at most. */
  minDuration?: number;
  maxDuration?: number;
  limit?: number;
  /** The long side of the video it goes into (picks a video's file). */
  longSide?: number;
}

/** Stock media that shows (or sounds like) `words`, from the first source of the kind with a key, or `source`. */
export async function searchStock(words: readonly string[], options: StockSearch = {}, signal?: AbortSignal): Promise<StockItem[]> {
  const query = words.join(' ').trim();
  if (query === '') throw new CoreError('usage', 'say what it shows or sounds like');
  const kind = options.kind ?? 'video';
  const candidates = options.source ? [options.source] : sourcesOf(kind);
  if (!KINDS[candidates[0]!].includes(kind)) throw new CoreError('usage', `${candidates[0]} has no ${kind}s (${sourcesOf(kind).join(' or ')} has)`);
  // the first of them with a key, so one key is enough
  const source = candidates.find((candidate) => process.env[KEYS[candidate].env]?.trim()) ?? candidates[0]!;
  const key = keyOf(source);
  const limit = Math.min(40, options.limit ?? 20);
  const longSide = options.longSide ?? 1920;
  const q = encodeURIComponent(query);
  let items: StockItem[];
  if (source === 'pexels') {
    const orientation = options.orientation ? `&orientation=${options.orientation}` : '';
    items =
      kind === 'video'
        ? ((await fetchJson<{ videos?: PexelsVideo[] }>(`https://api.pexels.com/videos/search?query=${q}&per_page=${limit}${orientation}`, signal, { authorization: key })).videos ?? []).map((video) => pexelsVideo(video, longSide))
        : ((await fetchJson<{ photos?: PexelsPhoto[] }>(`https://api.pexels.com/v1/search?query=${q}&per_page=${limit}${orientation}`, signal, { authorization: key })).photos ?? []).map(pexelsPhoto);
  } else if (source === 'pixabay') {
    const orientation = options.orientation === 'landscape' ? '&orientation=horizontal' : options.orientation === 'portrait' ? '&orientation=vertical' : '';
    const path = kind === 'video' ? 'api/videos/' : 'api/';
    const found = await fetchJson<{ hits?: PixabayHit[] }>(`https://pixabay.com/${path}?key=${encodeURIComponent(key)}&q=${q}&per_page=${Math.max(3, limit)}&safesearch=true${kind === 'photo' ? '&image_type=photo' : ''}${orientation}`, signal);
    items = (found.hits ?? []).map((hit) => pixabayHit(hit, kind as 'video' | 'photo', longSide));
  } else {
    const range = options.minDuration !== undefined || options.maxDuration !== undefined ? `&filter=${encodeURIComponent(`duration:[${options.minDuration ?? 0} TO ${options.maxDuration ?? '*'}]`)}` : '';
    const found = await fetchJson<{ results?: FreesoundSound[] }>(`https://freesound.org/apiv2/search/text/?query=${q}&fields=${FREESOUND_FIELDS}&page_size=${limit}${range}`, signal, { authorization: `Token ${key}` });
    items = (found.results ?? []).map(freesoundSound);
  }
  return items.filter((item) => item.file !== '' && (options.minDuration === undefined || (item.duration ?? Infinity) >= options.minDuration) && (options.maxDuration === undefined || (item.duration ?? 0) <= options.maxDuration));
}

/** One item of stock media by its name, with the file to bring in. */
export async function stockItem(name: string, longSide = 1920, signal?: AbortSignal): Promise<StockItem> {
  const { source, kind, id } = stockName(name);
  const key = keyOf(source);
  let item: StockItem | undefined;
  if (source === 'pexels') {
    item = kind === 'video' ? pexelsVideo(await fetchJson<PexelsVideo>(`https://api.pexels.com/videos/videos/${id}`, signal, { authorization: key }), longSide) : pexelsPhoto(await fetchJson<PexelsPhoto>(`https://api.pexels.com/v1/photos/${id}`, signal, { authorization: key }));
  } else if (source === 'pixabay') {
    const hit = (await fetchJson<{ hits?: PixabayHit[] }>(`https://pixabay.com/${kind === 'video' ? 'api/videos/' : 'api/'}?key=${encodeURIComponent(key)}&id=${id}`, signal)).hits?.[0];
    item = hit ? pixabayHit(hit, kind as 'video' | 'photo', longSide) : undefined;
  } else {
    item = freesoundSound(await fetchJson<FreesoundSound>(`https://freesound.org/apiv2/sounds/${id}/?fields=${FREESOUND_FIELDS}`, signal, { authorization: `Token ${key}` }));
  }
  if (!item || item.file === '') throw new CoreError('download', `${name} was not found, or has no file to bring in`);
  return item;
}

/** What the credits say of an item: its source, author and licence, and what the licence asks. */
export function stockCreditLine(item: StockItem): string {
  const service = { pexels: 'Pexels', pixabay: 'Pixabay', freesound: 'Freesound' }[item.source];
  return `${service}, a ${item.kind} by ${item.author}${item.attribution ? ' (name the author where the video is shown)' : ''}${item.nonCommercial ? ' (not for commercial use)' : ''}`;
}
