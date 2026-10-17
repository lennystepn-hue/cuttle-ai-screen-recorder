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
        <button className="main" disabled title="Recording from the app is coming soon. Record with the cuttle record command for now.">
          <i />
          New recording
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
