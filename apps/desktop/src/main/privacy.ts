// Privacy in the app: after a take's cut and its speech step, the screen's text is read inside the
// clips (the system's own OCR: Windows' or macOS's Vision, in the media worker), then what it showed that is private and the
// notifications are masked, as one step to undo ("Cuttle's privacy masks").
import { dirname, join, relative, resolve, sep } from 'node:path';
import { SCREEN_TEXT_FILE, readProjectFile, readingNote } from '@cuttle/core';
import type { ReadReport } from '../shared/media-jobs';
import { mediaWorker } from './media-service';
import { loadSettings } from './settings';
import { speechDone } from './speech';
import { expectPrivacy, sendToEditor, setEditorStatus } from './windows';

/** Whether this system can read the screen's text (Windows' OCR, macOS's Vision); elsewhere it is tried only when asked, which says why not. */
const CAN_READ = process.platform === 'win32' || process.platform === 'darwin';
/** Projects whose privacy step runs now (their folders, as given). */
const masking = new Set<string>();
/** Said once per run of the app: the screen's text cannot be read here. */
let toldMissing = false;

/** The SHA-256 of cuttle.json as it is now (undefined: it cannot be read). */
const hashOf = async (dir: string) => (await readProjectFile(dir).catch(() => undefined))?.hash;

/**
 * Masks what the project's screen showed that is private, and the notifications, once its speech
 * step has ended (one write at a time, each its own step to undo): the screen's text is read
 * inside the clips first when reading is on in the settings and the take was not read yet. Without
 * an OCR the notifications are masked all the same, and a note says why the screen was not
 * read (once per run of the app, or when asked). The editor's title bar shows the progress.
 * `asked`: the person asked for it (the Auto tab, Try again): the screen is read again.
 */
export async function maskPrivacy(dir: string, asked = false): Promise<{ started: true } | { problem: string }> {
  if (masking.has(dir)) return { started: true };
  masking.add(dir);
  const first = await readProjectFile(dir).catch(() => undefined);
  const problem = !first ? 'cuttle.json cannot be read.' : !first.project.autoEdits.privacy ? 'Masking private things is switched off: switch it on first.' : undefined;
  if (problem) {
    masking.delete(dir);
    return { problem };
  }
  void (async () => {
    // while macOS prepares its text recognition (a minute where it compiles it), then the share read;
    // each fits the chip (260 px)
    const status = (progress: number, preparing = false) =>
      setEditorStatus(dir, { text: preparing ? 'Reading the screen… preparing (a minute)' : `Reading the screen… ${Math.round(progress * 100)} %`, state: 'working' });
    try {
      await speechDone(dir);
      const file = await readProjectFile(dir);
      const { privacy } = await loadSettings();
      let link: string | undefined;
      // only reading takes long enough to show: masking the notifications alone shows nothing until it arrives
      const read = asked || (CAN_READ && privacy.read && file.project.sources.screenText === undefined);
      if (read) {
        try {
          await status(0);
          const report = await mediaWorker.run<ReadReport>({ job: 'read-screen', input: dir, output: '' }, (progress, preparing) => void status(progress, preparing)).promise;
          link = relative(file.dir, join(dirname(resolve(file.dir, file.project.sources.screen)), SCREEN_TEXT_FILE)).split(sep).join('/');
          // read, but less well (the fast recognition, frames left out): said, as the masks may miss more
          const note = report && readingNote(report);
          if (note) await sendToEditor(dir, 'project:note', { text: `Cuttle read the screen, but ${note}.` });
        } catch (error) {
          if ((error as { code?: string }).code !== 'ocr-missing') throw error;
          if (asked || !toldMissing) await sendToEditor(dir, 'project:note', { text: `Cuttle could not read the screen: ${(error as Error).message}. Look for private things yourself.` });
          toldMissing = true;
        }
      }
      if (read) await setEditorStatus(dir, { text: 'Masking private things…', state: 'working' });
      const before = await hashOf(dir);
      await expectPrivacy(dir, true);
      try {
        await mediaWorker.run({ job: 'privacy-edits', input: dir, output: '', ...(link && { link }), words: privacy.words }, () => {}).promise;
      } finally {
        // nothing was written (nothing new, or it failed): the next outside change is someone else's
        if ((await hashOf(dir)) === before) await expectPrivacy(dir, false);
      }
      if (read) await setEditorStatus(dir, undefined);
    } catch (error) {
      const cancelled = (error as { cancelled?: boolean }).cancelled === true;
      await setEditorStatus(dir, cancelled ? undefined : { text: `The screen could not be read: ${(error as Error).message.split('\n')[0]}`, state: 'failed', retry: 'privacy' });
    } finally {
      masking.delete(dir);
    }
  })();
  return { started: true };
}
