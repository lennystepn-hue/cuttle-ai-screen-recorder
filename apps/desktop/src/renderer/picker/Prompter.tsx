// The prompter: the script's step now, its note and the step after it, in a window by the HUD. It is
// never in the video (content protection), never takes the focus (the recorded window keeps it), and
// its area is a dead zone for the input log. Back and Next, or Ctrl+Shift+Alt+B and N, move through
// the steps once the take runs; each move is a `step` marker. The window takes its content's height.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PrompterState } from '../../shared/ipc';
import { bridge } from '../bridge';

/** The window's margin around the card (its shadow), as the main process places it. */
const MARGIN = 10;

export function Prompter() {
  const [state, setState] = useState<PrompterState>({ steps: [], index: 0, live: false });
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => bridge.on('prompter:state', setState), []);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    let last = 0;
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height) + 2 * MARGIN;
      if (height === last) return;
      last = height;
      void bridge.invoke('prompter:size', { height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const step = state.steps[state.index];
  const next = state.steps[state.index + 1];
  return (
    <div className="prompter-wrap">
      <div className={`prompter${state.live ? '' : ' waiting'}`} ref={card} role="region" aria-label="Script" data-testid="prompter">
        <div className="prompter-progress" aria-hidden="true">
          {state.steps.map((_, i) => (
            <i key={i} className={i < state.index ? 'done' : i === state.index ? 'now' : undefined} />
          ))}
        </div>
        <div className="prompter-head">
          <span className="prompter-count" data-testid="prompter-count">
            Step {state.index + 1} of {state.steps.length}
            {!state.live && <small> · starts with the recording</small>}
          </span>
          <button
            className="back"
            onClick={() => void bridge.invoke('prompter:previous')}
            disabled={!state.live || state.index === 0}
            title="The step before (Ctrl+Shift+Alt+B)"
            aria-label="The step before"
            data-testid="prompter-back"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>
          <button
            className="next"
            onClick={() => void bridge.invoke('prompter:next')}
            disabled={!state.live || !next}
            title="The next step (Ctrl+Shift+Alt+N)"
            data-testid="prompter-next"
          >
            Next
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </div>
        <h1 className="prompter-title" data-testid="prompter-title">
          {step?.title}
        </h1>
        {step?.note && <p className="prompter-note">{step.note}</p>}
        <div className="prompter-then">
          {next ? (
            <>
              Then <b>{next.title}</b>
            </>
          ) : (
            'The last step'
          )}
        </div>
      </div>
    </div>
  );
}
