import { utilityProcess, type UtilityProcess } from 'electron';
import type { Bounds, Devices, RecordOptions, RecorderEvent, Take } from '@cuttle/recorder';
import type { HostReply, HostRequest } from '../shared/recording';
import { TEST_BACKEND } from './check';
import { bundlePath } from './protocols';

/** A failed recording, with the recorder's error code (`capture`, `device-not-found`, …). */
export class RecordingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecordingError';
  }
}

interface Running {
  onEvent: (event: RecorderEvent) => void;
  resolve: (take: Take) => void;
  reject: (error: Error) => void;
  /** ffmpeg's process ids, reported by the recorder as the tracks start. */
  pids: number[];
}

/**
 * The recorder host: a utility process running `record()`. If it dies during a recording, every
 * capture process it reported is killed, so nothing keeps recording without the app knowing.
 */
export class RecorderHost {
  private process: UtilityProcess | undefined;
  private next = 1;
  private readonly listings = new Map<number, { resolve: (devices: Devices) => void; reject: (error: Error) => void }>();
  private running: Running | undefined;

  private start(): UtilityProcess {
    if (this.process) return this.process;
    const child = utilityProcess.fork(bundlePath('main', 'recorder-host.mjs'), TEST_BACKEND ? ['--test-backend'] : [], { serviceName: 'Cuttle recorder', stdio: 'ignore' });
    child.on('message', (message: HostReply) => this.receive(message));
    child.on('exit', (code) => {
      this.process = undefined;
      for (const listing of this.listings.values()) listing.reject(new RecordingError('capture', 'the recorder stopped'));
      this.listings.clear();
      const running = this.running;
      if (running) {
        this.running = undefined;
        for (const pid of running.pids) {
          try {
            process.kill(pid);
          } catch {
            // already gone
          }
        }
        running.reject(new RecordingError('capture', `the recorder stopped unexpectedly (exit code ${code}); the capture was ended`));
      }
    });
    this.process = child;
    return child;
  }

  private send(request: HostRequest): void {
    this.start().postMessage(request);
  }

  private receive(message: HostReply): void {
    switch (message.type) {
      case 'devices': {
        const listing = this.listings.get(message.id);
        this.listings.delete(message.id);
        if (message.devices) listing?.resolve(message.devices);
        else listing?.reject(new RecordingError('device-not-found', message.error ?? 'the devices could not be listed'));
        return;
      }
      case 'event':
        if (message.event.type === 'processes' && this.running) this.running.pids.push(...message.event.pids);
        this.running?.onEvent(message.event);
        return;
      case 'done': {
        const running = this.running;
        this.running = undefined;
        running?.resolve(message.take);
        return;
      }
      case 'failed': {
        const running = this.running;
        this.running = undefined;
        running?.reject(new RecordingError(message.code, message.message));
        return;
      }
    }
  }

  /** Monitors, windows, and (with `media`) cameras and mics, as the recorder sees them. */
  devices(media: boolean): Promise<Devices> {
    const id = this.next++;
    const promise = new Promise<Devices>((resolve, reject) => this.listings.set(id, { resolve, reject }));
    this.send({ type: 'devices', id, media });
    return promise;
  }

  get recording(): boolean {
    return this.running !== undefined;
  }

  /** Records a take; resolves with it when the recording stops (by `stop()`, the hotkey or a trigger). */
  record(options: Omit<RecordOptions, 'onEvent'>, onEvent: (event: RecorderEvent) => void): Promise<Take> {
    if (this.running) return Promise.reject(new RecordingError('invalid-options', 'a recording is already running'));
    const promise = new Promise<Take>((resolve, reject) => (this.running = { onEvent, resolve, reject, pids: [] }));
    this.send({ type: 'start', options });
    return promise;
  }

  stop(): void {
    if (this.running) this.send({ type: 'stop' });
  }

  marker(label?: string): void {
    if (this.running) this.send({ type: 'marker', ...(label !== undefined && { label }) });
  }

  setDeadZones(zones: Bounds[]): void {
    if (this.running) this.send({ type: 'dead-zones', zones });
  }

  quit(): void {
    this.process?.kill();
  }
}

export const recorderHost = new RecorderHost();
