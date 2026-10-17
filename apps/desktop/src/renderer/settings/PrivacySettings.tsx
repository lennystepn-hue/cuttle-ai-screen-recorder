// The settings' privacy part: whether a new take's screen is read (Windows' own OCR, on this
// computer) to mask the private things it shows, and the words always masked.
import { useState } from 'react';
import { PRIVACY_WORD_MAX, PRIVACY_WORDS_MAX, type RequestArgument, type SettingsView } from '../../shared/ipc';
import { CloseIcon } from '../icons';
import { Row } from './Settings';

/** Only Windows reads the screen's text for now. */
const READS_SCREEN = navigator.userAgent.includes('Windows');

export function PrivacySettings({ view, change }: { view: SettingsView | undefined; change: (next: RequestArgument<'settings:set'>) => void }) {
  const [draft, setDraft] = useState('');
  const words = view?.privacy.words ?? [];
  const read = READS_SCREEN && (view?.privacy.read ?? true);
  // "Lena Müller, ACME": each name once, as it was first written
  const add = () => {
    const added = draft.split(/[,;\n]/).map((word) => word.trim().slice(0, PRIVACY_WORD_MAX)).filter(Boolean);
    setDraft('');
    if (added.length > 0) change({ privacyWords: [...words, ...added].slice(0, PRIVACY_WORDS_MAX) });
  };
  return (
    <>
      <Row
        label="Read the screen after a take"
        hint={
          READS_SCREEN
            ? 'Cuttle reads the text of each new take with Windows’ own OCR, on this computer, and masks email addresses, keys and other private things it finds. Notifications are masked either way.'
            : 'Cuttle reads the screen’s text with Windows’ own OCR, which this system does not have yet. Notifications are masked either way.'
        }
      >
        <button
          className="toggle"
          role="switch"
          aria-checked={read}
          aria-label="Read the screen after a take"
          disabled={!READS_SCREEN || !view}
          onClick={() => view && change({ privacyRead: !view.privacy.read })}
          data-testid="privacy-read"
        >
          <i />
        </button>
      </Row>
      <Row label="Always mask" hint="Names and words masked wherever the screen shows them, in every new take." stacked>
        <div className="words" data-testid="privacy-words">
          {words.map((word) => (
            <span className="word" key={word}>
              {word}
              <button className="icon" aria-label={`Stop masking ${word}`} title="Stop masking it" onClick={() => change({ privacyWords: words.filter((other) => other !== word) })}>
                <CloseIcon size={11} />
              </button>
            </span>
          ))}
          <input
            className="word-input"
            value={draft}
            placeholder={words.length === 0 ? 'A name, a customer, a project: Enter adds it' : 'Add another'}
            aria-label="A word to always mask"
            disabled={!view || words.length >= PRIVACY_WORDS_MAX}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
            data-testid="privacy-word-input"
          />
        </div>
      </Row>
    </>
  );
}
