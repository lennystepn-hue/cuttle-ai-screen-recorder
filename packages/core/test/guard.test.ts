import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from '@cuttle/project';
import { guardCut, quietStretches } from '../src/speech/guard';

const said = (...items: [number, number, string][]): TranscriptWord[] => items.map(([t, end, text]) => ({ t, end, text }));

/** Mic levels every 10 ms: `loud` stretches at -20 dB over a -60 dB floor, `seconds` long. */
function levels(seconds: number, loud: [number, number][]): Float32Array {
  const values = new Float32Array(Math.round(seconds * 100)).fill(-60);
  for (const [from, to] of loud) values.fill(-20, Math.round(from * 100), Math.round(to * 100));
  return values;
}

describe("the mic's quiet", () => {
  it('lies between the loud stretches, before the mic starts and after it ends, on the screen track’s time', () => {
    expect(quietStretches(levels(3, [[0.5, 1], [1.8, 2.4]]))).toEqual([
      { from: -Infinity, to: 0.5 },
      { from: 1, to: 1.8 },
      { from: 2.4, to: Infinity },
    ]);
    // the mic started 0.2 s after the screen, and began loud
    expect(quietStretches(levels(2, [[0, 0.5]]), 0.2)).toEqual([
      { from: -Infinity, to: 0.2 },
      { from: 0.7, to: Infinity },
    ]);
  });

  it('leaves out a gap shorter than a word’s stop, and says nothing when the mic hears no speech', () => {
    expect(quietStretches(levels(2, [[0.5, 0.8], [0.84, 1.2]]))).toEqual([
      { from: -Infinity, to: 0.5 },
      { from: 1.2, to: Infinity },
    ]);
    expect(quietStretches(new Float32Array(200).fill(-50))).toBeUndefined();
  });
});

describe('a speech cut in the quiet', () => {
  // "Erstens [quiet] äh [quiet] zweitens", the mic's truth; whisper's times are given per case
  const quiet = quietStretches(levels(6, [[1, 1.6], [2.4, 2.7], [3.6, 4.4]]))!;

  it('stays as it is where its edges are quiet', () => {
    const words = said([1, 1.6, 'Erstens'], [2.4, 2.7, 'äh'], [3.6, 4.4, 'zweitens']);
    expect(guardCut({ from: 2.3, to: 2.8 }, words, quiet)).toEqual({ from: 2.3, to: 2.8 });
  });

  it('moves an edge out of a word whisper placed wrong, to the nearest quiet, never past the words that stay', () => {
    // whisper heard "äh" later than it was said (2.5–2.8): the cut began in its sound
    const late = said([1, 1.6, 'Erstens'], [2.5, 2.8, 'äh'], [3.6, 4.4, 'zweitens']);
    expect(guardCut({ from: 2.45, to: 2.85 }, late, quiet)).toEqual({ from: 2.37, to: 2.85 });
    // a pause cut whose end reached into "zweitens", which whisper heard 0.2 s late: it ends 0.15 s before the word
    const early = said([1, 1.6, 'Erstens'], [3.8, 4.4, 'zweitens']);
    expect(guardCut({ from: 1.8, to: 3.65 }, early, quiet)).toEqual({ from: 1.8, to: 3.45 });
  });

  it('keeps a little quiet next to the sound that stays, as much as there is', () => {
    const words = said([1, 1.6, 'Erstens'], [3.6, 4.4, 'zweitens']);
    // the mic's quiet starts at 1.6: the cut keeps 0.15 s of it after "Erstens"
    expect(guardCut({ from: 1.65, to: 3.4 }, words, quiet)).toEqual({ from: 1.75, to: 3.4 });
    // a short quiet: its middle part, `margin` from both ends
    const short = quietStretches(levels(6, [[1, 1.6], [1.7, 2.7], [3.6, 4.4]]))!;
    expect(guardCut({ from: 1.65, to: 3.4 }, words, short)).toEqual({ from: 1.67, to: 3.4 });
  });

  it('is left out where no quiet lies near enough between the words around it', () => {
    // a filler glued to the word before it: no quiet in reach before its sound
    const glued = quietStretches(levels(6, [[1, 2.7], [3.6, 4.4]]))!;
    const words = said([1, 1.6, 'Erstens'], [2.4, 2.7, 'äh'], [3.6, 4.4, 'zweitens']);
    expect(guardCut({ from: 2.35, to: 2.8 }, words, glued)).toBeUndefined();
  });
});
