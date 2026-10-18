// An editor's motion: the preview of its motion scenes and overlays (the export's pages, at the
// player's size), started once the editor shows one. It watches the project's folder: a page Claude
// (or anyone) edits loads again, and the editor draws it anew.
import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';
import { MotionPreview, type MotionFrameRequest, type MotionStatus, type PreviewMode } from '@cuttle/export';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import { copyTemplate } from '@cuttle/motion-kit/files';
import type { MotionParams } from '../shared/ipc';
import { pageInput } from './motion-inputs';

/** Changes closer together than this are one (a save is a write and a rename). */
const SETTLE_MS = 120;

export class EditorMotion {
  private preview: MotionPreview | undefined;
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private changes = 0;

  constructor(
    private readonly dir: string,
    private readonly events: { status: (statuses: MotionStatus[]) => void; changed: (files: number) => void },
  ) {}

  /** The preview, made on first use (with the project the editor sent before), and the watch with it. */
  private get running(): MotionPreview {
    if (!this.preview) {
      this.preview = new MotionPreview(this.dir, { onStatus: (statuses) => this.events.status(statuses) });
      if (this.pending) this.preview.setProject(this.pending.version, this.pending.raw);
      this.pending = undefined;
      this.startWatching();
    }
    return this.preview;
  }

  private startWatching(): void {
    try {
      this.watcher = watch(this.dir, { recursive: true }, (_event, name) => {
        if (name && !pageInput(name.split('/').join(sep))) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.preview?.filesChanged();
          this.events.changed(++this.changes);
        }, SETTLE_MS);
      });
      this.watcher.on('error', () => this.stopWatching());
    } catch {
      // a folder that cannot be watched: an edited page shows after Reload
    }
  }

  private stopWatching(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  project(version: number, raw: Record<string, unknown>): void {
    // nothing to do for a project the editor shows without motion: the preview starts with the first frame asked for
    if (this.preview) this.preview.setProject(version, raw);
    else this.pending = { version, raw };
  }

  /** The project sent before the preview started. */
  private pending: { version: number; raw: Record<string, unknown> } | undefined;

  frame(version: number, request: MotionFrameRequest, size: { width: number; height: number }, mode: PreviewMode, have?: number) {
    return this.running.frame(version, request, size, { mode, ...(have !== undefined && { have }) });
  }

  /** Frames across a motion scene for its block on the timeline. */
  strip(version: number, request: MotionFrameRequest, frames: readonly number[], size: { width: number; height: number }, have?: number) {
    return this.running.strip(version, request, frames, size, have);
  }

  params(src: string): Promise<MotionParams> {
    return this.running.params(src);
  }

  statuses(): MotionStatus[] {
    return this.preview?.currentStatuses() ?? [];
  }

  /** Loads an item's page again (Reload in the inspector), and the editor draws it anew. */
  reload(item: string): void {
    this.preview?.reload(item);
    this.events.changed(++this.changes);
  }

  /** Copies a template of the kit into `motion/<name>/`: the page's path in the project. */
  async addTemplate(template: string): Promise<string> {
    if (!MOTION_TEMPLATES.some((candidate) => candidate.name === template)) throw new Error(`no template "${template}"`);
    return copyTemplate(this.dir, template, template, import.meta.url);
  }

  dispose(): void {
    this.stopWatching();
    void this.preview?.close();
    this.preview = undefined;
  }
}
