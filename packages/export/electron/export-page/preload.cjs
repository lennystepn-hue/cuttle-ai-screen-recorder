// Bridge between the sandboxed export page and the main process (src/main/export.ts).
// The channel names repeat CHANNELS from src/job.ts: a sandboxed preload cannot import TypeScript.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cuttleHost', {
  job: () => ipcRenderer.invoke('cuttle-export:job'),
  size: (path) => ipcRenderer.invoke('cuttle-export:size', path),
  read: (path, start, end) => ipcRenderer.invoke('cuttle-export:read', path, start, end),
  readFile: (path) => ipcRenderer.invoke('cuttle-export:read-file', path),
  write: (data, position) => ipcRenderer.invoke('cuttle-export:write', data, position),
  progress: (done, total) => ipcRenderer.send('cuttle-export:progress', done, total),
});
