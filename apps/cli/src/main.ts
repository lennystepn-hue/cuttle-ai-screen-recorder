import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { backgroundCommand, type BackgroundArgs } from './commands/background';
import { brandApplyCommand, brandListCommand, brandRemoveCommand, brandSaveCommand } from './commands/brand';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { importCommand, type ImportArgs } from './commands/import';
import { init } from './commands/init';
import { motionCheckCommand, motionNewCommand, motionTemplatesCommand } from './commands/motion';
import { musicCheckCommand, musicNewCommand, musicSetCommand, musicTemplatesCommand, soundAddCommand, soundListCommand } from './commands/music';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
import { renderCommand } from './commands/render';
import { chaptersCommand } from './commands/chapters';
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
import { transcriptCommand } from './commands/transcript';
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.3';

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
const degrees = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 360) throw new InvalidArgumentError('expected degrees from 0 to 360');
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
    .action(
      action((output, project, options: { at?: number[]; masks?: boolean; sheet?: boolean; format?: string; out?: string }) =>
        withSignal(output, (signal) => previewCommand(project, options, output, signal)),
      ),
    );

  const motion = program.command('motion').description('motion pages: scenes and overlays drawn by code (HTML, CSS, canvas, WebGL)');
  motion
    .command('new <template>')
    .description('copy a template into motion/<name>/ and add it: a scene at the end, an overlay over the clips, or the transition into a scene (motion templates lists them)')
    .option('--name <name>', 'the folder in motion/ (default: the template\'s name)')
    .option('--at <seconds>', 'an overlay\'s start, in source seconds (default: the first clip\'s start)', seconds)
    .option('--duration <seconds>', 'how long it lasts (default: the template\'s; a callout or caption overlay: the whole take)', positive)
    .option('--first', 'a scene goes first instead of last (an intro)')
    .option('--into <scene>', 'a transition: the scene it leads into, by id or place from 0 (default: the second scene)')
    .action(action((output, project, template: string, options: { name?: string; at?: number; duration?: number; first?: boolean; into?: string }) => motionNewCommand(project, template, options, output)));
  motion
    .command('templates')
    .description('the templates motion new copies: their kind and what they show')
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
    .option('--src <page>', 'another page in the project')
    .option('--on', 'play it')
    .option('--off', 'leave it out')
    .action(action((output, project, options: { volume?: number; duck?: number; param?: string[]; src?: string; on?: boolean; off?: boolean }) => musicSetCommand(project, options, output)));
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
    .description('export the project as an MP4')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <file>', 'output file (default: out/<format>.mp4 in the project)')
    .addOption(new Option('--encoder <encoder>', 'H.264 encoder').choices(['auto', 'hardware', 'software']))
    .option('--no-captions', 'no captions burned in, whatever the project says')
    .option('--srt', 'also write the captions as <name>.srt next to the video')
    .option('--vtt', 'also write the captions as <name>.vtt next to the video')
    .action(
      action((output, project, options: { format?: string; out?: string; encoder?: string; captions: boolean; srt?: boolean; vtt?: boolean }) =>
        withSignal(output, (signal) => renderCommand(project, options, output, signal)),
      ),
    );

  program
    .command('transcript')
    .description('what the mic said (cuttle transcribe), with your fixes: as JSON, or as captions on the video\'s time')
    .option('--srt', 'the captions as SubRip')
    .option('--vtt', 'the captions as WebVTT')
    .option('--text', 'the words as plain text')
    .action(action((output, project, options: { srt?: boolean; vtt?: boolean; text?: boolean }) => transcriptCommand(project, options, output)));

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
