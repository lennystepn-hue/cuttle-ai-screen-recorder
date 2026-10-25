import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { annotateCommand, type AnnotateArgs } from './commands/annotate';
import { cameraCommand, type CameraArgs } from './commands/camera';
import { backgroundCommand, type BackgroundArgs } from './commands/background';
import { brandApplyCommand, brandListCommand, brandRemoveCommand, brandSaveCommand } from './commands/brand';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { importCommand, type ImportArgs } from './commands/import';
import { init } from './commands/init';
import { itemsCommand, type ItemsArgs } from './commands/items';
import { zoomPathCommand, type ZoomPathArgs } from './commands/zoom-path';
import { openCommand } from './commands/open';
import { watchCommand } from './commands/watch';
import { webcamBackgroundCommand } from './commands/webcam';
import { motionAddCommand, motionCheckCommand, motionNewCommand, motionTemplatesCommand } from './commands/motion';
import { musicCheckCommand, musicNewCommand, musicSetCommand, musicTemplatesCommand, soundAddCommand, soundListCommand } from './commands/music';
import { previewCommand } from './commands/preview';
import { shotFrameCommand, shotStylesCommand, shotTakeCommand, type ShotFrameArgs, type ShotTakeArgs } from './commands/shot';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
import { renderAllCommand, renderCommand, renderStillCommand } from './commands/render';
import { chaptersCommand } from './commands/chapters';
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
import { transcriptCommand, translateCommand } from './commands/transcript';
import { captionsSetCommand, type CaptionsSetArgs } from './commands/captions';
import { voiceAddCommand, voiceDownloadCommand, voiceListCommand, voiceRemoveCommand, voiceRenderCommand, voiceUseCommand, type VoiceAddArgs, type VoiceUseArgs } from './commands/voice';
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.3.2';

const seconds = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InvalidArgumentError('expected seconds, 0 or more');
  return parsed;
};
const positive = (value: string): number => {
  const parsed = seconds(value);
  if (parsed === 0) throw new InvalidArgumentError('expected more than 0 seconds');
  return parsed;
};
const integer = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new InvalidArgumentError('expected a whole number, 0 or more');
  return parsed;
};
const pixels = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16_384) throw new InvalidArgumentError('expected whole pixels from 1 to 16384');
  return parsed;
};
const collect = (value: string, previous: number[] = []): number[] => [...previous, seconds(value)];
const fraction = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new InvalidArgumentError('expected a number from 0 to 1');
  return parsed;
};
const speed = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 2) throw new InvalidArgumentError('expected a speed from 0.5 to 2');
  return parsed;
};
const degrees = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 360) throw new InvalidArgumentError('expected degrees from 0 to 360');
  return parsed;
};
/** A length in points (a shot's padding, its corners): 0 to 1000. */
const points = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) throw new InvalidArgumentError('expected points from 0 to 1000');
  return parsed;
};
/** A share of a shot past its edge: 0 to 0.6. */
const bleedShare = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0.6) throw new InvalidArgumentError('expected a share from 0 to 0.6');
  return parsed;
};
/** An option given again adds to the ones before. */
const collectText = (value: string, previous: string[] = []): string[] => [...previous, value];
/** Pixels per point: more than 0, at most 8. */
const scale = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 8) throw new InvalidArgumentError('expected a scale more than 0 and at most 8 (2: two pixels a point)');
  return parsed;
};
/** Seconds either way: negative is earlier. */
const signedSeconds = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InvalidArgumentError('expected seconds, negative to move earlier');
  return parsed;
};
const decibels = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 40) throw new InvalidArgumentError('expected decibels from 0 to 40');
  return parsed;
};

/** `--json` before a `--`: usage errors then answer in JSON too. */
const wantsJson = (argv: readonly string[]): boolean => {
  const end = argv.indexOf('--');
  return (end < 0 ? argv : argv.slice(0, end)).includes('--json');
};

/**
 * Ctrl+C (and SIGTERM, SIGBREAK) as an AbortSignal for the commands that can stop cleanly; a second
 * one exits at once. `dispose` removes the handlers.
 */
function interruptible(output: Output): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onSignal = () => {
    if (controller.signal.aborted) process.exit(EXIT.cancelled);
    output.info('stopping … (Ctrl+C again to quit at once)');
    controller.abort();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;
  for (const name of signals) process.on(name, onSignal);
  return { signal: controller.signal, dispose: () => signals.forEach((name) => process.off(name, onSignal)) };
}

/** Runs the CLI with `argv` (without node and the script); returns the exit code. */
export async function runCli(argv: readonly string[], streams?: Streams): Promise<number> {
  let exitCode: number = EXIT.ok;
  const program = new Command('cuttle')
    .description('Record a screen take and turn it into a polished demo video')
    .version(VERSION)
    .option('-C, --project <dir>', 'the project folder', '.')
    .option('--json', 'machine-readable output: one JSON document on stdout')
    .showHelpAfterError()
    .exitOverride();
  // With --json, help and version text become the JSON document (see the end), so stdout holds one.
  const json = wantsJson(argv);
  let shown = '';
  program.configureOutput({
    writeOut: json ? (text) => void (shown += text) : (streams?.stdout ?? ((text) => void process.stdout.write(text))),
    writeErr: streams?.stderr ?? ((text) => void process.stderr.write(text)),
  });

  /** Wraps a command's action: output with the global options, errors mapped to exit codes. */
  const action =
    <A extends unknown[]>(run: (output: Output, project: string, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const globals = program.opts<{ project: string; json?: boolean }>();
      const output = createOutput(globals.json ?? false, streams);
      try {
        await run(output, globals.project, ...args);
      } catch (error) {
        const failure = toCliError(error);
        output.error(failure);
        exitCode = failure.exitCode;
      }
    };
  const withSignal = async <T>(output: Output, body: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const interrupt = interruptible(output);
    try {
      return await body(interrupt.signal);
    } finally {
      interrupt.dispose();
    }
  };

  program
    .command('init [dir]')
    .description('create a project folder with a default cuttle.json')
    .action(action((output, project, dir?: string) => init(dir ?? project, output)));

  program
    .command('devices')
    .description('list monitors (index, size, position), windows, cameras and microphones')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(action((output, _project, options: { backend: 'auto' | 'test' }) => devices(options.backend, output)));

  program
    .command('record')
    .description('record a take into the project and use it')
    .option('--monitor <n>', 'monitor index from "cuttle devices" (default: the primary monitor)', integer)
    .option('--region <x,y,w,h...>', 'a region of the monitor in its pixels, e.g. 0,0,1920,1080')
    .option('--window <title>', 'a window, by (part of) its title')
    .option('--webcam [name]', 'record a webcam (default: the first one)')
    .option('--mic [name]', 'record a microphone (default: the first one)')
    .option('--system-audio', "record what the computer plays (its apps' sound) as a track of its own, beside the mic")
    .option('--until-claude [cwd]', 'stop when the Claude Code session in that folder (default: here) finishes its turn, after what it runs in the background')
    .option('--until-file <path>', 'stop when this file appears')
    .option('--until-idle <seconds>', 'stop when the screen and the input rested this long', positive)
    .option('--max <seconds>', 'stop after this long', positive)
    .option('--countdown <seconds>', 'seconds before the recording starts (default 3)', seconds)
    .option('--draw-mouse', 'bake the real pointer into the video')
    .option('--force', 'record even when the project is open in the Cuttle app')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(
      action((output, project, options: Parameters<typeof recordCommand>[1]) =>
        withSignal(output, (signal) => recordCommand(project, options, output, signal)),
      ),
    );

  program
    .command('import <file>')
    .description('a video made elsewhere (a phone, OBS, a download) as the next take, converted as a recording is (30 fps, BT.709), its sound as the mic; the project uses it')
    .option('--from <seconds>', 'start at this second of the file', seconds)
    .option('--to <seconds>', 'end at this second of the file', positive)
    .option('--force', 'import even when the project is open in the Cuttle app')
    .action(action((output, project, file: string, options: ImportArgs) => importCommand(project, file, options, output)));

  program
    .command('suggest')
    .description("propose scenes (quiet start and end trimmed, idle cut, waiting sped up, cropped to the content), a zoom on the answer, zooms on dialogs, zooms that follow typing and zooms on clicks, and the script's steps' titles and zooms")
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on dialogs, nor on typing, nor on clicks)')
    .option('--no-crop', 'no crop to the content (a browser\'s page without its tabs and bars)')
    .option('--no-privacy', "no privacy masks (and the screen's text is not read)")
    .option('--mask <word>', 'mask this word wherever the screen shows it (a name, an address); kept in cuttle.json', (word: string, words: string[]) => [...words, word], [] as string[])
    .option('--no-dialog-zooms', 'no zooms on dialogs')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-step-zooms', "no zooms on where the script's steps happen")
    .option('--no-step-titles', "no titles for the script's steps")
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--length <seconds>', 'fit the video to this length: what rests is cut, never speech, clicks or typing', positive)
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, { mask, ...options }: { claude?: string | true; zoom: boolean; crop: boolean; privacy: boolean; mask: string[]; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; stepZooms: boolean; stepTitles: boolean; speech: boolean; transcribe: boolean; length?: number; dryRun?: boolean }) =>
        suggestCommand(project, { ...options, ...(mask.length > 0 && { maskWords: mask }) }, output),
      ),
    );

  program
    .command('transcribe')
    .description("what the mic said, word by word, into the take's transcript.json (a speech model is needed: cuttle models)")
    .option('--model <name>', 'base, small or large-v3-turbo-q5_0 (default: small when downloaded)')
    .option('--language <code>', 'auto, de, en, … (default: auto)')
    .action(
      action((output, project, options: { model?: string; language?: string }) => withSignal(output, (signal) => transcribeCommand(project, options, output, signal))),
    );

  const models = program.command('models').description('the speech models for transcribe: list, download or remove them');
  models
    .command('list', { isDefault: true })
    .description('the models, and which are downloaded')
    .action(action((output) => modelsListCommand(output)));
  models
    .command('download <name>')
    .description('download a model once (base 148 MB, small 488 MB, large-v3-turbo-q5_0 574 MB), checked by its checksum')
    .action(action((output, _project, name: string) => withSignal(output, (signal) => modelsDownloadCommand(name, output, signal))));
  models
    .command('remove <name>')
    .description('remove a downloaded model')
    .action(action((output, _project, name: string) => modelsRemoveCommand(name, output)));

  program
    .command('preview')
    .description('PNG stills of the output, and a contact sheet')
    .option('--at <seconds...>', 'output times (default: 12 evenly spaced, with a sheet)', collect)
    .option('--masks', "stills just before, inside and after each mask's start and end, with a sheet (a row per mask)")
    .option('--sheet', 'also a contact sheet of the stills')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <dir>', 'folder for the PNGs (default: preview/ in the project)')
    .option('--alpha', 'with transparency, no background (as render --alpha)')
    .action(
      action((output, project, options: { at?: number[]; masks?: boolean; sheet?: boolean; format?: string; out?: string; alpha?: boolean }) =>
        withSignal(output, (signal) => previewCommand(project, options, output, signal)),
      ),
    );

  const motion = program.command('motion').description('motion pages: scenes, overlays and transitions drawn by code (HTML, CSS, canvas, SVG, WebGL): write your own, or start from a template');
  motion
    .command('add <page>')
    .description('add a page you wrote (any page in the project) to the video: a scene at the end, an overlay over the clips, or the transition into a scene')
    .option('--as <kind>', 'scene, overlay or transition (default: scene)')
    .option('--label <text>', 'its name on the timeline (default: from its folder)')
    .option('--duration <seconds>', 'how long it lasts (default: a scene 3 s, a transition 0.8 s, an overlay the rest of the clips)', positive)
    .option('--first', 'a scene goes first instead of last (an intro)')
    .option('--after <scene>', 'a scene goes right after this one, by id or place from 0')
    .option('--at <seconds>', 'an overlay\'s start, in source seconds (default: the first clip\'s start)', seconds)
    .option('--into <scene>', 'a transition: the scene it leads into, by id or place from 0 (default: the second scene)')
    .action(
      action((output, project, page: string, options: { as?: string; label?: string; duration?: number; first?: boolean; after?: string; at?: number; into?: string }) =>
        motionAddCommand(project, page, options, output),
      ),
    );
  motion
    .command('new <template>')
    .description('copy a template into motion/<name>/ and add it, as a starting point to make your own: a scene at the end, an overlay over the clips, or the transition into a scene (motion templates lists them)')
    .option('--name <name>', 'the folder in motion/ (default: the template\'s name)')
    .option('--at <seconds>', 'an overlay\'s start, in source seconds (default: the first clip\'s start)', seconds)
    .option('--duration <seconds>', 'how long it lasts (default: the template\'s; a callout or caption overlay: the whole take)', positive)
    .option('--first', 'a scene goes first instead of last (an intro)')
    .option('--after <scene>', 'a scene goes right after this one, by id or place from 0')
    .option('--into <scene>', 'a transition: the scene it leads into, by id or place from 0 (default: the second scene)')
    .action(
      action((output, project, template: string, options: { name?: string; at?: number; duration?: number; first?: boolean; after?: string; into?: string }) =>
        motionNewCommand(project, template, options, output),
      ),
    );
  motion
    .command('templates')
    .description('the templates motion new copies (starting points: any page of your own goes in with motion add)')
    .action(action((output) => motionTemplatesCommand(output)));
  motion
    .command('check <src>')
    .description('render a motion page frame by frame as the export draws it: PNGs, a contact sheet, its errors and console')
    .option('--duration <seconds>', 'how long it lasts (default: as in cuttle.json, else 3)', positive)
    .option('--at <seconds...>', 'seconds into it (default: 8 from its start to its end)', collect)
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <dir>', 'folder for the PNGs (default: preview/motion-<name>/ in the project)')
    .action(
      action((output, project, src: string, options: { duration?: number; at?: number[]; format?: string; out?: string }) =>
        withSignal(output, (signal) => motionCheckCommand(project, src, options, output, signal)),
      ),
    );

  const music = program.command('music').description('the video\'s music: a page that composes it for this video in WebAudio, fitted to its scenes and cuts');
  music
    .command('new <template>')
    .description('copy a music template into music/<name>/ and make it the video\'s music (music templates lists them)')
    .option('--name <name>', 'the folder in music/ (default: the template\'s name)')
    .action(action((output, project, template: string, options: { name?: string }) => musicNewCommand(project, template, options, output)));
  music
    .command('templates')
    .description('the music templates music new copies')
    .action(action((output) => musicTemplatesCommand(output)));
  music
    .command('set')
    .description('the music\'s level, its duck under speech, its page\'s params, its page, or on and off')
    .option('--volume <0-1>', 'its level', (value: string) => fraction(value))
    .option('--duck <dB>', 'how far it goes down under speech (0: not at all)', (value: string) => decibels(value))
    .option('--param <name=value...>', 'a param of the page (name= removes it)', (value: string, previous: string[] = []) => [...previous, value])
    .option('--stem <name=level...>', "a stem's level: drums, bass, keys, pads, lead (music check lists them), 0 silent to 2, 1 as composed", (value: string, previous: string[] = []) => [...previous, value])
    .option('--src <page>', 'another page in the project')
    .option('--on', 'play it')
    .option('--off', 'leave it out')
    .action(action((output, project, options: { volume?: number; duck?: number; param?: string[]; stem?: string[]; src?: string; on?: boolean; off?: boolean }) => musicSetCommand(project, options, output)));
  music
    .command('check')
    .description('render the music and sounds alone: a WAV, a sheet of the waveforms over the scenes, loudness, hits on the scene changes, errors')
    .option('--src <page>', 'check this page instead of the project\'s music')
    .option('-o, --out <dir>', 'folder for music.wav and music.png (default: preview/ in the project)')
    .action(action((output, project, options: { src?: string; out?: string }) => withSignal(output, (signal) => musicCheckCommand(project, options, output, signal))));

  program
    .command('background')
    .argument('[preset]', 'sunset-sky, aurora, mesh, solid, image, gradient, flow, bokeh or dots (default: the one it has, or what the options ask for)')
    .description('the background behind the window: a preset, a gradient of your colours or the product\'s, an image or the desktop\'s wallpaper, softened and darkened')
    .option('--colors <list>', 'colours, comma-separated: a gradient\'s stops (2 to 4), or the tints of mesh, flow, bokeh and dots')
    .option('--from <source>', 'the colours read off "take" (the screen recording), "logo" (the brand\'s) or an image file')
    .option('--angle <degrees>', 'a gradient\'s direction: 0 to the top, 90 to the right (default 135)', degrees)
    .option('--radial', 'a gradient from the centre out')
    .option('--linear', 'a gradient along its angle (the default)')
    .option('--color <hex>', 'the solid background\'s colour')
    .option('--image <file>', 'an image (copied into images/ when it is outside the project)')
    .option('--wallpaper', 'the desktop\'s wallpaper as the image, softened (copied into images/)')
    .option('--blur <0-1>', 'how soft the image is: 0 sharp, 1 a wash of its colours', fraction)
    .option('--dim <0-0.8>', 'how much darker the image is', fraction)
    .action(action((output, project, preset: string | undefined, options: BackgroundArgs) => backgroundCommand(project, preset, options, output)));

  /** A screenshot's look: what `shot take` and `shot frame` both take. */
  const shotLook = (command: Command): Command =>
    command
      .option('--background <preset>', `sunset-sky, aurora, mesh, solid, image, gradient, flow, bokeh or dots (default: sunset-sky, or what the options ask for)`)
      .option('--colors <list>', 'colours, comma-separated: a gradient\'s stops (2 to 4), or the tints of mesh, flow, bokeh and dots')
      .option('--from <source>', 'the colours read off "shot" (the image itself) or an image file')
      .option('--angle <degrees>', 'a gradient\'s direction: 0 to the top, 90 to the right (default 135)', degrees)
      .option('--radial', 'a gradient from the centre out')
      .option('--linear', 'a gradient along its angle (the default)')
      .option('--color <hex>', 'the solid background\'s colour')
      .option('--image <file>', 'an image behind the shot')
      .option('--wallpaper', 'the desktop\'s wallpaper behind the shot, softened')
      .option('--blur <0-1>', 'how soft the image is: 0 sharp, 1 a wash of its colours', fraction)
      .option('--dim <0-0.8>', 'how much darker the image is', fraction)
      .option('--transparent', 'no background: the framed shot and its shadow on nothing (PNG or WebP)')
      .option('--no-transparent', 'the background again')
      .option('--frame <style>', 'none (the image alone, rounded), mac-dark, mac-light, browser-light, browser-dark, windows-light, windows-dark, terminal, iphone or android (default none)')
      .option('--title <text>', 'the title bar\'s text: a window\'s title, a browser\'s address, a terminal\'s path')
      .option('--radius <points>', 'the corner radius (default 12)', points)
      .option('--shadow', 'a soft shadow under it (the default)')
      .option('--no-shadow', 'no shadow')
      .option('--padding <points>', 'space around it (default 64)', points)
      .option('--size <size>', 'auto (it and its padding, pixel for pixel), a ratio the canvas grows to (16:9, 1:1, 4:5, 9:16, 1.91:1), pixels it is fitted into (1200x630), or what it is for: x, youtube, square, instagram, linkedin, story, og, x-header, app-store-iphone, app-store-mac')
      .option('--crop <x,y,w,h>', 'only this part of the image, in its pixels')
      .option('--shot-scale <n>', "the image's pixels per point: 2 from a Retina display (default: from a PNG's resolution, else 1)", scale)
      .option('--scale <n>', 'the output\'s pixels per point (default: the image\'s own, pixel for pixel)', scale)
      .option('--quality <0-1>', 'a JPEG\'s or WebP\'s quality', fraction)
      .option('--align <side>', 'where the shot sits in a canvas larger than it: center (default), top, bottom, left or right')
      .option('--bleed <0-0.6>', 'the share of the shot that reaches past the edge it is aligned to (a product shot cut off by it)', bleedShare)
      .option('--headline <title>', 'a title on the background, above the shot (a launch image, a feature card)')
      .option('--no-headline', 'no headline')
      .option('--subtitle <text>', 'a line under the headline')
      .option('--headline-position <side>', 'the headline above (default) or below the shot')
      .option('--headline-color <hex>', "the headline's colour (default white; dark on nothing)")
      .option('--font <name>', "the headline's and a watermark's font: Archivo (default), Inter, Space Grotesk, Fraunces, Instrument Serif or Bebas Neue")
      .option('--mask <x,y,w,h>', 'a part of the image blurred, in its pixels (again for another)', collectText)
      .option('--redact', "read the shot's text on this computer (Windows' OCR, macOS's Vision) and mask what is private in it: email addresses, keys, tokens, IBANs, card and phone numbers")
      .option('--clear-masks', 'no masks (before the ones given)')
      .option('--brand <name>', "a brand kit's background, frame, font and logo (cuttle brand list)")
      .option('--style <name>', "a saved style's look (cuttle shot styles)")
      .option('--save-style <name>', 'keep the look as a style, to frame other shots with')
      .option('--watermark <logo or text>', 'a logo (an image file) or a name in a corner')
      .option('--no-watermark', 'no watermark');
  const shot = program.command('shot').description('screenshots framed as the videos are: the image in a window, a browser, a phone or alone, on a background, with rounded corners and a shadow, pixel for pixel');
  shotLook(
    shot
      .command('take', { isDefault: true })
      .description('takes a screenshot of the primary monitor, another one, a region of it or a window (by itself), keeps it as a shot folder and frames it')
      .option('--monitor <n>', 'monitor index from "cuttle devices" (default: the primary monitor)', integer)
      .option('--region <x,y,w,h...>', 'a region of the monitor in its pixels, e.g. 0,0,1920,1080')
      .option('--window <title>', 'a window by itself, by (part of) its title')
      .option('--delay <seconds>', 'wait this long first (to open a menu)', seconds)
      .option('--cursor', 'with the pointer')
      .option('--raw', 'the picture alone, not framed')
      .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp()),
  )
    .option('-o, --out <file>', 'the framed image: .png, .jpg or .webp (default: shot.png in the shot\'s folder)')
    .option('--save <folder>', `the shot's folder (default: a new one in ${process.platform === 'win32' ? 'Pictures\\Cuttle' : 'Pictures/Cuttle'})`)
    .action(action((output, _project, options: ShotTakeArgs) => withSignal(output, (signal) => shotTakeCommand(options, output, signal))));
  shot
    .command('styles')
    .description('the saved screenshot styles (shot frame --save-style), and where they are kept')
    .option('--remove <name>', 'forget a style')
    .action(action((output, _project, options: { remove?: string }) => shotStylesCommand(options, output)));
  shotLook(shot.command('frame <image>').description('frames a PNG, JPEG or WebP (or a shot folder made with --save) and writes it as a PNG, JPEG or WebP'))
    .option('-o, --out <file>', 'the image to write: .png, .jpg or .webp (default: <image>-framed.png beside it; a shot folder\'s shot.png)')
    .option('--save <folder>', 'also keep the shot as a folder (shot.json, its image, shot.png), to frame it again with other options')
    .action(action((output, _project, image: string, options: ShotFrameArgs) => withSignal(output, (signal) => shotFrameCommand(image, options, output, signal))));

  const brand = program.command('brand').description('brand kits: a project\'s theme (name, URL, logo, colours, heading font), background, frame and cursor, saved once and applied with one command');
  brand
    .command('list', { isDefault: true })
    .description('the saved brand kits, and where they are kept')
    .action(action((output) => brandListCommand(output)));
  brand
    .command('save <name>')
    .description('save the project\'s brand as a kit (replaces a kit of that name), with copies of its logo and background image')
    .action(action((output, project, name: string) => brandSaveCommand(project, name, output)));
  brand
    .command('apply <name>')
    .description('set a kit\'s theme, background, frame style and cursor in the project (its files are copied into brand/)')
    .action(action((output, project, name: string) => brandApplyCommand(project, name, output)));
  brand
    .command('remove <name>')
    .description('remove a saved kit (projects keep what it set)')
    .action(action((output, _project, name: string) => brandRemoveCommand(name, output)));

  program
    .command('mcp')
    .description('Cuttle as an MCP server over stdio: its commands as tools for any agent (Claude Desktop, Claude Code, Cursor); recording stays with you')
    .action(async () => {
      // not through action(): stdout is the protocol's, the server answers on it until the client goes
      const { serveMcp } = await import('./mcp');
      await serveMcp();
    });

  const voice = program.command('voice').description("the narration: lines of text spoken by a voice on this computer or ElevenLabs' (by its voice ID), or recordings made elsewhere, at moments of the video");
  voice
    .command('list')
    .description('the voices on this computer and which are downloaded; --elevenlabs: the voices of your ElevenLabs account')
    .option('--elevenlabs', "the ElevenLabs account's voices (needs ELEVENLABS_API_KEY)")
    .action(action((output, _project, options: { elevenlabs?: boolean }) => voiceListCommand(options, output)));
  voice
    .command('download <name>')
    .description('download a voice once (about 21 MB), checked by its checksum')
    .action(action((output, _project, name: string) => withSignal(output, (signal) => voiceDownloadCommand(name, output, signal))));
  voice
    .command('remove <name>')
    .description('remove a downloaded voice')
    .action(action((output, _project, name: string) => voiceRemoveCommand(name, output)));
  const voiceSettings = (command: Command) =>
    command
      .option('--elevenlabs', "the id is an ElevenLabs voice ID (as their voice library shows it), not a voice on this computer")
      .option('--speed <0.5-2>', 'how fast it speaks (default 1; ElevenLabs: 0.7 to 1.2)', speed)
      .option('--model <id>', 'ElevenLabs: the model (default eleven_multilingual_v2)')
      .option('--stability <0-1>', 'ElevenLabs: steadier', fraction)
      .option('--similarity <0-1>', 'ElevenLabs: closer to the voice', fraction)
      .option('--style <0-1>', 'ElevenLabs: more style', fraction);
  voiceSettings(voice.command('use <id>').description('the narration\'s voice: a voice on this computer by its name (cuttle voice list), or ElevenLabs\' by its voice ID with --elevenlabs')).action(
    action((output, project, id: string, options: VoiceUseArgs) => voiceUseCommand(project, id, options, output)),
  );
  voiceSettings(
    voice
      .command('add <text>')
      .description('a line of the narration at a moment: source seconds (where the video shows it), or --scene seconds into a scene')
      .requiredOption('--at <seconds>', 'source seconds, or seconds into --scene', seconds)
      .option('--scene <id>', "a scene's id: --at counts from its start")
      .option('--voice <id>', 'a voice for this line alone (with --elevenlabs: an ElevenLabs voice ID)')
      .option('--file <path>', 'a recording made elsewhere (another tool\'s voice, a studio take) instead of a voice; the text is what it says, for the subtitles')
      .option('--volume <0-1>', 'its level (default 1)', fraction)
      .option('--label <text>', 'a name for it'),
  ).action(action((output, project, text: string, options: VoiceAddArgs) => voiceAddCommand(project, text, options, output)));
  voice
    .command('render')
    .description('speak every line not spoken yet (into voiceover/), and say where each plays and how long it is')
    .action(action((output, project) => withSignal(output, (signal) => voiceRenderCommand(project, output, signal))));

  program
    .command('annotate <kind>')
    .description('a mark on the screen at a moment of the take: an arrow (--from, --to), or a box, ellipse, highlight, spotlight or magnifier over --rect (source px, as "frame --grid" shows them)')
    .requiredOption('--at <seconds>', 'source seconds it starts at', seconds)
    .option('--duration <seconds>', 'how long it stays, in source seconds (default 3)', positive)
    .option('--rect <x,y,w,h...>', 'what it marks, in source px')
    .option('--from <x,y...>', "an arrow's start, in source px")
    .option('--to <x,y...>', 'what an arrow points at, in source px')
    .option('--text <words>', 'a callout beside it')
    .option('--color <hex>', "its colour (default: the brand's accent)")
    .option('--zoom <times>', 'a magnifier: how much it enlarges (1.5 to 4, default 2)', positive)
    .option('--label <text>', 'a name for it')
    .action(action((output, project, kind: string, options: AnnotateArgs) => annotateCommand(project, kind, options, output)));

  program
    .command('items')
    .description("the zooms, masks, captions, annotations, motion overlays, sounds and cuts (source seconds), filtered; with --on, --off, --delete or --shift, all of them at once in one write")
    .option('--kind <kinds...>', 'only these kinds: zoom, mask, caption, annotation, motion, sound, cut (comma-separated)')
    .option('--auto', "only Cuttle's (made by suggest or the recording)")
    .option('--yours', "only the ones not Cuttle's")
    .option('--made <kind>', 'only those Cuttle made for this: click, privacy, typing, dialog, notification, …')
    .option('--between <from,to...>', 'only those touching these source seconds')
    .option('--ids <ids...>', 'only these (comma-separated)')
    .option('--on', 'turn them on')
    .option('--off', 'turn them off: kept, not in the video')
    .option('--delete', 'delete them')
    .option('--shift <seconds>', 'move them by these source seconds (negative: earlier)', signedSeconds)
    .action(action((output, project, options: Omit<ItemsArgs, 'auto'> & { auto?: true; yours?: true }) => {
      if (options.auto && options.yours) throw new CliError('usage', '--auto or --yours, not both');
      const { yours, ...rest } = options;
      return itemsCommand(project, { ...rest, ...(yours && { auto: false }) }, output);
    }));

  program
    .command('zoom-path <id>')
    .description("a zoom's path: where it starts and each move (source seconds, source px, the curve to it); --at with --rect adds a move or places the one there anew, --ease, --remove, --clear")
    .option('--at <seconds>', "the move's source second", seconds)
    .option('--rect <x,y,w,h...>', 'where the zoom aims from then, in source px')
    .option('--ease <curve>', 'how it gets there: settle (default), smooth, linear or jump')
    .option('--remove', 'take the move at --at off the path')
    .option('--clear', 'take every move off: the zoom holds still')
    .action(action((output, project, id: string, options: ZoomPathArgs) => zoomPathCommand(project, id, options, output)));

  program
    .command('camera <layout>')
    .description('the camera in another layout for a while: full (over the whole video: an intro, an outro), side (beside the screen, below it on a tall video) or large (a big bubble); the bubble turns into it and back')
    .requiredOption('--at <seconds>', 'source seconds it starts at', seconds)
    .option('--duration <seconds>', 'how long, in source seconds (default 3)', positive)
    .option('--label <text>', 'a name for it')
    .action(action((output, project, layout: string, options: CameraArgs) => cameraCommand(project, layout, options, output)));

  program
    .command('webcam')
    .description("the webcam's look beyond the bubble's place and size")
    .command('background <mode>')
    .description('what shows behind the person (a model finds them in each frame, on this computer): keep (the room), blur, color (--color) or remove (only the person, no bubble)')
    .option('--color <hex>', 'the colour behind the person, with color (default #26262B)')
    .action(action((output, project, mode: string, options: { color?: string }) => webcamBackgroundCommand(project, mode, options, output)));

  const sound = program.command('sound').description('sounds at moments of the video: built-in effects or files of the project');
  sound
    .command('list')
    .description('the built-in sounds')
    .action(action((output) => soundListCommand(output)));
  sound
    .command('add <sound>')
    .description('a built-in sound or a file of the project at a moment: source seconds (where the video shows it), or --scene seconds into a scene')
    .requiredOption('--at <seconds>', 'source seconds, or seconds into --scene', seconds)
    .option('--scene <id>', 'a scene\'s id: --at counts from its start')
    .option('--volume <0-1>', 'its level (default 0.8)', (value: string) => fraction(value))
    .option('--label <text>', 'a name for it')
    .action(action((output, project, name: string, options: { at: number; scene?: string; volume?: number; label?: string }) => soundAddCommand(project, name, options, output)));

  program
    .command('capture-page <target>')
    .description('a web page (URL or file) as a PNG in stills/, optionally as a still scene')
    .option('--scroll', 'the whole page, shown as a scrolling still')
    .option('--width <px>', 'viewport width (default: the output width)', pixels)
    .option('--height <px>', 'viewport height (default: the output height)', pixels)
    .option('--name <name>', 'file name in stills/ (default: from the URL or file)')
    .option('--add', 'append a still scene that shows it')
    .option('--duration <seconds>', 'length of that scene (default 4)', positive)
    .option('--wait <ms>', 'wait after loading, for fonts and maps (default 1000)', integer)
    .action(
      action((output, project, target: string, options: Parameters<typeof capturePageCommand>[2]) =>
        withSignal(output, (signal) => capturePageCommand(project, target, options, output, signal)),
      ),
    );

  program
    .command('fit')
    .description('fit the video to a length after your edits: cut where it rests, never speech, clicks, typing, a zoom or a text (cuts tagged "length"; a new fit replaces them)')
    .argument('[seconds]', 'the length in seconds', positive)
    .option('--off', 'take the fit out: the full length again')
    .action(action((output, project, length: number | undefined, options: { off?: boolean }) => fitCommand(project, length, options.off === true, output)));

  program
    .command('frame')
    .description('a frame of the screen track at full size (the pixels masks and zooms use), optionally with a numbered grid')
    .argument('<seconds>', 'source seconds of the frame', seconds)
    .option('--grid', 'a pixel grid with numbers, every 100 px')
    .option('-o, --out <file>', 'PNG to write (default: frames/<seconds>s.png in the project)')
    .action(action((output, project, at: number, options: { grid?: boolean; out?: string }) => frameCommand(project, at, options, output)));

  program
    .command('render')
    .description('export the project as an MP4; several formats render in one go (their frames side by side, the sound once)')
    .option('--format <formats...>', '16:9, 1:1 or 9:16, one or several (default: the project output)')
    .option('-o, --out <file>', 'output file, with one format (default: out/<format>.mp4 in the project)')
    .option('--still <seconds>', 'one frame at this output second as a PNG, as the export draws it (default: out/still-<t>s.png)', seconds)
    .option('--all <folder>', 'every project in the folder (it and the folders in it with a cuttle.json), one after another, -C left aside')
    .addOption(new Option('--encoder <encoder>', 'H.264 encoder').choices(['auto', 'hardware', 'software']))
    .option('--no-captions', 'no captions burned in, whatever the project says')
    .option('--srt', 'also write the captions as <name>.srt next to the video')
    .option('--vtt', 'also write the captions as <name>.vtt next to the video')
    .option('--loudness <target>', "bring the sound to a platform's loudness: youtube (-14 LUFS: YouTube, Spotify, TikTok, Instagram), podcast (-16), broadcast (-23) or off (default: the project's look.audio.loudness)")
    .option('--alpha', 'with transparency, no background, for another editor: VP9 with alpha in out/<format>.webm, or ProRes 4444 with -o <file>.mov')
    .option('--size <size>', '4k: the short side 2160 (3840×2160 for 16:9); hd: the format\'s size (default)')
    .option('--fps <fps>', '24, 25, 30, 50 or 60 instead of the project\'s', integer)
    .option('--codec <codec>', 'h264 (default, plays everywhere) or hevc (smaller files at 4K; needs a hardware encoder)')
    .action(
      action((output, project, options: { format?: string[]; out?: string; still?: number; all?: string; encoder?: string; captions: boolean; srt?: boolean; vtt?: boolean; loudness?: string; alpha?: boolean; size?: string; fps?: number; codec?: string }) =>
        withSignal<unknown>(output, (signal) => {
          if (options.still !== undefined && options.all !== undefined) throw new CliError('usage', '--still and --all together');
          if (options.still !== undefined) return renderStillCommand(project, options.still, options, output, signal);
          return options.all !== undefined ? renderAllCommand(options.all, options, output, signal) : renderCommand(project, options, output, signal);
        }),
      ),
    );

  program
    .command('transcript')
    .description('what the mic said (cuttle transcribe), with your fixes: as JSON, or as captions on the video\'s time')
    .option('--srt', 'the captions as SubRip')
    .option('--vtt', 'the captions as WebVTT')
    .option('--text', 'the words as plain text')
    .option('--translate <language>', 'write subtitles/<language>.json: the sentences on their timing, each to translate (then captions set --translation)')
    .action(
      action((output, project, options: { srt?: boolean; vtt?: boolean; text?: boolean; translate?: string }) =>
        options.translate !== undefined ? translateCommand(project, options.translate, output) : transcriptCommand(project, options, output),
      ),
    );

  const captions = program.command('captions').description("the subtitles' languages: translations of the transcript, and the one the picture shows");
  captions
    .command('set')
    .description('take a translation in (every sentence written), or put a language in the picture')
    .option('--translation <language>', 'a translation written into subtitles/<language>.json (de, en, pt-BR)')
    .option('--file <path>', "the translation's file, if not subtitles/<language>.json")
    .option('--show <language>', 'the language the picture shows: a translation, or spoken')
    .action(action((output, project, options: CaptionsSetArgs) => captionsSetCommand(project, options, output)));

  program
    .command('watch')
    .description('keep the previews fresh while files are written: a motion page saved reruns its check, the music page its music check, cuttle.json and the rest the preview; each update says what changed and its errors first (--json: a line each); Ctrl+C stops')
    .action(action((output, project) => withSignal(output, (signal) => watchCommand(project, output, signal))));

  program
    .command('open')
    .description("show the project in the Cuttle app's editor (Windows and macOS), which follows every change to its files: the installed app, or the one CUTTLE_APP names")
    .action(action((output, project) => openCommand(project, output)));

  program
    .command('chapters')
    .description("the video's chapters from the script's steps: as the export writes them into the MP4, and as lines for a YouTube description")
    .action(action((output, project) => chaptersCommand(project, output)));

  program
    .command('recover <take>')
    .description('make a take usable after a crash (e.g. takes/3) and use it')
    .action(action((output, project, take: string) => recoverCommand(project, take, output)));

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.exitCode === 0) {
      // --help or --version
      if (json) createOutput(true, streams).result(error.code === 'commander.version' ? { version: VERSION } : { help: shown }, () => '');
      return EXIT.ok;
    }
    // A usage error: commander already explained it on stderr; with --json stdout still gets one document.
    const message = error.code === 'commander.help' ? 'no command given ("cuttle --help" lists them)' : error.message.replace(/^error: /, '');
    if (json) createOutput(true, streams).error(new CliError('usage', message));
    return EXIT.usage;
  }
  return exitCode;
}
