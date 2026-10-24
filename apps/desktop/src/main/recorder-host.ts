import { utilityProcess, type UtilityProcess } from 'electron';
import { APP_PID_VARIABLE, type Bounds, type Devices, type RecordOptions, type RecorderEvent, type ScreenShot, type ShotOptions, type Take } from '@cuttle/recorder';
import type { HostReply, HostRequest, LiveRequest } from '../shared/recording';
import { CHECK, TEST_BACKEND } from './check';
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

/** What the live captions tell: words they heard (newest last), or why they stopped. */
export type LiveNews = { words: string[] } | { failed: string };

interface Running {
  onEvent: (event: RecorderEvent) => void;
  onLive?: (news: LiveNews) => void;
  resolve: (take: Take) => void;
  reject: (error: Error) => void;
  /** The running ffmpegs' process ids, reported by the recorder as the tracks start (none while paused). */
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
  private readonly shots = new Map<number, { resolve: (shot: ScreenShot) => void; reject: (error: Error) => void }>();
  private running: Running | undefined;

  private start(): UtilityProcess {
    if (this.process) return this.process;
    // the app's windows (the editor, the settings, the HUD) are the recorder's own, as its process's are
    const env = { ...process.env, [APP_PID_VARIABLE]: String(process.pid) };
    const child = utilityProcess.fork(bundlePath('main', 'recorder-host.mjs'), TEST_BACKEND ? ['--test-backend'] : [], { serviceName: 'Cuttle recorder', stdio: 'ignore', env });
    child.on('message', (message: HostReply) => this.receive(message));
    child.on('exit', (code) => {
      // a host let go by refresh(): the new one's listings and recording are not its own
      if (this.process !== child) return;
      this.process = undefined;
      for (const listing of [...this.listings.values(), ...this.shots.values()]) listing.reject(new RecordingError('capture', 'the recorder stopped'));
      this.listings.clear();
      this.shots.clear();
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
      case 'shot': {
        const shot = this.shots.get(message.id);
        this.shots.delete(message.id);
        if (message.shot) shot?.resolve(message.shot);
        else shot?.reject(new RecordingError(message.code ?? 'capture', message.error ?? 'the screenshot failed'));
        return;
      }
      case 'event':
        if (message.event.type === 'processes' && this.running) this.running.pids.push(...message.event.pids);
        // paused: every capture has exited, and a process id can be given to another process later
        if (message.event.type === 'paused' && this.running) this.running.pids = [];
        this.running?.onEvent(message.event);
        return;
      case 'live':
        this.running?.onLive?.({ words: message.words });
        return;
      case 'live-failed':
        this.running?.onLive?.({ failed: message.message });
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

  /** A screenshot into a PNG, as the recorder takes it (`takeShot`). */
  shot(options: Omit<ShotOptions, 'backend' | 'devices'>): Promise<ScreenShot> {
    const id = this.next++;
    const promise = new Promise<ScreenShot>((resolve, reject) => this.shots.set(id, { resolve, reject }));
    this.send({ type: 'shot', id, options });
    return promise;
  }

  get recording(): boolean {
    return this.running !== undefined;
  }

  /**
   * Records a take; resolves with it when the recording stops (by `stop()`, the hotkey or a trigger).
   * With `live`, the mic's words come to `onLive` while it records.
   */
  record(options: Omit<RecordOptions, 'onEvent' | 'onAudio'>, onEvent: (event: RecorderEvent) => void, live?: { request: LiveRequest; onLive: (news: LiveNews) => void }): Promise<Take> {
    if (this.running) return Promise.reject(new RecordingError('invalid-options', 'a recording is already running'));
    const promise = new Promise<Take>((resolve, reject) => (this.running = { onEvent, ...(live && { onLive: live.onLive }), resolve, reject, pids: [] }));
    this.send({ type: 'start', options, ...(live && { live: live.request }) });
    return promise;
  }

  stop(): void {
    if (this.running) this.send({ type: 'stop' });
  }

  marker(label?: string): void {
    if (this.running) this.send({ type: 'marker', ...(label !== undefined && { label }) });
  }

  /** The mistake key: a `retake` marker. */
  retake(): void {
    if (this.running) this.send({ type: 'retake' });
  }

  /** A screenshot of what the take records, into the take: a `shot` marker and a `shot` event. */
  takeShot(): void {
    if (this.running) this.send({ type: 'take-shot' });
  }

  /** The script's next step, or the one before: a `step` marker (nothing at either end). */
  nextStep(): void {
    if (this.running) this.send({ type: 'step', delta: 1 });
  }

  previousStep(): void {
    if (this.running) this.send({ type: 'step', delta: -1 });
  }

  /** Pauses the take: every track stops until `resume()` (events `paused`, `resuming`, `resumed`). */
  pause(): void {
    if (this.running) this.send({ type: 'pause' });
  }

  resume(): void {
    if (this.running) this.send({ type: 'resume' });
  }

  setDeadZones(zones: Bounds[]): void {
    if (this.running) this.send({ type: 'dead-zones', zones });
  }

  quit(): void {
    this.process?.kill();
  }

  /** Ends the host while it does nothing, so the next one starts with the environment as it is now (ffmpeg found since). */
  refresh(): void {
    if (this.running || this.listings.size > 0 || this.shots.size > 0 || !this.process) return;
    const old = this.process;
    this.process = undefined;
    old.kill();
  }
}

export const recorderHost = new RecorderHost();
// the end-to-end check stops a take that a failed test left running, so the next test starts clean
if (CHECK) Object.assign(globalThis, { __recorder: recorderHost });
