// The picker: one transparent window per display, over everything. Hovering lights the window under
// the pointer (the display where there is none), dragging draws a region; the bar sets the camera,
// the mic and when to stop, and Enter records. Never in a recording (content protection).
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PickedTarget, PickerSetup, Rect, RecordChoices } from '../../shared/ipc';
import { dragRect, matchMediaDevice, windowsAt } from '../../shared/recording';
import { bridge } from '../bridge';
import { MicIcon, WarningIcon } from '../icons';

type Mode = 'auto' | 'screen' | 'window' | 'region';
type Shown = { kind: 'screen' | 'window' | 'region'; rect: Rect; title: string; pixels: { width: number; height: number }; window?: number };

const MIN_REGION = 16;
const BAR_HEIGHT = 52;

function Camera({ size }: { size?: number }) {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
      <path d="m10.5 7 4-2.5v7l-4-2.5" />
    </svg>
  );
}

const ModeIcons = {
  screen: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5 14h6" />
    </svg>
  ),
  window: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M1.5 5.5h13" />
    </svg>
  ),
  region: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1" />
    </svg>
  ),
};

/** A local rect (DIP inside this display) in physical pixels of the display. */
const pixelsOf = (rect: Rect, scale: number) => ({ width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) });

export function Picker() {
  const [setup, setSetup] = useState<PickerSetup>();
  const [active, setActive] = useState(false);
  const [choices, setChoices] = useState<RecordChoices>({ stop: 'none' });
  const [mode, setMode] = useState<Mode>('auto');
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const [cycle, setCycle] = useState(0);
  const [region, setRegion] = useState<Rect>();
  const [frozen, setFrozen] = useState<Shown>();
  const drag = useRef<{ from: { x: number; y: number }; handle?: string; start?: Rect; moved: boolean }>(undefined);

  useEffect(() => {
    const offOpen = bridge.on('picker:open', (next) => {
      setSetup(next);
      setActive(next.active);
      setChoices(next.choices);
      setMode('auto');
      setRegion(undefined);
      setFrozen(undefined);
      setCycle(0);
    });
    const offActive = bridge.on('picker:active', ({ display }) => setActive((current) => (setup ? display === setup.display.id : current)));
    const offChoices = bridge.on('picker:choices', (next) => setChoices(next));
    void bridge.invoke('picker:setup').then((initial) => {
      if (!initial) return;
      setSetup(initial);
      setActive(initial.active);
      setChoices(initial.choices);
    });
    return () => {
      offOpen();
      offActive();
      offChoices();
    };
  }, [setup?.display.id]);

  const display = setup?.display;
  const local = useMemo(
    () => (setup ? setup.windows.map((window) => ({ ...window, bounds: { ...window.bounds, x: window.bounds.x - setup.display.bounds.x, y: window.bounds.y - setup.display.bounds.y } })) : []),
    [setup],
  );
  const full: Rect = display ? { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height } : { x: 0, y: 0, width: 0, height: 0 };

  // What would be recorded now.
  const shown: Shown | undefined = useMemo(() => {
    if (!display) return undefined;
    if (frozen) return frozen;
    const screen: Shown = { kind: 'screen', rect: full, title: display.label, pixels: display.pixels };
    if (region && (mode === 'region' || mode === 'auto')) return { kind: 'region', rect: region, title: 'Region', pixels: pixelsOf(region, display.scaleFactor) };
    if (mode === 'region') return undefined;
    if (mode === 'screen') return screen;
    const under = pointer ? windowsAt(local, pointer.x, pointer.y) : [];
    const window = under.length > 0 ? under[cycle % under.length] : undefined;
    if (window) return { kind: 'window', rect: window.bounds, title: window.title, pixels: window.pixels, window: window.id };
    return mode === 'window' ? undefined : screen;
  }, [display, frozen, region, mode, pointer, local, cycle, full]);

  const record = useCallback(() => {
    if (!display || !shown) return;
    const target: PickedTarget =
      shown.kind === 'screen'
        ? { kind: 'screen', display: display.id }
        : shown.kind === 'window'
          ? { kind: 'window', display: display.id, window: shown.window! }
          : { kind: 'region', display: display.id, rect: { ...shown.rect, x: shown.rect.x + display.bounds.x, y: shown.rect.y + display.bounds.y } };
    void bridge.invoke('picker:record', target);
  }, [display, shown]);

  const updateChoices = (change: Partial<RecordChoices>) => {
    const next = { ...choices, ...change };
    setChoices(next);
    void bridge.invoke('picker:choices', next);
  };

  // Keys work on the display the pointer is on (that picker has the focus).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLSelectElement) return;
      const key = event.key;
      if (key === 'Escape') return void bridge.invoke('picker:cancel');
      if (key === 'Enter') return record();
      if (key === 'Tab') {
        event.preventDefault();
        setFrozen(undefined);
        setCycle((value) => value + 1);
        return;
      }
      const forced = ({ s: 'screen', w: 'window', r: 'region' } as const)[key.toLowerCase() as 's' | 'w' | 'r'];
      if (forced && !event.ctrlKey && !event.altKey) {
        setMode((current) => (current === forced ? 'auto' : forced));
        setFrozen(undefined);
        return;
      }
      if (region && key.startsWith('Arrow')) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1 / (display?.scaleFactor ?? 1);
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
        setRegion({ ...region, x: Math.min(Math.max(0, region.x + dx), full.width - region.width), y: Math.min(Math.max(0, region.y + dy), full.height - region.height) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record, region, display, full.width, full.height]);

  const onMove = (event: ReactPointerEvent) => {
    const at = { x: event.clientX, y: event.clientY };
    if (!active) {
      setActive(true);
      void bridge.invoke('picker:hover');
    }
    const current = drag.current;
    if (current) {
      const moved = Math.hypot(at.x - current.from.x, at.y - current.from.y) > 4;
      current.moved ||= moved;
      if (current.handle && current.start) setRegion(resize(current.start, current.handle, at.x - current.from.x, at.y - current.from.y, full));
      else if (current.moved) setRegion(dragRect(current.from, at, full, event.shiftKey));
      return;
    }
    if (!frozen) setPointer(at);
  };

  const onDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      // a synthetic pointer (the check) has nothing to capture
    }
    const handle = (event.target as HTMLElement).dataset.handle;
    drag.current = { from: { x: event.clientX, y: event.clientY }, handle, start: region, moved: false };
    setFrozen(undefined);
  };

  const onUp = () => {
    const current = drag.current;
    drag.current = undefined;
    if (!current) return;
    if (current.handle) return;
    if (current.moved) {
      setRegion((rect) => (rect && rect.width >= MIN_REGION && rect.height >= MIN_REGION ? rect : undefined));
      setMode((value) => (value === 'auto' || value === 'region' ? value : 'region'));
      return;
    }
    // A click picks what is lit and keeps it while the pointer goes to the bar.
    setRegion(undefined);
    if (shown) setFrozen(shown);
  };

  if (!setup || !display) return null;
  const rect = shown?.rect;
  const hole = rect
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y}px)`
    : undefined;
  const barTop = rect ? Math.min(rect.y + rect.height + 24, full.height - BAR_HEIGHT - 56) : full.height - BAR_HEIGHT - 56;
  const labelTop = rect ? (rect.y >= 40 ? rect.y - 36 : rect.y + 8) : 0;
  const kindName = shown?.kind === 'screen' ? 'Screen' : shown?.kind === 'window' ? 'Window' : 'Region';
  const effective = shown?.kind ?? (mode === 'auto' ? 'screen' : mode);

  return (
    <div className={`picker${active ? '' : ' inactive'}`} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} data-testid="picker">
      <div className="dim" style={{ clipPath: active ? hole : undefined }} />
      {active && rect && (
        <>
          <div className={`target ${shown!.kind}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />
          <div className="target-label" style={{ left: Math.max(16, rect.x), top: labelTop }}>
            <b>
              {kindName}
              {shown!.kind === 'window' ? ` · ${shown!.title}` : shown!.kind === 'screen' ? ` · ${shown!.title}` : ''}
            </b>
            <span>
              {shown!.pixels.width} × {shown!.pixels.height} · {shown!.kind === 'window' ? 'records this area' : 'pixels'}
            </span>
          </div>
          {shown!.kind === 'region' &&
            ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => {
              const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
              const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
              return <div key={handle} className="handle" data-handle={handle} style={{ left: x, top: y, cursor: `${handle}-resize`, pointerEvents: 'auto' }} />;
            })}
        </>
      )}
      {active && (
        <>
          <div className="hint">
            <kbd>Esc</kbd> cancel · <kbd>Tab</kbd> next window · drag for a region · <kbd>S</kbd> <kbd>W</kbd> <kbd>R</kbd> mode
          </div>
          {choices.camera && rect && <CameraBubble name={choices.camera} rect={rect} />}
          {setup.problem && (
            <div className="problem" style={{ top: barTop - 52 }}>
              <WarningIcon size={15} />
              {setup.problem}
            </div>
          )}
          <div className="bar-rec" style={{ top: barTop }} onPointerDown={(event) => event.stopPropagation()} onPointerMove={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
            <div className="modes" role="group" aria-label="What to record">
              {(['screen', 'window', 'region'] as const).map((kind) => (
                <button key={kind} aria-pressed={effective === kind} onClick={() => setMode((current) => (current === kind ? 'auto' : kind))} title={`${kind[0]!.toUpperCase()}${kind.slice(1)} (${kind[0]!.toUpperCase()})`}>
                  {ModeIcons[kind]}
                  {kind[0]!.toUpperCase() + kind.slice(1)}
                </button>
              ))}
            </div>
            <div className="divider" />
            <Device label="Camera" icon={<Camera />} names={setup.cameras} chosen={choices.camera} onChange={(camera) => updateChoices({ camera })} />
            <Device label="Mic" icon={<MicIcon />} names={setup.mics} chosen={choices.mic} onChange={(mic) => updateChoices({ mic })} meter={choices.mic && active ? <MicMeter name={choices.mic} /> : undefined} />
            <div className={`opt${choices.stop !== 'none' ? ' on' : ''}`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
                <circle cx="8" cy="8" r="2" />
              </svg>
              <div className="name">
                Stop on
                <select value={choices.stop} onChange={(event) => updateChoices({ stop: event.target.value as RecordChoices['stop'] })} aria-label="Stop on">
                  <option value="none">my stop (Ctrl Shift Alt S)</option>
                  <option value="claude">Claude's answer</option>
                  <option value="idle">10 s without change</option>
                </select>
              </div>
              {choices.stop === 'claude' && (
                <button
                  className="more"
                  title={choices.claudeFolder ? `Claude Code runs in ${choices.claudeFolder}; choose another folder` : 'Choose the folder Claude Code runs in'}
                  onClick={() => void bridge.invoke('picker:claude-folder').then((folder) => folder && updateChoices({ claudeFolder: folder }))}
                >
                  <small>{choices.claudeFolder ? choices.claudeFolder.split(/[\\/]/).at(-1) : 'folder…'}</small>
                </button>
              )}
            </div>
            <div className="divider" />
            <button className="rec" onClick={record} disabled={!shown || (choices.stop === 'claude' && !choices.claudeFolder)} data-testid="picker-record">
              <i />
              Record <kbd>Enter</kbd>
            </button>
          </div>
          <div className="stopwhen" style={{ top: barTop + BAR_HEIGHT + 12 }}>
            <span>
              <b>{setup.countdown} s</b> countdown
            </span>
            <span>
              stop <kbd>Ctrl Shift Alt S</kbd>
            </span>
            <span>
              marker <kbd>Ctrl Shift Alt M</kbd>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** A region resized by one of its eight handles, kept inside the display and at least 16 DIP. */
function resize(start: Rect, handle: string, dx: number, dy: number, area: Rect): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = Math.min(Math.max(area.x, left + dx), right - MIN_REGION);
  if (handle.includes('e')) right = Math.max(Math.min(area.x + area.width, right + dx), left + MIN_REGION);
  if (handle.includes('n')) top = Math.min(Math.max(area.y, top + dy), bottom - MIN_REGION);
  if (handle.includes('s')) bottom = Math.max(Math.min(area.y + area.height, bottom + dy), top + MIN_REGION);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function Device(props: { label: string; icon: React.ReactNode; names: string[]; chosen?: string; onChange: (name: string | undefined) => void; meter?: React.ReactNode }) {
  const { label, icon, names, chosen, onChange, meter } = props;
  const on = chosen !== undefined;
  return (
    <div className={`opt${on ? ' on' : ''}`} title={chosen ?? (names.length === 0 ? `No ${label.toLowerCase()} found` : `${label} off`)}>
      <button className="toggle" onClick={() => onChange(on ? undefined : names[0])} disabled={names.length === 0} aria-pressed={on} aria-label={`${label} ${on ? 'on' : 'off'}`}>
        {icon}
        <span className="name">
          {label}
          <small>{chosen ?? (names.length === 0 ? 'none found' : 'off')}</small>
        </span>
      </button>
      {on && names.length > 1 && (
        <select className="more" value={chosen} onChange={(event) => onChange(event.target.value)} aria-label={`${label} device`} style={{ width: 20 }}>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      {meter}
    </div>
  );
}

/** A live preview of the camera at the target's bottom-left corner, where the look puts the bubble. */
function CameraBubble({ name, rect }: { name: string; rect: Rect }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const device = matchMediaDevice(name, (await navigator.mediaDevices.enumerateDevices()).filter((info) => info.kind === 'videoinput'));
        if (device && stream.getVideoTracks()[0]?.getSettings().deviceId !== device.deviceId) {
          stream.getTracks().forEach((track) => track.stop());
          stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId } } });
        }
        if (cancelled) return stream.getTracks().forEach((track) => track.stop());
        if (video.current) video.current.srcObject = stream;
      } catch {
        setProblem('No preview');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [name]);
  return (
    <div className="bubble" style={{ left: rect.x + 24, top: rect.y + rect.height - 144 }}>
      {problem ? problem : <video ref={video} autoPlay muted playsInline />}
    </div>
  );
}

/** The mic's level, live. */
function MicMeter({ name }: { name: string }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const device = matchMediaDevice(name, (await navigator.mediaDevices.enumerateDevices()).filter((info) => info.kind === 'audioinput'));
        if (device && stream.getAudioTracks()[0]?.getSettings().deviceId !== device.deviceId) {
          stream.getTracks().forEach((track) => track.stop());
          stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: device.deviceId } } });
        }
        if (cancelled) return;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let peak = 0;
          for (const value of data) peak = Math.max(peak, Math.abs(value));
          setLevel(Math.min(1, peak * 1.6));
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(0);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [name]);
  return (
    <span className="meter" aria-hidden="true">
      <i style={{ width: `${Math.round(level * 100)}%` }} />
    </span>
  );
}
