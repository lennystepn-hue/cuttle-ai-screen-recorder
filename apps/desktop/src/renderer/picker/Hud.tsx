// The recording HUD: the time, a warning when there is one, a marker and Stop. It is never in the
// video (content protection), never takes the focus (the recorded window keeps it), and its area is
// a dead zone for the input log. Its width is fixed, so Stop never moves under the pointer.
import { useEffect, useState } from 'react';
import type { HudState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { WarningIcon } from '../icons';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function Hud() {
  const [state, setState] = useState<HudState>({ phase: 'countdown', markers: 0 });
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const off = bridge.on('hud:state', (next) => {
      setState((previous) => {
        if (next.markers > previous.markers) {
          setFlash(true);
          setTimeout(() => setFlash(false), 900);
        }
        return next;
      });
    });
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
  const seconds = state.startedAt ? Math.max(0, (now - state.startedAt) / 1000) : 0;
  return (
    <div className="hud-wrap">
      <div className={`hud${state.phase === 'recording' ? '' : ' stopping'}`} role="toolbar" aria-label="Recording">
        <span className="dot" />
        <span className="time" data-testid="hud-time">
          {clock(seconds)}
        </span>
        <span className={`note${state.tone === 'warn' ? ' warn' : ''}`} title={state.detail ?? state.message} role="status" data-testid="hud-note">
          {state.message && (
            <>
              {state.tone === 'warn' && <WarningIcon size={13} />}
              <span>{state.message}</span>
            </>
          )}
        </span>
        <span className="sep" />
        <button
          className={`marker${flash ? ' flash' : ''}`}
          onClick={() => void bridge.invoke('hud:marker')}
          title={`Set a marker (Ctrl+Shift+Alt+M)${state.markers > 0 ? `: ${state.markers} so far` : ''}`}
          aria-label="Set a marker"
          disabled={state.phase !== 'recording'}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4 14V2.5h8l-2 3 2 3H4" />
          </svg>
          {state.markers > 0 && <small>{state.markers}</small>}
        </button>
        <button className="stop" onClick={() => void bridge.invoke('hud:stop')} title="Stop (Ctrl+Shift+Alt+S)" aria-label="Stop the recording" data-testid="hud-stop" disabled={state.phase === 'stopping'}>
          <i />
        </button>
      </div>
    </div>
  );
}
