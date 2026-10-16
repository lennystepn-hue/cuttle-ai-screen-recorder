import { ALL_FORMATS, CustomSource, Input, type InputVideoTrack } from 'mediabunny';
import { host, PageError } from './host';

/** An opened video file: its first video track, display size and time range in seconds. */
export interface VideoFile {
  input: Input;
  track: InputVideoTrack;
  size: { width: number; height: number };
  /** Timestamp of the first frame and end of the last one. */
  start: number;
  end: number;
}

/**
 * Opens a video through the main process, reading only the byte ranges the demuxer asks for.
 * Fragmented MP4 (what the recorder writes) works, including a file cut off by a crash.
 */
export async function openVideo(path: string, what: string): Promise<VideoFile> {
  const source = new CustomSource({
    getSize: () => host().size(path),
    read: (start, end) => host().read(path, start, end),
    prefetchProfile: 'fileSystem',
  });
  const input = new Input({ source, formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new PageError('invalid-media', `${what} has no video track: ${path}`);
    if (!(await track.canDecode())) {
      throw new PageError('invalid-media', `${what} uses a codec this build cannot decode (${await track.getCodecParameterString()}): ${path}`);
    }
    const size = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
    if (!(size.width > 0 && size.height > 0)) {
      throw new PageError('invalid-media', `${what} does not say its frame size (a take cut off by a crash? run cuttle recover): ${path}`);
    }
    const start = await input.getFirstTimestamp([track]);
    const end = await input.computeDuration([track]);
    if (!(end > start)) throw new PageError('invalid-media', `${what} has no frames: ${path}`);
    return { input, track, size, start, end };
  } catch (error) {
    input.dispose();
    if (error instanceof PageError) throw error;
    throw new PageError('invalid-media', `${what} could not be read (${error instanceof Error ? error.message : String(error)}): ${path}`);
  }
}
