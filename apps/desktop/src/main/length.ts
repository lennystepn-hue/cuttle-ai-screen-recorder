// The length fit in the app: the editor's Length control asks for a length, the media worker cuts
// where the video rests (or takes the fit out), and the change arrives as one step to undo
// ("Cuttle's length fit"). The control waits for the answer: it says whether the video fits.
import { readProjectFile } from '@cuttle/core';
import type { LengthReport } from '../shared/media-jobs';
import { mediaWorker } from './media-service';
import { expectLength, setEditorStatus } from './windows';

/** Projects being fitted now (their folders, as given). */
const fitting = new Set<string>();

/** The SHA-256 of cuttle.json as it is now (undefined: it cannot be read). */
const hashOf = async (dir: string) => (await readProjectFile(dir).catch(() => undefined))?.hash;

/** Fits the project to `seconds` of video, or takes the fit out (`null`); the report, or why it could not. */
export async function fitProjectLength(dir: string, seconds: number | null): Promise<{ report: LengthReport } | { problem: string }> {
  if (fitting.has(dir)) return { problem: 'The video is being fitted already.' };
  fitting.add(dir);
  try {
    await setEditorStatus(dir, { text: seconds === null ? 'Taking the fit out…' : `Fitting the video to ${seconds} s…`, state: 'working' });
    const before = await hashOf(dir);
    await expectLength(dir, true);
    let report: LengthReport | undefined;
    try {
      report = await mediaWorker.run<LengthReport>({ job: 'fit-length', input: dir, output: '', ...(seconds !== null && { seconds }) }, () => {}).promise;
    } finally {
      // nothing was written (it fitted already, or it failed): the next outside change is someone else's
      if ((await hashOf(dir)) === before) await expectLength(dir, false);
    }
    if (!report) throw new Error('the media worker gave no answer');
    return { report };
  } catch (error) {
    return { problem: `The video could not be fitted: ${(error as Error).message.split('\n')[0]}` };
  } finally {
    await setEditorStatus(dir, undefined);
    fitting.delete(dir);
  }
}
