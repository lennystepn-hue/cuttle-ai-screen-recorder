// The picker: one transparent window per display, over everything. Hovering lights the window under
// the pointer (the display where there is none), dragging draws a region; the bar sets the camera,
// the mic and when to stop, and Enter records. Never in a recording (content protection). The bar,
// the label and the camera bubble keep clear of what is about to be recorded where there is room.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PickedTarget, PickerSetup, Rect, RecordChoices } from '../../shared/ipc';
import { barPlacement, bubbleSize, dragRect, labelPlacement, matchMediaDevice, windowsAt } from '../../shared/recording';
import { bridge } from '../bridge';
import { FolderIcon, MicIcon, WarningIcon } from '../icons';

type Mode = 'auto' | 'screen' | 'window' | 'region';
type Shown = { kind: 'screen' | 'window' | 'region'; rect: Rect; title: string; pixels: { width: number; height: number }; window?: number; of?: [number, number] };

const MIN_REGION = 16;
const STOPS: RecordChoices['stop'][] = ['none', 'claude', 'idle'];
const STOP_NAMES: Record<RecordChoices['stop'], string> = { none: 'When I stop', claude: "Claude's answer", idle: 'Screen still for 10 s' };
/** A display narrower than this gets the bar's compact form (mode icons only). */
const COMPACT_BELOW = 1200;

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

/** The size an element has, measured after each layout (for placing it). */
function useSize<T extends HTMLElement>(fallback: { width: number; height: number }): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize((old) => (Math.abs(old.width - element.offsetWidth) < 0.5 && Math.abs(old.height - element.offsetHeight) < 0.5 ? old : { width: element.offsetWidth, height: element.offsetHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });
  return [ref, size];
}

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
  const [barRef, barSize] = useSize<HTMLDivElement>({ width: 1000, height: 52 });
  const [labelRef, labelSize] = useSize<HTMLDivElement>({ width: 260, height: 28 });
  const [hintRef, hintSize] = useSize<HTMLDivElement>({ width: 560, height: 30 });

  useEffect(() => {
    const offOpen = bridge.on('picker:open', (next) => {
      setSetup(next);
      setActive(next.active);
      setChoices(next.choices);
    });
    const offActive = bridge.on('picker:active', ({ display }) => setActive((current) => (setup ? display === setup.display.id : current)));
    const offChoices = bridge.on('picker:choices', (next) => setChoices(next));
    const offDevices = bridge.on('picker:devices', ({ cameras, mics, choices: listed }) => {
      setSetup((current) => (current ? { ...current, cameras, mics, listingDevices: false } : current));
      setChoices(listed);
    });
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
      offDevices();
    };
  }, [setup?.display.id]);

  const display = setup?.display;
  const local = useMemo(
    () => (setup ? setup.windows.map((window) => ({ ...window, bounds: { ...window.bounds, x: window.bounds.x - setup.display.bounds.x, y: window.bounds.y - setup.display.bounds.y } })) : []),
    [setup],
  );
  const full: Rect = display ? { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height } : { x: 0, y: 0, width: 0, height: 0 };
  const work: Rect = display
    ? { x: display.workArea.x - display.bounds.x, y: display.workArea.y - display.bounds.y, width: display.workArea.width, height: display.workArea.height }
    : full;

  // What would be recorded now.
  const shown: Shown | undefined = useMemo(() => {
    if (!display) return undefined;
    if (frozen) return frozen;
    const screen: Shown = { kind: 'screen', rect: full, title: display.label, pixels: display.pixels };
    if (region && (mode === 'region' || mode === 'auto')) return { kind: 'region', rect: region, title: 'Region', pixels: pixelsOf(region, display.scaleFactor) };
    if (mode === 'region') return undefined;
    if (mode === 'screen') return screen;
    const under = pointer ? windowsAt(local, pointer.x, pointer.y) : [];
    const index = under.length > 0 ? cycle % under.length : 0;
    const window = under[index];
    if (window) return { kind: 'window', rect: window.bounds, title: window.title, pixels: window.pixels, window: window.id, ...(under.length > 1 && { of: [index + 1, under.length] as [number, number] }) };
    return mode === 'window' ? undefined : screen;
  }, [display, frozen, region, mode, pointer, local, cycle, full.width, full.height]);

  const blocked = setup?.problem;
  const needsFolder = choices.stop === 'claude' && !choices.claudeFolder;
  const recordReason = blocked ?? (!shown ? 'Pick a window, a display or a region first' : needsFolder ? 'Choose the folder Claude Code runs in first' : undefined);

  const record = useCallback(() => {
    if (!display || !shown || recordReason) return;
    const target: PickedTarget =
      shown.kind === 'screen'
        ? { kind: 'screen', display: display.id }
        : shown.kind === 'window'
          ? { kind: 'window', display: display.id, window: shown.window! }
          : { kind: 'region', display: display.id, rect: { ...shown.rect, x: shown.rect.x + display.bounds.x, y: shown.rect.y + display.bounds.y } };
    void bridge.invoke('picker:record', target);
  }, [display, shown, recordReason]);

  const updateChoices = (change: Partial<RecordChoices>) => {
    const next = { ...choices, ...change };
    setChoices(next);
    void bridge.invoke('picker:choices', next);
  };
  /** A camera to switch on: the first that is not a virtual one (OBS and the like). */
  const firstCamera = (names: string[]) => names.find((name) => !/virtual|obs/i.test(name)) ?? names[0];
  const chooseFolder = () => void bridge.invoke('picker:claude-folder').then((folder) => folder && updateChoices({ claudeFolder: folder }));

  // Keys work on the display the pointer is on (that picker has the focus).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;
      const inField = event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement;
      if (key === 'Escape') return void bridge.invoke('picker:cancel');
      if (key === 'Enter') {
        if (inField) return;
        // a focused button of the bar does not also press itself
        event.preventDefault();
        return record();
      }
      if (inField) return;
      if (key === 'F6') {
        event.preventDefault();
        barRef.current?.querySelector<HTMLElement>('button')?.focus();
        return;
      }
      if (key === 'Tab' && !barRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        setFrozen(undefined);
        setCycle((value) => value + 1);
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const lower = key.toLowerCase();
      const forced = ({ s: 'screen', w: 'window', r: 'region' } as const)[lower as 's' | 'w' | 'r'];
      if (forced) {
        setMode((current) => (current === forced ? 'auto' : forced));
        setFrozen(undefined);
        return;
      }
      if (lower === 'c' && setup && setup.cameras.length > 0) return updateChoices({ camera: choices.camera ? undefined : firstCamera(setup.cameras) });
      if (lower === 'm' && setup && setup.mics.length > 0) return updateChoices({ mic: choices.mic ? undefined : setup.mics[0] });
      if (lower === 'o') return updateChoices({ stop: STOPS[(STOPS.indexOf(choices.stop) + 1) % STOPS.length]! });
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
  }, [record, region, display, full.width, full.height, choices, setup]);

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
  const compact = full.width < COMPACT_BELOW;
  const hole = rect
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y}px)`
    : undefined;
  const label = rect ? labelPlacement(rect, work, labelSize) : undefined;
  const barAt = barPlacement(rect ?? { x: work.x, y: work.y + work.height - 160, width: work.width, height: 0 }, work, barSize, label?.above ?? false);
  // The hint goes to the top corner away from the target and its label.
  const covers = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const hintRight: Rect = { x: work.x + work.width - 24 - hintSize.width, y: work.y + 16, width: hintSize.width, height: hintSize.height };
  const labelBox = label ? { x: label.x, y: label.y, width: labelSize.width, height: labelSize.height } : undefined;
  const wholeDisplay = rect !== undefined && rect.width >= full.width - 1 && rect.height >= full.height - 1;
  const hintLeft = (rect !== undefined && !wholeDisplay && covers(hintRight, rect)) || (labelBox !== undefined && covers(hintRight, labelBox));
  const bubble = rect && choices.camera ? bubbleSize(rect) : 0;
  // bottom left inside the target, above the bar when the bar had to go inside it
  const bubbleBottom = rect ? Math.min(rect.y + rect.height, barAt.where === 'inside' ? barAt.y : Infinity) - 16 : 0;
  const bubbleTop = rect ? Math.max(rect.y + 8 + (label && !label.above ? labelSize.height + 8 : 0), bubbleBottom - bubble) : 0;
  const atEdge = rect !== undefined && (rect.x <= 0 || rect.y <= 0 || rect.x + rect.width >= full.width || rect.y + rect.height >= full.height);
  const kindName = shown?.kind === 'screen' ? 'Screen' : shown?.kind === 'window' ? 'Window' : 'Region';
  const effective = shown?.kind ?? (mode === 'auto' ? 'screen' : mode);
  const notice = blocked ?? setup.warning;

  return (
    <div className={`picker${active ? '' : ' inactive'}`} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} data-testid="picker">
      <div className="dim" style={{ clipPath: active ? hole : undefined }} />
      {!active && <div className="point-here">Point here to record this display</div>}
      {active && rect && (
        <>
          <div className={`target ${shown!.kind}${atEdge ? ' edge' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />
          <div className="target-label" ref={labelRef} style={{ left: label!.x, top: label!.y }}>
            <b>
              {kindName}
              {shown!.kind !== 'region' ? ` · ${shown!.title}` : ''}
            </b>
            <span>
              {shown!.pixels.width} × {shown!.pixels.height} px
              {shown!.kind === 'window' ? ' · records this area' : ''}
              {shown!.of ? ` · ${shown!.of[0]} of ${shown!.of[1]} here (Tab)` : ''}
            </span>
          </div>
          {shown!.kind === 'region' &&
            ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => {
              const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
              const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
              return <div key={handle} className="handle" data-handle={handle} style={{ left: Math.min(Math.max(x, 6), full.width - 6), top: Math.min(Math.max(y, 6), full.height - 6), cursor: `${handle}-resize`, pointerEvents: 'auto' }} />;
            })}
        </>
      )}
      {active && (
        <>
          <div className="hint" ref={hintRef} style={hintLeft ? { left: work.x + 24, top: work.y + 16 } : { left: hintRight.x, top: hintRight.y }}>
            <span>
              <kbd>Esc</kbd> cancel
            </span>
            <span>
              <kbd>Enter</kbd> record
            </span>
            <span>
              <kbd>Tab</kbd> next window
            </span>
            <span>drag for a region</span>
            <span>
              <kbd>Ctrl+Shift+Alt+S</kbd> stops
            </span>
          </div>
          {choices.camera && rect && <CameraBubble name={choices.camera} size={bubble} left={rect.x + 16} top={bubbleTop} />}
          {notice && (
            <div
              className={`problem${blocked ? ' blocking' : ''}`}
              style={{ left: barAt.x, top: barAt.where === 'above' ? barAt.y - 52 : barAt.y + barSize.height + 10, maxWidth: Math.max(320, barSize.width) }}
              role="alert"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <WarningIcon size={15} />
              <span>{notice}</span>
              {blocked && /ffmpeg|did not answer|cannot record/i.test(blocked) && (
                <button type="button" className="retry" onClick={() => void bridge.invoke('picker:retry')}>
                  Try again
                </button>
              )}
            </div>
          )}
          <div
            className={`bar-rec${compact ? ' compact' : ''}`}
            ref={barRef}
            style={{ left: barAt.x, top: barAt.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <div className="modes" role="group" aria-label="What to record">
              {(['screen', 'window', 'region'] as const).map((kind) => (
                <button key={kind} aria-pressed={effective === kind} onClick={() => setMode((current) => (current === kind ? 'auto' : kind))} title={`${kind[0]!.toUpperCase()}${kind.slice(1)} (${kind[0]!.toUpperCase()})`}>
                  {ModeIcons[kind]}
                  <span className="mode-name">{kind[0]!.toUpperCase() + kind.slice(1)}</span>
                </button>
              ))}
            </div>
            <div className="divider" />
            <Device label="Camera" keyName="C" icon={<Camera />} names={setup.cameras} listing={setup.listingDevices} chosen={choices.camera} pick={firstCamera} onChange={(camera) => updateChoices({ camera })} />
            <Device
              label="Mic"
              keyName="M"
              icon={<MicIcon />}
              names={setup.mics}
              listing={setup.listingDevices}
              chosen={choices.mic}
              pick={(names) => names[0]}
              onChange={(mic) => updateChoices({ mic })}
              meter={choices.mic && active ? <MicMeter name={choices.mic} /> : undefined}
            />
            <div className={`opt${choices.stop !== 'none' ? ' on' : ''}`} title="When the recording stops (O)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
                <circle cx="8" cy="8" r="2" />
              </svg>
              <div className="name">
                Stop on
                <select
                  className="stop"
                  value={choices.stop}
                  onChange={(event) => {
                    updateChoices({ stop: event.target.value as RecordChoices['stop'] });
                    event.target.blur();
                  }}
                  aria-label="Stop on"
                >
                  {STOPS.map((stop) => (
                    <option key={stop} value={stop}>
                      {STOP_NAMES[stop]}
                    </option>
                  ))}
                </select>
              </div>
              {choices.stop === 'claude' &&
                (choices.claudeFolder ? (
                  <button type="button" className="folder" onClick={chooseFolder} title={`Claude Code runs in ${choices.claudeFolder}; choose another folder`}>
                    <FolderIcon size={13} />
                    <span>{choices.claudeFolder.split(/[\\/]/).at(-1)}</span>
                  </button>
                ) : (
                  <button type="button" className="folder need" onClick={chooseFolder}>
                    Choose Claude's folder
                  </button>
                ))}
            </div>
            <div className="divider" />
            <span title={recordReason ?? 'Record (Enter)'}>
              <button className="rec" onClick={record} disabled={!!recordReason} data-testid="picker-record">
                <i />
                Record <kbd>Enter</kbd>
              </button>
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

function Device(props: {
  label: string;
  keyName: string;
  icon: React.ReactNode;
  names: string[];
  listing?: boolean;
  chosen?: string;
  pick: (names: string[]) => string | undefined;
  onChange: (name: string | undefined) => void;
  meter?: React.ReactNode;
}) {
  const { label, keyName, icon, names, listing, chosen, pick, onChange, meter } = props;
  const on = chosen !== undefined;
  const state = chosen ?? (listing ? 'listing…' : names.length === 0 ? 'none found' : 'off');
  return (
    <div className={`opt${on ? ' on' : ''}`} title={chosen ? `${chosen} (${keyName} turns it off)` : names.length === 0 ? `No ${label.toLowerCase()} found` : `${label} off (${keyName} turns it on)`}>
      <button className="toggle" onClick={() => onChange(on ? undefined : pick(names))} disabled={names.length === 0} aria-pressed={on} aria-label={`${label} ${on ? 'on' : 'off'}`}>
        {icon}
        <span className="name">
          {label}
          <small>{state}</small>
        </span>
      </button>
      {names.length > 1 && (
        <select
          className="more"
          value={chosen ?? ''}
          onChange={(event) => {
            onChange(event.target.value || undefined);
            event.target.blur();
          }}
          aria-label={`${label} device`}
          style={{ width: 20 }}
        >
          <option value="">Off</option>
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

/** A live preview of the camera inside the target, where the look puts the bubble (bottom left). */
function CameraBubble({ name, size, left, top }: { name: string; size: number; left: number; top: number }) {
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
        setProblem('Camera busy or blocked');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [name]);
  return (
    <div className="bubble" style={{ left, top, width: size, height: size, fontSize: size < 80 ? 9 : 11 }}>
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
