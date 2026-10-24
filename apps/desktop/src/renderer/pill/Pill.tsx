// The pill: a small launcher near the top of the screen (never in a recording). New recording, open
// a project (the recent ones in a menu), a screenshot, and Esc to hide it until the tray brings it back. The
// window takes the pill's width: its hotkey is longer on Windows than on a Mac.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { bridge } from '../bridge';
import { ChevronIcon, CloseIcon, FolderIcon, Mark, ShotIcon } from '../icons';
import { hotkey } from '../keys';

/** The window's margin left and right of the pill (its shadow), as the main process sizes it. */
const MARGIN = 10;

export function Pill() {
  const bar = useRef<HTMLDivElement>(null);
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
  return (
    <div className="pill-wrap">
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
        <button className="icon-only" onClick={() => void bridge.invoke('pill:hide')} aria-label="Hide (Esc)" title="Hide (Esc); the tray icon brings it back">
          <CloseIcon size={13} />
        </button>
      </div>
    </div>
  );
}
