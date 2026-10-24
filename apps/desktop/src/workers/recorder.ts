// The recorder host: a utility process that runs `record()` (its input hook and koffi calls work
// here, away from the main process's event loop), and the take's live captions from the mic's
// samples. One recording at a time; the main process sees every event and kills the capture
// processes if this process dies.
import { liveCaptions } from '@cuttle/core';
import { listDevices, record, RecorderError, takeShot, type Backend, type Recording } from '@cuttle/recorder';
import type { HostReply, HostRequest } from '../shared/recording';

interface ParentPort {
  on(event: 'message', listener: (message: { data: HostRequest }) => void): void;
  postMessage(message: HostReply): void;
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort;
/** The main process asks for the `test` backend only in the end-to-end check. */
const backend: Backend = process.argv.includes('--test-backend') ? 'test' : 'auto';
let recording: Recording | undefined;

const reply = (message: HostReply) => port.postMessage(message);

port.on('message', ({ data }) => {
  switch (data.type) {
    case 'devices':
      listDevices({ backend, media: data.media }).then(
        (devices) => reply({ type: 'devices', id: data.id, devices }),
        (error: Error) => reply({ type: 'devices', id: data.id, error: error.message }),
      );
      return;
    case 'shot':
      takeShot({ ...data.options, backend }).then(
        (shot) => reply({ type: 'shot', id: data.id, shot }),
        (error: unknown) => reply({ type: 'shot', id: data.id, code: error instanceof RecorderError ? error.code : 'capture', error: error instanceof Error ? error.message : String(error) }),
      );
      return;
    case 'start': {
      if (recording) return reply({ type: 'failed', code: 'invalid-options', message: 'a recording is already running' });
      const live =
        data.live &&
        liveCaptions({
          ...data.live,
          onWords: (words) => reply({ type: 'live', words: words.map((word) => word.text) }),
          onError: (error) => reply({ type: 'live-failed', message: error.message }),
        });
      const current = record({
        ...data.options,
        backend,
        onEvent: (event) => {
          if (event.type === 'stopping') live?.stop();
          reply({ type: 'event', event });
        },
        ...(live && { onAudio: (samples: Uint8Array) => live.push(samples) }),
      });
      recording = current;
      current.done.then(
        (take) => reply({ type: 'done', take }),
        (error: unknown) =>
          reply({ type: 'failed', code: error instanceof RecorderError ? error.code : 'capture', message: error instanceof Error ? error.message : String(error) }),
      ).finally(() => {
        live?.stop();
        if (recording === current) recording = undefined;
      });
      return;
    }
    case 'stop':
      void recording?.stop().catch(() => {});
      return;
    case 'marker':
      recording?.marker(data.label);
      return;
    case 'retake':
      recording?.retake();
      return;
    case 'step':
      if (data.delta === 1) recording?.next();
      else recording?.previous();
      return;
    case 'pause':
      recording?.pause();
      return;
    case 'resume':
      recording?.resume();
      return;
    case 'dead-zones':
      recording?.setDeadZones(data.zones);
      return;
  }
});
