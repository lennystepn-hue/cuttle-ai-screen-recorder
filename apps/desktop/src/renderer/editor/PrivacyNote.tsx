// The Auto tab's note while the take's screen was not read: once it is (the system's own OCR), Cuttle
// masks the private things it showed. A button reads it now.
import { useState } from 'react';
import { bridge } from '../bridge';
import { store } from './session';
import { useStore } from './store';

/** Windows (its own OCR) and macOS (Vision) read the screen's text. */
const READS_SCREEN = navigator.userAgent.includes('Windows') || navigator.userAgent.includes('Macintosh');

export function PrivacyNote() {
  const read = useStore(store, (state) => state.doc?.project.sources.screenText !== undefined);
  const on = useStore(store, (state) => state.doc?.project.autoEdits.privacy === true);
  const working = useStore(store, (state) => state.status?.state === 'working');
  const [problem, setProblem] = useState<string>();
  if (!READS_SCREEN || read || !on) return null;
  const readScreen = async () => {
    const answer = await bridge.invoke('project:read-screen');
    setProblem('problem' in answer ? answer.problem : undefined);
  };
  return (
    <div className="speech-note" data-testid="privacy-note">
      <p>
        <b>The screen is not read.</b> Once it is, Cuttle masks the email addresses, keys and other private things it shows.
      </p>
      {problem && (
        <p className="speech-problem" role="alert" data-testid="privacy-problem">
          {problem}
        </p>
      )}
      <div className="speech-actions">
        <button type="button" className="ghost small" disabled={working} onClick={() => void readScreen()} data-testid="read-screen">
          {working ? 'Busy…' : 'Read the screen'}
        </button>
      </div>
    </div>
  );
}
