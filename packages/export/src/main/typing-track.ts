// The typing sounds' track of an export: the clicks mixed block by block into a WAV in the export's
// work folder (16-bit mono at the export's rate), as long as the video, so a long video needs no
// more memory than a block.
import { open } from 'node:fs/promises';
import { mixTyping, type TypingClick } from '@cuttle/timeline';
import { AUDIO_SAMPLE_RATE } from '../audio';

/** Samples mixed at a time: 10 s. */
const BLOCK = AUDIO_SAMPLE_RATE * 10;

/** A WAV header for `samples` 16-bit mono samples at the export's rate. */
export function wavHeader(samples: number): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + samples * 2, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  head.writeUInt32LE(AUDIO_SAMPLE_RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(samples * 2, 40);
  return head;
}

/** Writes the clicks (sorted, on the output timeline) at `volume` into a WAV `seconds` long at `path`. */
export async function writeTypingTrack(path: string, clicks: readonly TypingClick[], volume: number, seconds: number): Promise<void> {
  const total = Math.round(seconds * AUDIO_SAMPLE_RATE);
  const file = await open(path, 'w');
  try {
    await file.write(wavHeader(total));
    for (let start = 0; start < total; start += BLOCK) {
      const block = new Float32Array(Math.min(BLOCK, total - start));
      mixTyping(clicks, volume, block, start, AUDIO_SAMPLE_RATE);
      const bytes = Buffer.alloc(block.length * 2);
      for (let i = 0; i < block.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, block[i]!)) * 32767), i * 2);
      await file.write(bytes);
    }
  } finally {
    await file.close();
  }
}
