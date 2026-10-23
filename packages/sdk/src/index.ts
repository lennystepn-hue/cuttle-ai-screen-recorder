// @cuttle/sdk: a Cuttle video built in code and rendered, from a script or a product. A video is a
// project folder with its cuttle.json: `video()` builds one (scenes, overlays, captions, music, the
// look), typed and checked by the project's own schema; `save()` writes it; `render()` and
// `preview()` run the cuttle command on it, as a person or an agent would in a terminal, and answer
// with its JSON. Motion and music templates are copied into the folder as `cuttle motion new` does.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { copyTemplate } from '@cuttle/motion-kit/files';
import { CURRENT_VERSION, parseProject, type CuttleProject, type CuttleProjectInput } from '@cuttle/project';

export { newsOf } from './notes';

type SceneInput = NonNullable<CuttleProjectInput['scenes']>[number];
type OverlayInput = NonNullable<CuttleProjectInput['overlays']>[number];
type TextInput = NonNullable<CuttleProjectInput['texts']>[number];
type SoundInput = NonNullable<CuttleProjectInput['sounds']>[number];
type MusicInput = NonNullable<CuttleProjectInput['music']>;

/** The video's size: a format, or its own width, height and frame rate. */
export type Output = '16:9' | '1:1' | '9:16' | { width: number; height: number; fps?: number };

const FORMATS = { '16:9': { width: 1920, height: 1080 }, '1:1': { width: 1080, height: 1080 }, '9:16': { width: 1080, height: 1920 } } as const;

export interface VideoOptions {
  /** The project folder (made when missing): its cuttle.json, its pages, its renders in out/. */
  dir: string;
  output?: Output;
  fps?: number;
  /** The look, as in cuttle.json (`look`): background, frame, captions' style, … */
  look?: CuttleProjectInput['look'];
  /** The brand the motion pages wear (`theme`): name, URL, logo, colours, heading font. */
  theme?: CuttleProjectInput['theme'];
  /** The cuttle command: its path (a `.mjs` runs with this Node), else `CUTTLE_CLI`, else `cuttle` on the PATH. */
  cli?: string;
}

/** A motion page as a scene: an HTML file in the project, as long as `duration` (seconds). */
export function motion(src: string, options: { duration?: number; params?: Record<string, string | number | boolean | null>; label?: string } = {}): SceneInput {
  return { type: 'motion', src, duration: options.duration ?? 3, ...(options.params && { params: options.params }), ...(options.label && { label: options.label }) };
}

/** A title or end card on the background. */
export function card(title: string, options: { subtitle?: string; duration?: number; enter?: Extract<SceneInput, { type: 'card' }>['enter'] } = {}): SceneInput {
  return { type: 'card', title, ...(options.subtitle && { subtitle: options.subtitle }), duration: options.duration ?? 2, ...(options.enter && { enter: options.enter }) };
}

/** An image of the project (a page captured, a screenshot) as a scene, still or scrolling. */
export function still(image: string, options: { duration?: number; motion?: Extract<SceneInput, { type: 'still' }>['motion'] } = {}): SceneInput {
  return { type: 'still', image, duration: options.duration ?? 3, ...(options.motion && { motion: options.motion }) };
}

/** A stretch of the take (source seconds), at a speed. */
export function clip(from: number, to: number, options: { speed?: number; label?: string } = {}): SceneInput {
  return { type: 'clip', from, to, ...(options.speed !== undefined && { speed: options.speed }), ...(options.label && { label: options.label }) };
}

/** What `render()` answers: the CLI's JSON (one video, or `{ videos }` for several formats). */
export type RenderResult = Record<string, unknown>;

/** A video being built: its project, then saved and rendered. */
export class Video {
  readonly dir: string;
  private readonly project: CuttleProjectInput;
  private readonly cli: string | undefined;

  constructor(options: VideoOptions) {
    this.dir = resolve(options.dir);
    const size = typeof options.output === 'object' ? options.output : FORMATS[options.output ?? '16:9'];
    const fps = (typeof options.output === 'object' ? options.output.fps : undefined) ?? options.fps;
    this.project = {
      version: CURRENT_VERSION,
      output: { width: size.width, height: size.height, ...(fps !== undefined && { fps }) },
      // a video in code has no take; the screen named is never read
      sources: { screen: 'takes/1/screen.mp4' },
      scenes: [],
      ...(options.look && { look: options.look }),
      ...(options.theme && { theme: options.theme }),
    };
    this.cli = options.cli;
  }

  /** Adds a scene at the end (`motion()`, `card()`, `still()`, `clip()`). */
  scene(scene: SceneInput): this {
    this.project.scenes = [...(this.project.scenes ?? []), scene];
    return this;
  }

  /** A motion page over the clips from `at` for `duration` (source seconds). */
  overlay(src: string, options: { at: number; duration: number; params?: Record<string, string | number | boolean | null> }): this {
    const overlay: OverlayInput = { src, at: options.at, duration: options.duration, ...(options.params && { params: options.params }) };
    this.project.overlays = [...(this.project.overlays ?? []), overlay];
    return this;
  }

  /** A caption over the clips (source seconds), as `texts` in cuttle.json. */
  caption(text: string, options: Omit<TextInput, 'text'>): this {
    this.project.texts = [...(this.project.texts ?? []), { ...options, text }];
    return this;
  }

  /** The video's music: a page of the project (`music/<name>/index.html`), or a template's copy (`template()`). */
  music(src: string, options: Omit<MusicInput, 'src'> = {}): this {
    this.project.music = { ...options, src };
    return this;
  }

  /** A sound at a moment: a built-in one (`whoosh`, `pop`, `cuttle sound list`) or a file of the project. */
  sound(sound: string, options: Omit<SoundInput, 'sound'>): this {
    this.project.sounds = [...(this.project.sounds ?? []), { ...options, sound }];
    return this;
  }

  /** Changes the project as cuttle.json has it, for what the builders do not cover. */
  edit(change: (project: CuttleProjectInput) => void): this {
    change(this.project);
    return this;
  }

  /**
   * Copies a motion template (`title`, `end-card`, `lower-third`, …; `cuttle motion templates`) or a
   * music template (`music: true`: `lofi`, `pulse`, …) into the folder, as its own page to change:
   * its `src`, for `motion()`, `overlay()` or `music()`.
   */
  async template(name: string, options: { music?: boolean; as?: string } = {}): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    return copyTemplate(this.dir, options.music ? `music-${name}` : name, options.as ?? name, import.meta.url, options.music ? 'music' : 'motion');
  }

  /** The project as it is now, with its defaults (throws with what is wrong, as cuttle would). */
  toProject(): CuttleProject {
    const parsed = parseProject(this.project);
    if (!parsed.ok) throw new Error(`the video is not a valid project:\n${parsed.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`);
    return parsed.project;
  }

  /** Writes cuttle.json into the folder (checked first); its path. */
  async save(): Promise<string> {
    this.toProject();
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, 'cuttle.json');
    await writeFile(path, `${JSON.stringify(this.project, null, 2)}\n`);
    return path;
  }

  /**
   * Saves, then renders: `out/<format>.mp4` in the folder unless `out`; several `formats` in one go;
   * `loudness`, `size` (4k), `fps`, `codec` (hevc) and `alpha` as `cuttle render` has them.
   */
  async render(options: { out?: string; formats?: ('16:9' | '1:1' | '9:16')[]; loudness?: 'youtube' | 'podcast' | 'broadcast' | 'off'; size?: 'hd' | '4k'; fps?: number; codec?: 'h264' | 'hevc'; alpha?: boolean } = {}): Promise<RenderResult> {
    await this.save();
    return this.run([
      'render',
      ...(options.formats ?? []).flatMap((format) => ['--format', format]),
      ...(options.out ? ['-o', resolve(options.out)] : []),
      ...(options.loudness ? ['--loudness', options.loudness] : []),
      ...(options.size ? ['--size', options.size] : []),
      ...(options.fps !== undefined ? ['--fps', String(options.fps)] : []),
      ...(options.codec ? ['--codec', options.codec] : []),
      ...(options.alpha ? ['--alpha'] : []),
    ]);
  }

  /** Saves, then renders stills (output seconds, else twelve over the video with a sheet) into preview/. */
  async preview(options: { at?: number[]; sheet?: boolean } = {}): Promise<RenderResult> {
    await this.save();
    return this.run(['preview', ...(options.at ?? []).flatMap((t) => ['--at', String(t)]), ...(options.sheet ? ['--sheet'] : [])]);
  }

  /** Runs `cuttle --json -C <dir> …args` and answers with its JSON; its error as an Error. */
  run(args: readonly string[]): Promise<RenderResult> {
    return runCuttle(['--json', '-C', this.dir, ...args], this.cli);
  }
}

/** A video in code: its folder, its size and look; then its scenes, `save()`, `render()`. */
export function video(options: VideoOptions): Video {
  return new Video(options);
}

/** The cuttle command to run: a path to the CLI's `.mjs` runs with this Node; anything else as a command (on Windows through `cmd`, for `cuttle.cmd`). */
export function cuttleCommand(cli = process.env.CUTTLE_CLI ?? 'cuttle', platform = process.platform): { command: string; prefix: string[]; shell: boolean } {
  if (/\.m?js$/i.test(cli)) return { command: process.execPath, prefix: [cli], shell: false };
  return { command: cli, prefix: [], shell: platform === 'win32' };
}

/** Runs the cuttle command with `args` (its `--json` among them); resolves with its JSON, rejects with its error. */
export function runCuttle(args: readonly string[], cli?: string): Promise<RenderResult> {
  const { command, prefix, shell } = cuttleCommand(cli);
  return new Promise((done, fail) => {
    const child = spawn(command, [...prefix, ...args], { shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)));
    child.on('error', (error) => fail(new Error(`the cuttle command could not start (${command}): ${error.message}; install it (pnpm cli:install) or set CUTTLE_CLI`)));
    child.on('close', (code) => {
      let json: RenderResult | undefined;
      try {
        json = JSON.parse(stdout) as RenderResult;
      } catch {
        // no JSON: the error below says what it printed
      }
      const failure = json?.error as { code?: string; message?: string } | undefined;
      if (code === 0 && json && !failure) return done(json);
      fail(Object.assign(new Error(failure?.message ?? `cuttle exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join('\n')}`), { code: failure?.code ?? 'internal' }));
    });
  });
}
