/**
 * H.264 High profile levels (ITU-T H.264 Table A-1): the smallest level whose macroblock rate,
 * frame size and bitrate cover the output. High profile allows 1.25 × the Baseline/Main bitrate.
 */
const AVC_LEVELS = [
  { idc: 0x1f, maxMbps: 108_000, maxFs: 3_600, maxKbps: 14_000 }, // 3.1
  { idc: 0x20, maxMbps: 216_000, maxFs: 5_120, maxKbps: 20_000 }, // 3.2
  { idc: 0x28, maxMbps: 245_760, maxFs: 8_192, maxKbps: 20_000 }, // 4
  { idc: 0x29, maxMbps: 245_760, maxFs: 8_192, maxKbps: 50_000 }, // 4.1
  { idc: 0x2a, maxMbps: 522_240, maxFs: 8_704, maxKbps: 50_000 }, // 4.2
  { idc: 0x32, maxMbps: 589_824, maxFs: 22_080, maxKbps: 135_000 }, // 5
  { idc: 0x33, maxMbps: 983_040, maxFs: 36_864, maxKbps: 240_000 }, // 5.1
  { idc: 0x34, maxMbps: 2_073_600, maxFs: 36_864, maxKbps: 240_000 }, // 5.2
  { idc: 0x3c, maxMbps: 4_177_920, maxFs: 139_264, maxKbps: 240_000 }, // 6
  { idc: 0x3d, maxMbps: 8_355_840, maxFs: 139_264, maxKbps: 480_000 }, // 6.1
  { idc: 0x3e, maxMbps: 16_711_680, maxFs: 139_264, maxKbps: 800_000 }, // 6.2
] as const;

/** High profile allows this much more bitrate than the level table lists (Baseline/Main). */
const HIGH_BITRATE_FACTOR = 1.25;

/** Bits per output pixel and frame: about 10 Mbit/s at 1080p30, enough for sharp screen text. */
const BITS_PER_PIXEL = 0.16;

/** Target video bitrate in bit/s for an output size and frame rate. */
export function videoBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * BITS_PER_PIXEL);
}

/**
 * The WebCodecs codec string for H.264 High profile at the smallest level that fits, e.g.
 * `avc1.640028` (level 4) for 1920×1080 or 1080×1920 at 30 fps and 10 Mbit/s.
 */
export function avcCodecString(width: number, height: number, fps: number, bitrate: number): string {
  const mbWidth = Math.ceil(width / 16);
  const mbHeight = Math.ceil(height / 16);
  const frameSize = mbWidth * mbHeight;
  const level = AVC_LEVELS.find(
    (candidate) =>
      frameSize <= candidate.maxFs &&
      // A level also caps each side at sqrt(8 × MaxFS) macroblocks, so very thin frames need a higher level.
      Math.max(mbWidth, mbHeight) <= Math.sqrt(8 * candidate.maxFs) &&
      frameSize * fps <= candidate.maxMbps &&
      bitrate <= candidate.maxKbps * 1000 * HIGH_BITRATE_FACTOR,
  );
  if (!level) throw new Error(`avcCodecString: ${width}×${height} at ${fps} fps and ${bitrate} bit/s exceeds H.264 level 6.2`);
  return `avc1.6400${level.idc.toString(16).padStart(2, '0')}`;
}
