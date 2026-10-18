// The mic's level while it records, from its sound as 16 kHz mono 16-bit samples (the mic's capture
// writes them to its stdout beside the track): how loud it is (RMS) and its loudest sample, in dB
// below full scale, every tenth of a second. The samples themselves go to whoever listens (live
// captions) as whole samples. Pure.

/** The rate of the samples the mic's capture gives (16 kHz mono, as speech recognition takes them too). */
export const PCM_RATE = 16_000;
/** A level is measured over this many seconds. */
export const LEVEL_SECONDS = 0.1;
/** The quietest level told (dBFS): digital silence. */
export const LEVEL_FLOOR = -90;

export interface MicLevel {
  /** How loud, on average (RMS), in dBFS. */
  rms: number;
  /** The loudest sample, in dBFS (0: the mic clips). */
  peak: number;
}

const decibels = (value: number) => (value <= 0 ? LEVEL_FLOOR : Math.max(LEVEL_FLOOR, Math.round(20 * Math.log10(value) * 10) / 10));

/**
 * Hands on the samples as whole samples: a chunk from a pipe may end inside one, so its odd byte is
 * kept for the next chunk. `onSamples` gets each chunk's whole samples (none for an empty chunk).
 */
export function wholeSamples(onSamples: (samples: Uint8Array) => void): (chunk: Uint8Array) => void {
  let half: number | undefined;
  return (chunk) => {
    let bytes = chunk;
    if (half !== undefined && chunk.length > 0) {
      bytes = new Uint8Array(chunk.length + 1);
      bytes[0] = half;
      bytes.set(chunk, 1);
      half = undefined;
    }
    const even = bytes.length - (bytes.length % 2);
    if (even < bytes.length) half = bytes[even];
    if (even > 0) onSamples(bytes.subarray(0, even));
  };
}

/**
 * Takes the samples as they come (a chunk may end inside a sample) and calls `onLevel` once for each
 * tenth of a second of them.
 */
export function levelMeter(onLevel: (level: MicLevel) => void): (chunk: Uint8Array) => void {
  const size = Math.round(PCM_RATE * LEVEL_SECONDS);
  let sum = 0;
  let peak = 0;
  let count = 0;
  return wholeSamples((samples) => {
    for (let i = 0; i < samples.length; i += 2) {
      const value = ((((samples[i + 1]! << 8) | samples[i]!) << 16) >> 16) / 32768;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
      if (++count < size) continue;
      onLevel({ rms: decibels(Math.sqrt(sum / count)), peak: decibels(peak) });
      sum = 0;
      peak = 0;
      count = 0;
    }
  });
}
