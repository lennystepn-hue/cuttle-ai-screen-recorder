import { transcribeTake, type TranscribeResult } from '@cuttle/core';
import type { Output } from '../output';

/** Calls `report` with whole percents, every `step` of them (and at 100). */
export function percentSteps(report: (percent: number) => void, step = 10): (fraction: number) => void {
  let last = -step;
  return (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent >= last + step || (percent === 100 && last !== 100)) {
      last = percent - (percent % step);
      report(percent);
    }
  };
}

/**
 * `cuttle transcribe`: what the mic said, word by word, written to takes/<n>/transcript.json and
 * linked from cuttle.json (see @cuttle/core's transcribeTake).
 */
export async function transcribeCommand(projectDir: string, args: { model?: string; language?: string }, output: Output, signal: AbortSignal): Promise<TranscribeResult> {
  const result = await transcribeTake(projectDir, {
    ...args,
    signal,
    onStatus: (text) => output.info(text),
    onProgress: percentSteps((percent) => output.info(`transcribing … ${percent} %`)),
  });
  output.result(result, () =>
    [
      ...result.notes.map((note) => `- ${note}`),
      `${result.words} words (${result.language}, ${result.model} model) in ${result.transcript}`,
      'next: cuttle suggest (it cuts filler words and pauses)',
    ].join('\n'),
  );
  return result;
}
