// The project's media in the editor, read through the cuttle-media protocol (Range requests).
import { ALL_FORMATS, Input, UrlSource, type InputAudioTrack, type InputVideoTrack, type VideoSinkDecoderOptions } from 'mediabunny';
import { createCursorTrack, type CursorTrack } from '@cuttle/timeline';
import { parseEventsJsonl, parseMarkersJson, parseProject, type CuttleProject, type InputEvent, type Marker } from '@cuttle/project';
import { plainIssue } from '../../shared/format';
import { MEDIA_ORIGIN, type ProjectInfo } from '../../shared/ipc';

/** Whether a path of cuttle.json points outside the project folder (`../x`, `C:\x`, `/x`): the editor reads only its own project. */
export function outsideProject(path: string): boolean {
  const normal = path.replaceAll('\\', '/');
  return normal.startsWith('/') || /^[A-Za-z]:/.test(normal) || normal.split('/').includes('..');
}

/** The protocol URL of a path inside the project (as cuttle.json writes it, forward or back slashes). */
export function mediaUrl(path: string): string {
  if (outsideProject(path)) throw new MediaError(`${path} lies outside the project folder. The editor reads only files inside it; copy the file into the project.`);
  return `${MEDIA_ORIGIN}/${path.replaceAll('\\', '/').split('/').filter((part) => part !== '' && part !== '.').map(encodeURIComponent).join('/')}`;
}

/** Whether a file of the project is there (one byte of it is read; an empty file answers 416 and is there too). */
async function present(path: string): Promise<boolean> {
  const response = await fetch(mediaUrl(path), { headers: { Range: 'bytes=0-0' } }).catch(() => undefined);
  await response?.body?.cancel();
  return response !== undefined && response.status !== 404;
}

const missing = (path: string) => new MediaError(`${path} is missing from the project folder.`);

export interface VideoSource {
  /** Project-relative path. */
  path: string;
  input: Input;
  track: InputVideoTrack;
  size: { width: number; height: number };
  /** Timestamp of the first frame and the end of the last one, in seconds. */
  start: number;
  end: number;
  decoder: VideoSinkDecoderOptions;
}

export interface AudioSource {
  input: Input;
  track: InputAudioTrack;
  /** Seconds after the screen track that it started. */
  offset: number;
}

/** A problem with the project or one of its files, said for people. */
export class MediaError extends Error {}

/**
 * Decoder options for a track: software first (it decodes faster here and leaves the GPU's video
 * engine to the export), any decoder when only a hardware one handles the codec.
 */
async function decoderFor(track: InputVideoTrack): Promise<VideoSinkDecoderOptions | undefined> {
  const config = await track.getDecoderConfig();
  if (!config) return undefined;
  for (const hardwareAcceleration of ['prefer-software', 'no-preference'] as const) {
    if ((await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration })).supported) return { hardwareAcceleration };
  }
  return undefined;
}

export async function openVideo(path: string, what: string): Promise<VideoSource> {
  const input = new Input({ source: new UrlSource(mediaUrl(path)), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new MediaError(`${what} has no video track (${path})`);
    const decoder = await decoderFor(track);
    if (!decoder) throw new MediaError(`${what} uses a codec Cuttle cannot decode (${await track.getCodecParameterString()})`);
    const size = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
    if (!(size.width > 0 && size.height > 0)) throw new MediaError(`${what} does not say its frame size; a take cut off by a crash needs "cuttle recover"`);
    const start = await input.getFirstTimestamp([track]);
    const end = await input.computeDuration([track]);
    if (!(end > start)) throw new MediaError(`${what} has no frames (${path})`);
    return { path, input, track, size, start, end, decoder };
  } catch (error) {
    input.dispose();
    if (error instanceof MediaError) throw error;
    if (!(await present(path))) throw missing(path);
    throw new MediaError(`${what} (${path}) cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openAudio(path: string, offset: number): Promise<AudioSource | undefined> {
  const input = new Input({ source: new UrlSource(mediaUrl(path)), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return undefined;
    }
    return { input, track, offset };
  } catch {
    input.dispose();
    return undefined;
  }
}

async function fetchText(path: string): Promise<string | undefined> {
  const response = await fetch(mediaUrl(path)).catch(() => undefined);
  return response?.ok ? response.text() : undefined;
}

/** An image for the engine: premultiplied, not flipped, at most `maxSize` on its longer side. */
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const response = await fetch(mediaUrl(path)).catch(() => undefined);
  if (!response?.ok) throw missing(path);
  const blob = await response.blob();
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, options);
  } catch {
    throw new MediaError(`${what} (${path}) is not an image Cuttle can decode.`);
  }
  const longer = Math.max(bitmap.width, bitmap.height);
  if (longer <= maxSize) return bitmap;
  const scale = maxSize / longer;
  const resizeWidth = Math.max(1, Math.floor(bitmap.width * scale));
  const resizeHeight = Math.max(1, Math.floor(bitmap.height * scale));
  bitmap.close();
  return createImageBitmap(blob, { ...options, resizeWidth, resizeHeight, resizeQuality: 'high' });
}

/** The issues of a cuttle.json that does not parse, one plain line each. */
export function projectIssues(issues: readonly { path: string; message: string }[]): string {
  return issues.map((issue) => plainIssue(`${issue.path}: ${issue.message}`)).join('\n');
}

/** What shows for an image that cannot be read: a quiet page that names the file (a plain one behind the video). */
async function placeholder(path?: string): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(1600, 1000);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#232329';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#9a9aa5';
  context.font = '500 44px system-ui, sans-serif';
  context.textAlign = 'center';
  if (path) context.fillText(`${path} is missing`, canvas.width / 2, canvas.height / 2);
  return createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' });
}

/**
 * Everything the editor shows of a project. The take's tracks are opened once; images, the webcam
 * and the mic are opened when the project first needs them (an edit can add a page or turn the
 * webcam on), see `ensureMedia`.
 */
export interface EditorMedia {
  screen: VideoSource;
  webcam?: VideoSource & { offset: number };
  mic?: AudioSource;
  events: InputEvent[];
  /** The pointer's track from the input events (drawn when the look's cursor is on). */
  cursor?: CursorTrack;
  markers: Marker[];
  /** Still images by their project path. */
  stills: Map<string, ImageBitmap>;
  backgroundImage?: ImageBitmap;
  /** The path `backgroundImage` was read from. */
  backgroundPath?: string;
  /** Seconds after the screen track that the webcam and the mic started. */
  offsets: ProjectInfo['offsets'];
  /** Sources tried and failed (not tried again), and warnings for people (a missing webcam file …). */
  failed: Set<string>;
  warnings: string[];
}

/** Larger images are scaled down: textures of 8192 px work on every GPU Cuttle runs on. */
const MAX_IMAGE = 8192;

/** A file the editor works without: its problem becomes a warning (once). */
async function optional<T>(media: Pick<EditorMedia, 'warnings' | 'failed'>, key: string, work: () => Promise<T>): Promise<T | undefined> {
  if (media.failed.has(key)) return undefined;
  try {
    return await work();
  } catch (error) {
    media.failed.add(key);
    media.warnings.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export async function openProjectMedia(info: ProjectInfo, project: CuttleProject): Promise<EditorMedia> {
  const { sources } = project;
  const screen = await openVideo(sources.screen, 'The screen recording');
  const media: EditorMedia = { screen, events: [], markers: [], stills: new Map(), offsets: info.offsets, failed: new Set(), warnings: [] };
  if (sources.events) {
    const text = await optional(media, sources.events, async () => {
      const found = await fetchText(sources.events!);
      if (found === undefined) throw new MediaError(`${sources.events} cannot be read: no cursor or input activity.`);
      return found;
    });
    if (text !== undefined) media.events = parseEventsJsonl(text).events;
  }
  if (media.events.length > 0) media.cursor = createCursorTrack(media.events);
  if (sources.markers) {
    const text = await optional(media, sources.markers, async () => (await fetchText(sources.markers!)) ?? '');
    const parsedMarkers = parseMarkersJson(text ?? '');
    if (parsedMarkers.ok) media.markers = parsedMarkers.markers;
  }
  await ensureMedia(media, project);
  return media;
}

/**
 * Opens what `project` needs and `media` lacks: the images of its stills (a placeholder for one
 * that cannot be read), the background image, the webcam when the look shows it, the mic when the
 * look plays it. Returns whether anything was added.
 */
export async function ensureMedia(media: EditorMedia, project: CuttleProject): Promise<boolean> {
  const { sources, look } = project;
  let added = false;
  for (const scene of project.scenes) {
    if (scene.type !== 'still' || media.stills.has(scene.image)) continue;
    media.stills.set(scene.image, (await optional(media, scene.image, () => loadImage(scene.image, MAX_IMAGE, 'The image of a page'))) ?? (await placeholder(scene.image)));
    added = true;
  }
  const background = look.background.preset === 'image' ? look.background.image : undefined;
  if (background && media.backgroundPath !== background) {
    media.backgroundImage = (await optional(media, background, () => loadImage(background, MAX_IMAGE, 'The background image'))) ?? (await placeholder());
    media.backgroundPath = background;
    added = true;
  }
  if (sources.webcam && look.webcam.enabled && !media.webcam) {
    const video = await optional(media, sources.webcam, () => openVideo(sources.webcam!, 'The webcam recording'));
    if (video) {
      media.webcam = { ...video, offset: media.offsets.webcam };
      added = true;
    }
  }
  if (sources.mic && look.audio.enabled && !media.mic) {
    const mic = await optional(media, sources.mic, async () => {
      const audio = await openAudio(sources.mic!, media.offsets.mic);
      if (audio) return audio;
      throw (await present(sources.mic!)) ? new MediaError(`The mic recording (${sources.mic}) cannot be played.`) : missing(sources.mic!);
    });
    if (mic) {
      media.mic = mic;
      added = true;
    }
  }
  return added;
}
