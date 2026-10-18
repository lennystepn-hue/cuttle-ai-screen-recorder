// The recording HUD: the time, the mic's level, a warning when there is one, restart, the mistake
// key, a marker, pause and Stop, and under them the live captions when the take has them. It is
// never in the video (content protection), never takes the focus (the recorded window keeps it),
// and its area is a dead zone for the input log. Its width is fixed, so Stop never moves under the
// pointer. Restart asks for a press held 600 ms, so a stray click does not put a take aside.
import { useEffect, useRef, useState } from 'react';
import type { HudState } from '../../shared/ipc';
import { bridge } from '../bridge';
import { Mark, WarningIcon } from '../icons';
import { hotkey } from '../keys';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** How long Restart must be held. */
const HOLD_MS = 600;

export function Hud() {
  const [state, setState] = useState<HudState>({ phase: 'countdown', markers: 0 });
  /** A note of the HUD's own for a moment (a restart let go too early). */
  const [hint, setHint] = useState<string>();
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showHint = (text: string) => {
    clearTimeout(hintTimer.current);
    setHint(text);
    hintTimer.current = setTimeout(() => setHint(undefined), 2000);
  };
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const off = bridge.on('hud:state', (next) => {
      setState((previous) => {
        if (next.markers > previous.markers) {
          setFlash(true);
          setTimeout(() => setFlash(false), 900);
        }
        // the mistake key: what Cuttle will do with it, for a moment
        if ((next.retakes ?? 0) > (previous.retakes ?? 0)) showHint('Slip marked: do it again');
        return next;
      });
    });
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
  // The take's time: what was recorded before, plus the running stretch (it stands still while paused).
  const seconds = (state.recorded ?? 0) + (state.startedAt ? Math.max(0, (now - state.startedAt) / 1000) : 0);
  const paused = state.phase === 'paused';
  const live = state.phase === 'recording' || paused;
  return (
    <div className="hud-wrap">
      <div className={`hud ${state.phase}`} role="toolbar" aria-label="Recording">
        <Mark size={26} />
        <span className="dot" />
        <span className="time" data-testid="hud-time">
          {clock(seconds)}
        </span>
        {state.mic && <MicLevel live={state.phase === 'recording'} />}
        <span className={`note${state.tone === 'warn' && !hint ? ' warn' : ''}`} title={hint ?? state.detail ?? state.message} role="status" data-testid="hud-note">
          {hint ? (
            <span>{hint}</span>
          ) : (
            state.message && (
            <>
              {state.tone === 'warn' && <WarningIcon size={13} />}
              <span>{state.message}</span>
            </>
            )
          )}
        </span>
        <span className="sep" />
        <RestartButton disabled={!live} onShortPress={() => showHint('Hold to restart')} />
        <button
          className="retake"
          onClick={() => void bridge.invoke('hud:retake')}
          title={`A slip? Press it, then say or do the bit again: Cuttle cuts back to the pause before (${hotkey('Ctrl+Shift+Alt+X')})`}
          aria-label="Mark a slip: cut back to the pause before"
          disabled={state.phase !== 'recording'}
          data-testid="hud-retake"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="4.5" cy="4.5" r="2" />
            <circle cx="4.5" cy="11.5" r="2" />
            <path d="M6.2 5.6 13.5 12.5M6.2 10.4 13.5 3.5" />
          </svg>
        </button>
        <button
          className={`marker${flash ? ' flash' : ''}`}
          onClick={() => void bridge.invoke('hud:marker')}
          title={`Set a marker (${hotkey('Ctrl+Shift+Alt+M')})${state.markers > 0 ? `: ${state.markers} so far` : ''}`}
          aria-label="Set a marker"
          disabled={!live}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M4 14V2.5h8l-2 3 2 3H4" />
          </svg>
          {state.markers > 0 && <small>{state.markers}</small>}
        </button>
        <button
          className={`pause${paused ? ' paused' : ''}`}
          onClick={() => void bridge.invoke(paused ? 'hud:resume' : 'hud:pause')}
          title={paused ? `Resume (${hotkey('Ctrl+Shift+Alt+P')})` : `Pause: nothing is recorded until you resume (${hotkey('Ctrl+Shift+Alt+P')})`}
          aria-label={paused ? 'Resume the recording' : 'Pause the recording'}
          aria-pressed={paused}
          disabled={!live}
          data-testid="hud-pause"
        >
          {paused ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13 8z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
              <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
            </svg>
          )}
        </button>
        <button className="stop" onClick={() => void bridge.invoke('hud:stop')} title={`Stop (${hotkey('Ctrl+Shift+Alt+S')})`} aria-label="Stop the recording" data-testid="hud-stop" disabled={state.phase === 'stopping'}>
          <i />
        </button>
      </div>
      {state.captions && <Captions failed={state.captions.failed} live={state.phase === 'recording'} />}
    </div>
  );
}

/** The live captions keep this many words: more than one line holds. */
const LINE_WORDS = 24;

/**
 * The live captions: what the mic heard last, in one line under the bar, the newest words at its
 * right end and the older ones fading out at its left. "Listening…" until the first words; dimmed
 * while the take does not record.
 */
function Captions({ failed, live }: { failed: string | undefined; live: boolean }) {
  // the last words heard, and the number of the first of them (a word keeps its number as the line
  // moves on, so only new words fade in)
  const [line, setLine] = useState<{ first: number; words: string[] }>({ first: 0, words: [] });
  useEffect(
    () =>
      bridge.on('hud:caption', ({ words: heard }) =>
        setLine((before) => {
          const words = [...before.words, ...heard];
          const dropped = Math.max(0, words.length - LINE_WORDS);
          return { first: before.first + dropped, words: words.slice(dropped) };
        }),
      ),
    [],
  );
  const { first, words } = line;
  return (
    <div className={`captions${live ? '' : ' resting'}${failed ? ' failed' : ''}`} role="log" aria-live="polite" aria-label="Live captions" title={failed ? `The live captions stopped: ${failed}` : 'What the mic hears, as Cuttle understands it (not saved)'} data-testid="hud-captions">
      <span className="line">
        {failed ? (
          <span className="said">
            <WarningIcon size={13} />
            Live captions stopped
          </span>
        ) : words.length === 0 ? (
          <span className="said waiting">Listening…</span>
        ) : (
          <span className="said">
            {words.map((word, i) => (
              <span key={first + i}>{word} </span>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

/** Where the mic's bars light up (dBFS of its level); the top one turns red when the mic clips. */
const BARS = [-55, -45, -35, -25, -15];
/** A level this close to full scale (dBFS) clips. */
const CLIPS = -1;

/**
 * The mic's level: five bars that light up as it hears something, so a mic that hears nothing shows
 * at once. They rise with the sound and fall back slowly; dark while the take does not record.
 */
function MicLevel({ live }: { live: boolean }) {
  const [shown, setShown] = useState({ rms: -90, peak: -90 });
  useEffect(
    () =>
      bridge.on('hud:level', (level) =>
        // up at once, down by 6 dB a tenth of a second
        setShown((before) => ({ rms: Math.max(level.rms, before.rms - 6), peak: level.peak })),
      ),
    [],
  );
  const rms = live ? shown.rms : -90;
  const lit = BARS.filter((at) => rms >= at).length;
  const clips = live && shown.peak >= CLIPS;
  return (
    <span className="level" role="meter" aria-label="Mic level" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={Math.round(rms)} title={lit === 0 ? 'The mic hears nothing: muted, or the wrong mic?' : 'The mic’s level'} data-testid="hud-level" data-level={lit}>
      {BARS.map((at, i) => (
        <i key={at} className={i < lit ? (clips && i === BARS.length - 1 ? 'on clip' : 'on') : undefined} style={{ height: 4 + i * 2.5 }} />
      ))}
    </span>
  );
}

/** Restart: held 600 ms (a ring fills meanwhile); let go earlier and nothing happens. */
function RestartButton({ disabled, onShortPress }: { disabled: boolean; onShortPress: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const release = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={`restart${holding ? ' holding' : ''}`}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        setHolding(true);
        timer.current = setTimeout(() => {
          // held long enough: the release after this is not a short press
          timer.current = undefined;
          setHolding(false);
          void bridge.invoke('hud:restart');
        }, HOLD_MS);
      }}
      onPointerUp={() => {
        // let go before the hold was long enough: say how it works
        if (timer.current) onShortPress();
        release();
      }}
      onPointerLeave={release}
      onPointerCancel={release}
      title="Hold to restart: this take is put aside (the editor can bring it back) and the countdown starts again"
      aria-label="Restart the recording (hold)"
      data-testid="hud-restart"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.2h2.2" />
      </svg>
      <span className="ring" aria-hidden="true" />
    </button>
  );
}
