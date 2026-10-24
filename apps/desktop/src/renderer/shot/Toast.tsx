// The toast after a quick screenshot: the framed shot, said to be in the clipboard, with Edit (the
// screenshot editor) and Show in folder. It stays while the pointer is on it, and goes a few seconds
// after. Never in a recording or a shot (content protection), never takes the focus.
import { useEffect, useState } from 'react';
import type { ShotToast } from '../../shared/ipc';
import { bridge } from '../bridge';
import { CheckIcon, CloseIcon, FolderIcon } from '../icons';

export function Toast() {
  const [shown, setShown] = useState<{ toast: ShotToast; url: string }>();
  useEffect(
    () =>
      bridge.on('toast:show', (toast) => {
        const url = URL.createObjectURL(new Blob([new Uint8Array(toast.thumb)], { type: 'image/png' }));
        setShown((before) => {
          if (before) URL.revokeObjectURL(before.url);
          return { toast, url };
        });
      }),
    [],
  );
  if (!shown) return null;
  const { toast, url } = shown;
  return (
    <div className="toast-wrap">
      <div className="toast" role="status" aria-label="Screenshot" onPointerEnter={() => void bridge.invoke('toast:hover', true)} onPointerLeave={() => void bridge.invoke('toast:hover', false)} data-testid="toast">
        <button type="button" className="toast-picture" onClick={() => void bridge.invoke('toast:edit')} title="Edit the screenshot">
          <img src={url} alt="The screenshot, framed" draggable={false} />
        </button>
        <div className="toast-row">
          <span className="toast-text">
            {toast.copied && <CheckIcon size={14} />}
            <span>
              {toast.copied ? 'Copied' : 'Saved'}
              <small>
                {toast.width} × {toast.height}
              </small>
            </span>
          </span>
          <button type="button" className="primary" onClick={() => void bridge.invoke('toast:edit')} data-testid="toast-edit">
            Edit
          </button>
          <button type="button" className="icon" onClick={() => void bridge.invoke('toast:reveal')} title="Show in folder" aria-label="Show in folder">
            <FolderIcon size={15} />
          </button>
          <button type="button" className="icon" onClick={() => void bridge.invoke('toast:close')} title="Close" aria-label="Close">
            <CloseIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
