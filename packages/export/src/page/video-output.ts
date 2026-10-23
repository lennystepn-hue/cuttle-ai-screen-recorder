import type { Output as OutputSettings } from '@cuttle/project';
import { CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, WebMOutputFormat, type StreamTargetChunk } from 'mediabunny';
import { avcCodecString, videoBitrate } from '../codec';
import type { EncoderPreference } from '../job';
import { host, PageError } from './host';

type Acceleration = 'prefer-hardware' | 'prefer-software';

/** Seconds between key frames. */
const KEY_FRAME_INTERVAL = 2;
/** Bytes collected before one write to the main process. */
const WRITE_CHUNK_BYTES = 8 * 1024 * 1024;

export interface VideoOutput {
  codec: string;
  hardwareAcceleration: Acceleration;
  bitrate: number;
  /** Encodes the canvas as it is now; resolves when the encoder and the writer can take more. */
  add(timestamp: number, duration: number): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
}

const CANDIDATES: Record<EncoderPreference, Acceleration[]> = {
  auto: ['prefer-hardware', 'prefer-software'],
  hardware: ['prefer-hardware'],
  software: ['prefer-software'],
};

async function chooseAcceleration(codec: string, settings: OutputSettings, bitrate: number, preference: EncoderPreference): Promise<Acceleration> {
  for (const hardwareAcceleration of CANDIDATES[preference]) {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec,
      width: settings.width,
      height: settings.height,
      framerate: settings.fps,
      bitrate,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      hardwareAcceleration,
      avc: { format: 'avc' },
    });
    if (supported) return hardwareAcceleration;
  }
  throw new PageError('render', `no ${preference === 'auto' ? '' : `${preference} `}H.264 encoder for ${codec} at ${settings.width}×${settings.height}, ${settings.fps} fps`);
}

/**
 * H.264 High encoder plus MP4 muxer for the canvas. The MP4 (video only, moov at the end) streams
 * to the main process in chunks; ffmpeg moves the moov to the front when it adds the audio.
 */
export async function createVideoOutput(canvas: OffscreenCanvas, settings: OutputSettings, preference: EncoderPreference): Promise<VideoOutput> {
  const bitrate = videoBitrate(settings.width, settings.height, settings.fps);
  const codec = avcCodecString(settings.width, settings.height, settings.fps, bitrate);
  const hardwareAcceleration = await chooseAcceleration(codec, settings, bitrate, preference);
  const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => host().write(chunk.data, chunk.position) });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true, chunkSize: WRITE_CHUNK_BYTES }),
  });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    fullCodecString: codec,
    quality: new Quality({ bitrate, bitrateMode: 'variable' }),
    keyFrameInterval: KEY_FRAME_INTERVAL,
    latencyMode: 'quality',
    hardwareAcceleration,
  });
  output.addVideoTrack(source, { frameRate: settings.fps });
  await output.start();
  return {
    codec,
    hardwareAcceleration,
    bitrate,
    add: (timestamp, duration) => source.add(timestamp, duration),
    finalize: () => output.finalize(),
    cancel: () => output.cancel(),
  };
}

/**
 * VP9 with its alpha (the canvas's transparency) plus a WebM muxer, for a video another editor lays
 * over its own (`transparent`). VP9 keeps the alpha beside each frame; software encodes it, on every
 * system. The WebM streams to the main process as the MP4 does.
 */
export async function createAlphaOutput(canvas: OffscreenCanvas, settings: OutputSettings): Promise<VideoOutput> {
  const bitrate = videoBitrate(settings.width, settings.height, settings.fps);
  const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => host().write(chunk.data, chunk.position) });
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new StreamTarget(writable, { chunked: true, chunkSize: WRITE_CHUNK_BYTES }),
  });
  const source = new CanvasSource(canvas, {
    codec: 'vp9',
    quality: new Quality({ bitrate, bitrateMode: 'variable' }),
    keyFrameInterval: KEY_FRAME_INTERVAL,
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-software',
    alpha: 'keep',
  });
  output.addVideoTrack(source, { frameRate: settings.fps });
  await output.start();
  return {
    codec: 'vp9',
    hardwareAcceleration: 'prefer-software',
    bitrate,
    add: (timestamp, duration) => source.add(timestamp, duration),
    finalize: () => output.finalize(),
    cancel: () => output.cancel(),
  };
}
