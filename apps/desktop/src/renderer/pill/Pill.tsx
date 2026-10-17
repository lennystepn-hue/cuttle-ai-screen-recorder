// The pill: a small launcher near the top of the screen (never in a recording). New recording, open
// a project (the recent ones in a menu), and Esc to hide it until the tray brings it back.
import { useEffect } from 'react';
import { bridge } from '../bridge';
import { ChevronIcon, CloseIcon, FolderIcon, Mark } from '../icons';

export function Pill() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void bridge.invoke('pill:hide');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="pill-wrap">
      <div className="pill" role="toolbar" aria-label="Cuttle">
        <Mark size={36} />
        <button className="main" onClick={() => void bridge.invoke('pill:record')} title="Pick a screen, a window or a region (Ctrl+Shift+Alt+R)" data-testid="new-recording">
          <i />
          New recording <kbd>Ctrl Shift Alt R</kbd>
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
