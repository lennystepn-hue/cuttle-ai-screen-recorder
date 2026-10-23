// The project's media in the editor, read through the cuttle-media protocol (Range requests).
import { ALL_FORMATS, Input, UrlSource, type InputAudioTrack, type InputVideoTrack, type VideoSinkDecoderOptions } from 'mediabunny';
import { createCursorTrack, shortcutsOf, type CursorTrack, type Shortcut } from '@cuttle/timeline';
import { parseEventsJsonl, parseMarkersJson, parseProject, parseTranscriptJson, parseTranslationJson, type TranslatedSentence, type CuttleProject, type InputEvent, type Marker, type TranscriptFile, parseVoiceRender, showsCamera, speaks, voiceLineKey, voiceRenderFiles, type VoiceRender } from '@cuttle/project';
import { isSvg, svgBitmap } from '@cuttle/export/svg';
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
  // an SVG (a logo): drawn by an image, at a size of its own
  if (isSvg(path)) return svgBitmap(new Uint8Array(await response.arrayBuffer())).catch(() => Promise.reject(new MediaError(`${what} (${path}) is not an SVG Cuttle can draw.`)));
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
  /** The take's screen track; none in a video without a recording (no clip shows one), as the export renders it. */
  screen?: VideoSource;
  /** The take's frame size: the screen track's, else the output's, where nothing of a take shows. */
  screenSize: { width: number; height: number };
  /** The recorded display's pixels per point (take.json), when it says: zooms are sized by it. */
  scale?: number;
  webcam?: VideoSource & { offset: number };
  mic?: AudioSource;
  /** The file `mic` was opened from: the mic, or its cleaned-up copy (`look.audio.cleanup`). */
  micPath?: string;
  /** What the computer played (`sources.system`), while the look plays it. */
  system?: AudioSource;
  /** The narration's lines as spoken (`voiceover/<key>.json`), by their key: the player plays them, the captions show their words. */
  narration: Map<string, VoiceRender>;
  events: InputEvent[];
  /** The pointer's track from the input events (drawn when the look's cursor is on). */
  cursor?: CursorTrack;
  /** The shortcuts the take logged, for their badges (`look.keys`). */
  shortcuts?: Shortcut[];
  markers: Marker[];
  /** What the mic said (`sources.transcript`), and the path it was read from: it can be linked after the editor opened. */
  transcript?: TranscriptFile;
  transcriptPath?: string;
  /** The subtitles' translation the picture shows (`captions.language`), and the path it was read from. */
  translation?: { language: string; sentences: TranslatedSentence[] };
  translationPath?: string;
  /** Still images by their project path. */
  stills: Map<string, ImageBitmap>;
  backgroundImage?: ImageBitmap;
  /** The path `backgroundImage` was read from. */
  backgroundPath?: string;
  /** The watermark's image (its own, else the brand's logo), and the path it was read from. */
  watermarkImage?: ImageBitmap;
  watermarkPath?: string;
  /** Seconds after the screen track that the webcam, the mic and the system audio started. */
  offsets: ProjectInfo['offsets'];
  /** Sources tried and failed (not tried again), and warnings for people (a missing webcam file …). */
  failed: Set<string>;
  warnings: string[];
}

/** The keys of the narration's enabled lines the editor has no render of (not spoken yet, or not read yet). */
export function unspokenLines(media: Pick<EditorMedia, 'narration'>, project: CuttleProject): string[] {
  if (!project.look.audio.enabled) return [];
  return project.voiceover.lines.filter(speaks).map((line) => voiceLineKey(project.voiceover, line)).filter((key) => !media.narration.has(key));
}

/** The watermark's image file, when it is on: its own, else the brand's logo. */
export function watermarkFile(project: CuttleProject): string | undefined {
  return project.look.watermark.enabled ? (project.look.watermark.image ?? project.theme.logo) : undefined;
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
  // a video of motion scenes, stills and cards shows nothing of a take: it opens without one
  const clips = project.scenes.some((scene) => scene.type === 'clip');
  const screen = clips || (await present(sources.screen)) ? await openVideo(sources.screen, 'The screen recording') : undefined;
  const screenSize = screen?.size ?? { width: project.output.width, height: project.output.height };
  const media: EditorMedia = { ...(screen && { screen }), screenSize, ...(info.scale !== undefined && { scale: info.scale }), events: [], markers: [], stills: new Map(), narration: new Map(), offsets: info.offsets, failed: new Set(), warnings: [] };
  if (sources.events) {
    const text = await optional(media, sources.events, async () => {
      const found = await fetchText(sources.events!);
      if (found === undefined) throw new MediaError(`${sources.events} cannot be read: no cursor or input activity.`);
      return found;
    });
    if (text !== undefined) media.events = parseEventsJsonl(text).events;
  }
  if (media.events.length > 0) media.cursor = createCursorTrack(media.events);
  const shortcuts = shortcutsOf(media.events);
  if (shortcuts.length > 0) media.shortcuts = shortcuts;
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
 * that cannot be read), the background image, the webcam when the look shows it, the mic and the
 * system audio when the look plays them. Returns whether anything was added.
 */
export async function ensureMedia(media: EditorMedia, project: CuttleProject): Promise<boolean> {
  const { sources, look } = project;
  let added = false;
  if (sources.transcript !== media.transcriptPath) {
    // the speech edits link the transcript once it is there; Undo can take it away again
    media.transcriptPath = sources.transcript;
    delete media.transcript;
    if (sources.transcript) {
      const path = sources.transcript;
      const text = await optional(media, path, async () => {
        const found = await fetchText(path);
        if (found === undefined) throw new MediaError(`${path} cannot be read: no subtitles.`);
        return found;
      });
      const parsed = text === undefined ? undefined : parseTranscriptJson(text);
      if (parsed?.ok) media.transcript = parsed.transcript;
      else if (parsed) media.warnings.push(`${path} is invalid: no subtitles.`);
    }
    added = true;
  }
  // the subtitles in another language, when the picture shows one
  const language = project.captions.language;
  const translationPath = language ? project.captions.translations?.[language] : undefined;
  if (translationPath !== media.translationPath) {
    media.translationPath = translationPath;
    delete media.translation;
    if (language && translationPath) {
      const text = await optional(media, translationPath, async () => {
        const found = await fetchText(translationPath);
        if (found === undefined) throw new MediaError(`${translationPath} cannot be read: the subtitles show as spoken.`);
        return found;
      });
      const parsed = text === undefined ? undefined : parseTranslationJson(text);
      if (parsed?.ok) media.translation = { language, sentences: parsed.translation.sentences };
      else if (parsed) media.warnings.push(`${translationPath} is invalid: the subtitles show as spoken.`);
    }
    added = true;
  }
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
  const mark = watermarkFile(project);
  if (mark && media.watermarkPath !== mark) {
    // without it the watermark shows its text
    media.watermarkImage = await optional(media, mark, () => loadImage(mark, MAX_IMAGE, 'The watermark image'));
    media.watermarkPath = mark;
    added = true;
  }
  if (sources.webcam && showsCamera(project) && !media.webcam) {
    const video = await optional(media, sources.webcam, () => openVideo(sources.webcam!, 'The webcam recording'));
    if (video) {
      media.webcam = { ...video, offset: media.offsets.webcam };
      added = true;
    }
  }
  // the cleaned-up mic plays in the mic's place when the look asks for it and there is one
  const micPath = sources.mic && (look.audio.cleanup && sources.cleanMic ? sources.cleanMic : sources.mic);
  if (micPath && look.audio.enabled && media.micPath !== micPath) {
    const mic = await optional(media, micPath, async () => {
      const audio = await openAudio(micPath, media.offsets.mic);
      if (audio) return audio;
      throw (await present(micPath)) ? new MediaError(`The mic recording (${micPath}) cannot be played.`) : missing(micPath);
    });
    if (mic) {
      media.mic = mic;
      media.micPath = micPath;
      added = true;
    }
  }
  const system = sources.system;
  if (system && look.audio.enabled && look.audio.system && !media.system) {
    const audio = await optional(media, system, async () => {
      const opened = await openAudio(system, media.offsets.system);
      if (opened) return opened;
      throw (await present(system)) ? new MediaError(`The computer's sound (${system}) cannot be played.`) : missing(system);
    });
    if (audio) {
      media.system = audio;
      added = true;
    }
  }
  // the narration's lines spoken since (a line not spoken yet is looked for again after the next edit)
  for (const key of unspokenLines(media, project)) {
    const text = await fetchText(voiceRenderFiles(key).render);
    const parsed = text === undefined ? undefined : parseVoiceRender(text);
    if (!parsed?.ok) continue;
    media.narration.set(key, parsed.render);
    added = true;
  }
  return added;
}
