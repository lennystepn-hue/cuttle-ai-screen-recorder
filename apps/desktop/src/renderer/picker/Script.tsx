// The picker's script: the steps of the demo, which the prompter shows while recording (never in the
// video). A row per step: what it shows, and under it what to say. Enter in a title goes on to the
// next step (a new one at the end), Backspace in an empty one removes it, a pasted list becomes
// steps, and Esc closes the panel.
import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { SCRIPT_MAX_STEPS, STEP_NOTE_MAX, STEP_TITLE_MAX } from '@cuttle/project';
import { stepsFromText, type ScriptStep } from '../../shared/recording';
import { hotkey } from '../keys';

/** An id no step of `steps` has: the next `step<n>` (the recording makes it unique in the project). */
function freeId(steps: readonly ScriptStep[]): string {
  const taken = new Set(steps.map((step) => step.id));
  let n = 1;
  while (taken.has(`step${n}`)) n++;
  return `step${n}`;
}

/** Steps with a title, as the bar counts them. */
export const writtenSteps = (steps: readonly ScriptStep[]) => steps.filter((step) => step.title.trim() !== '').length;

export function ScriptIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 4h7M6.5 8h7M6.5 12h4.5" />
      <path d="M2.5 3.2 3.4 2.6v2.8M2.4 7.4c.3-.5 1.6-.6 1.6.3 0 .7-1.6 1.2-1.6 2h1.7" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function ScriptPanel({ steps, onChange, onClose, place }: { steps: ScriptStep[]; onChange: (steps: ScriptStep[]) => void; onClose: () => void; place: 'above' | 'below' }) {
  const titles = useRef(new Map<string, HTMLInputElement>());
  /** The step whose title gets the focus once it is drawn (a new one, or the one before a removed one). */
  const focusNext = useRef<string>(undefined);
  // the panel opens on the first empty title (a new script: its first step)
  useEffect(() => {
    if (steps.length === 0) {
      const id = freeId(steps);
      focusNext.current = id;
      onChange([{ id, title: '' }]);
      return;
    }
    titles.current.get((steps.find((step) => step.title.trim() === '') ?? steps.at(-1)!).id)?.focus();
  }, []); // only when the panel opens
  useEffect(() => {
    // once that step is drawn (the change comes back from the picker a render later)
    const element = focusNext.current === undefined ? undefined : titles.current.get(focusNext.current);
    if (!element) return;
    focusNext.current = undefined;
    element.focus();
  });

  const change = (id: string, fields: Partial<ScriptStep>) => onChange(steps.map((step) => (step.id === id ? { ...step, ...fields } : step)));
  const insertAfter = (index: number, added: Omit<ScriptStep, 'id'>[]) => {
    const next = [...steps];
    const made: ScriptStep[] = [];
    for (const step of added.slice(0, SCRIPT_MAX_STEPS - steps.length)) made.push({ id: freeId([...next, ...made]), ...step });
    next.splice(index + 1, 0, ...made);
    if (made.length > 0) focusNext.current = made.at(-1)!.id;
    onChange(next);
  };
  const remove = (index: number) => {
    const next = steps.filter((_, i) => i !== index);
    focusNext.current = (next[index - 1] ?? next[0])?.id;
    onChange(next);
  };

  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const step = steps[index]!;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const following = steps[index + 1];
      if (following) titles.current.get(following.id)?.focus();
      else if (step.title.trim() !== '') insertAfter(index, [{ title: '' }]);
      return;
    }
    if (event.key === 'Backspace' && step.title === '' && !step.note && steps.length > 1) {
      event.preventDefault();
      remove(index);
    }
  };
  const onTitlePaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = event.clipboardData.getData('text/plain');
    if (!/[\r\n]/.test(text.trim())) return;
    event.preventDefault();
    const pasted = stepsFromText(text, STEP_TITLE_MAX);
    if (pasted.length === 0) return;
    const step = steps[index]!;
    if (step.title.trim() !== '' || step.note) return insertAfter(index, pasted);
    // into an empty step: it takes the first, the rest follow it
    const [first, ...rest] = pasted;
    const next = steps.map((item, i) => (i === index ? { id: item.id, ...first! } : item));
    const made: ScriptStep[] = [];
    for (const added of rest.slice(0, SCRIPT_MAX_STEPS - steps.length)) made.push({ id: freeId([...next, ...made]), ...added });
    next.splice(index + 1, 0, ...made);
    focusNext.current = (made.at(-1) ?? next[index]!).id;
    onChange(next);
  };

  return (
    <div
      className={`script-panel ${place}`}
      id="script-panel"
      role="dialog"
      aria-label="Script"
      data-testid="script-panel"
      onKeyDown={(event) => {
        // Esc closes the panel, not the pick; the picker's keys (C, M, O, Enter) are for the bar
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="script-head">
        <b>Script</b>
        <span>The prompter shows it while you record, never in the video. {hotkey('Ctrl+Shift+Alt+N')} goes to the next step.</span>
        <button type="button" className="script-close" onClick={onClose} aria-label="Close the script" title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
      <ol className="script-steps">
        {steps.map((step, index) => (
          <li key={step.id} className="script-step">
            <span className="script-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="script-fields">
              <input
                ref={(element) => {
                  if (element) titles.current.set(step.id, element);
                  else titles.current.delete(step.id);
                }}
                value={step.title}
                maxLength={STEP_TITLE_MAX}
                placeholder={index === 0 ? 'What the first step shows' : 'What this step shows'}
                aria-label={`Step ${index + 1}`}
                onChange={(event) => change(step.id, { title: event.target.value })}
                onKeyDown={(event) => onTitleKey(event, index)}
                onPaste={(event) => onTitlePaste(event, index)}
                data-testid="script-title"
              />
              <textarea
                value={step.note ?? ''}
                maxLength={STEP_NOTE_MAX}
                rows={1}
                placeholder="What to say (optional)"
                aria-label={`Step ${index + 1}: what to say`}
                onChange={(event) => change(step.id, { note: event.target.value || undefined })}
                onInput={(event) => fit(event.currentTarget)}
                ref={(element) => {
                  if (element) fit(element);
                }}
                data-testid="script-note"
              />
            </div>
            <button type="button" className="script-remove" onClick={() => remove(index)} aria-label={`Remove step ${index + 1}`} title="Remove this step">
              <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
      <div className="script-foot">
        <button type="button" className="script-add" onClick={() => insertAfter(steps.length - 1, [{ title: '' }])} disabled={steps.length >= SCRIPT_MAX_STEPS} data-testid="script-add">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 2v8M2 6h8" />
          </svg>
          Add a step
        </button>
        <span>A pasted list becomes steps.</span>
      </div>
    </div>
  );
}

/** A note's box grows with its lines (up to its CSS max-height). */
function fit(area: HTMLTextAreaElement): void {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
}
