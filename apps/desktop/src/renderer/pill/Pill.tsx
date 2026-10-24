// The pill: a small launcher near the top of the screen (never in a recording). New recording, open
// a project (the recent ones in a menu), a screenshot, and Esc to hide it until the tray brings it back. The
// window takes the pill's width: its hotkey is longer on Windows than on a Mac.
//
// In the drawer at the top centre (#171) it comes out of the notch, or down from the menu bar's
// middle, on a spring: its shape grows from the notch's size (or a sliver at the top) to the whole
// pill, a little past it and back, and its buttons come in one after another a beat later. It goes
// back quicker, without the bounce. Reduced motion only fades it.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { DRAWER, springEasing } from '../../shared/drawer';
import type { Events } from '../../shared/ipc';
import { bridge } from '../bridge';
import { ChevronIcon, CloseIcon, FolderIcon, Mark, ShotIcon } from '../icons';
import { hotkey } from '../keys';

/** The window's margin left and right of the pill (its shadow), as the main process sizes it. */
const MARGIN = 10;
/** The drawer's spring and timing, for its CSS. */
const DRAWER_STYLE = { '--drawer-spring': springEasing(), '--drawer-open': `${DRAWER.openMs}ms`, '--drawer-close': `${DRAWER.closeAnimMs}ms` } as CSSProperties;

export function Pill() {
  const bar = useRef<HTMLDivElement>(null);
  /** In the drawer: whether it is open, and where it comes from (kept while it closes); undefined while the pill is on screen. */
  // `opening`: drawn closed where it comes from, to open right after (its styles taken first, so the
  // opening always starts from there; a frame would come late in a window never shown)
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open'>('closed');
  const open = phase === 'open';
  const [origin, setOrigin] = useState<Pick<Extract<Events['pill:drawer'], { open: true }>, 'origin' | 'notch'>>();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      bridge.on('pill:drawer', (next) => {
        if (!next.open) {
          setPhase('closed');
          if (next.onScreen) setOrigin(undefined);
          return;
        }
        setOrigin({ origin: next.origin, ...(next.notch && { notch: next.notch }) });
        setPhase((before) => (before === 'open' ? 'open' : 'opening'));
      }),
    [],
  );
  useLayoutEffect(() => {
    if (phase !== 'opening') return;
    // the closed shape's styles, computed now
    void wrap.current?.getBoundingClientRect();
    setPhase('open');
  }, [phase]);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    let last = 0;
    const report = () => {
      const width = Math.ceil(element.getBoundingClientRect().width) + 2 * MARGIN;
      if (width === last) return;
      last = width;
      void bridge.invoke('pill:size', { width });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void bridge.invoke('pill:hide');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const inDrawer = origin !== undefined;
  const style = { ...DRAWER_STYLE, ...(origin?.notch && { '--notch-w': `${origin.notch.width}px`, '--notch-h': `${origin.notch.height}px` }) } as CSSProperties;
  return (
    <div ref={wrap} className={`pill-wrap${inDrawer ? ' drawer' : ''}`} data-state={open ? 'open' : 'closed'} data-origin={origin?.origin} style={style} data-testid="pill-wrap">
      <div className="pill" ref={bar} role="toolbar" aria-label="Cuttle">
        <Mark size={36} />
        <button className="main" onClick={() => void bridge.invoke('pill:record')} title={`Pick a screen, a window or a region (${hotkey('Ctrl+Shift+Alt+R')})`} data-testid="new-recording">
          <i />
          New recording <kbd>{hotkey('Ctrl+Shift+Alt+R')}</kbd>
        </button>
        <button className="icon-only" onClick={() => void bridge.invoke('pill:shot')} aria-label="Screenshot" title={`Screenshot: a window, a display or a region, framed (${hotkey('Ctrl+Shift+Alt+C')})`} data-testid="pill-shot">
          <ShotIcon size={15} />
        </button>
        <button onClick={() => void bridge.invoke('pill:open')} title="Open a project folder">
          <FolderIcon size={15} />
          Open
        </button>
        <button className="icon-only" onClick={() => void bridge.invoke('pill:menu')} aria-label="Recent projects" title="Recent projects">
          <ChevronIcon size={15} />
        </button>
        <button className="icon-only" onClick={() => void bridge.invoke('pill:hide')} aria-label={inDrawer ? 'Close (Esc)' : 'Hide (Esc)'} title={inDrawer ? 'Close (Esc): it comes back at the top edge' : 'Hide (Esc); the tray icon brings it back'}>
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  );
}
