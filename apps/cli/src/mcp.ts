/// <reference path="./raw.d.ts" />
// `cuttle mcp`: Cuttle as an MCP server over stdio, for any agent (Claude Desktop, Claude Code,
// Cursor). Each tool runs a cuttle command in this process, its typed input as the command's options,
// and answers with the command's JSON; the stills a preview, a frame or a check draws come along as
// images. The guides the skill holds are tools too. Recording stays with the person: no tool records.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, runFfmpeg, writeProjectFile } from '@cuttle/core';
import { parseProject } from '@cuttle/project';
import { z } from 'zod';
import skillGuide from '../../../skill/cuttle/SKILL.md?raw';
import motionGuide from '../../../skill/cuttle/motion.md?raw';
import musicGuide from '../../../skill/cuttle/music.md?raw';
import projectGuide from '../../../skill/cuttle/project.md?raw';
import { VERSION, runCli } from './main';

/** How an agent starts: what the server says about itself when a client connects. */
const INSTRUCTIONS = `Cuttle makes videos two ways that mix freely: screen recordings turned into polished demos, and videos written entirely in code (every scene a web page you write, music composed in code). Read the guide first (guide topic "workflow"; "project" is cuttle.json's reference, "motion" how to write scenes, "music" how to compose). Every project tool takes "project": the project folder's absolute path. Make a project with init, write scenes as pages in its folder and add them with motion_add, check them with motion_check and preview (both answer with images), then render. Recording is the person's: ask them to record in the Cuttle app or with "cuttle record".`;

const project = z.string().min(1).describe("the project folder's absolute path");
const seconds = z.number().nonnegative();
const format = z.enum(['16:9', '1:1', '9:16']).describe('the video format (default: the project output)');

/** A command line option for a value that is there. */
const option = (name: string, value: unknown): string[] => (value === undefined ? [] : [`--${name}`, String(value)]);
const options = (name: string, values: readonly unknown[] | undefined): string[] => (values ?? []).flatMap((value) => [`--${name}`, String(value)]);
const on = (name: string, value: boolean | undefined): string[] => (value ? [`--${name}`] : []);
/** `--no-<name>` when the input turns a default off. */
const off = (name: string, value: boolean | undefined): string[] => (value === false ? [`--no-${name}`] : []);

/** What `items` and `items_edit` pick the items by. */
const ITEM_FILTERS = {
  kind: z.array(z.enum(['zoom', 'mask', 'caption', 'annotation', 'motion', 'sound', 'cut'])).optional().describe('only these kinds'),
  auto: z.boolean().optional().describe("true: only Cuttle's; false: only the ones not Cuttle's"),
  made: z.string().optional().describe('only those Cuttle made for this: click, privacy, typing, dialog, notification, …'),
  between: z.array(z.number()).length(2).optional().describe('only those touching these source seconds, from and to'),
  ids: z.array(z.string()).optional(),
};
const itemFilters = (input: { kind?: string[]; auto?: boolean; made?: string; between?: number[]; ids?: string[] }): string[] => [
  ...option('kind', input.kind?.join(',')),
  ...on('auto', input.auto === true),
  ...on('yours', input.auto === false),
  ...option('made', input.made),
  ...option('between', input.between?.join(',')),
  ...option('ids', input.ids?.join(',')),
];

/** A tool that runs a cuttle command. */
export interface CommandTool {
  name: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  /** The command's words and options from the input (after `-C <project>`). */
  argv: (input: Record<string, never>) => string[];
  /** It reads only: nothing in the project changes. */
  readOnly?: boolean;
  /** It needs no project (`-C` is left out). */
  global?: boolean;
}

// typed per tool, then stored as a CommandTool
const tool = <S extends z.ZodRawShape>(spec: Omit<CommandTool, 'input' | 'argv'> & { input: S; argv: (input: z.infer<z.ZodObject<S>>) => string[] }): CommandTool => spec as unknown as CommandTool;

/** The commands as tools: what each does, its input, and the command line it runs. */
export const COMMAND_TOOLS: readonly CommandTool[] = [
  tool({
    name: 'init',
    title: 'Make a project',
    description: 'Makes a project folder with an empty cuttle.json (a folder that does not exist yet is made).',
    input: { project },
    global: true,
    argv: ({ project: dir }) => ['init', dir],
  }),
  tool({
    name: 'suggest',
    title: 'Cut a take',
    description: "Cuts a recorded take: trims the quiet start and end, cuts idle stretches, speeds up waiting, crops to the content, zooms on the answer, on dialogs, on typing and on clicks, masks private text. Run once, before hand edits; dryRun shows the suggestion only.",
    input: {
      project,
      length: seconds.positive().optional().describe('fit the video to this many seconds'),
      dryRun: z.boolean().optional(),
      zoom: z.boolean().optional().describe('false: no zooms'),
      crop: z.boolean().optional().describe('false: no crop to the content'),
      privacy: z.boolean().optional().describe('false: no privacy masks'),
      speech: z.boolean().optional().describe('false: no filler, pause or retake cuts'),
      transcribe: z.boolean().optional().describe('false: do not transcribe the mic first'),
      mask: z.array(z.string().min(1)).optional().describe('words to mask wherever the screen shows them'),
    },
    argv: (input) => [
      'suggest',
      ...option('length', input.length),
      ...on('dry-run', input.dryRun),
      ...off('zoom', input.zoom),
      ...off('crop', input.crop),
      ...off('privacy', input.privacy),
      ...off('speech', input.speech),
      ...off('transcribe', input.transcribe),
      ...options('mask', input.mask),
    ],
  }),
  tool({
    name: 'transcribe',
    title: 'Transcribe the mic',
    description: 'Transcribes the take\'s mic on this computer (whisper), for subtitles and speech cuts.',
    input: { project, model: z.enum(['base', 'small', 'large-v3-turbo-q5_0']).optional(), language: z.string().optional().describe('auto, de, en, …') },
    argv: (input) => ['transcribe', ...option('model', input.model), ...option('language', input.language)],
  }),
  tool({
    name: 'preview',
    title: 'Preview stills',
    description: 'Stills of the video at output seconds (default: 12 across it, with a contact sheet), answered as images. Look at them before rendering.',
    input: { project, at: z.array(seconds).optional().describe('output seconds'), format: format.optional(), sheet: z.boolean().optional() },
    readOnly: true,
    argv: (input) => ['preview', ...options('at', input.at), ...option('format', input.format), ...on('sheet', input.sheet)],
  }),
  tool({
    name: 'frame',
    title: 'A frame of the take',
    description: "A source frame of the screen recording, with grid: numbered lines every 100 px, to read masks' and zooms' rects off. Answered as an image.",
    input: { project, seconds, grid: z.boolean().optional() },
    readOnly: true,
    argv: (input) => ['frame', String(input.seconds), ...on('grid', input.grid)],
  }),
  tool({
    name: 'capture_page',
    title: 'Capture a web page',
    description: 'A still of a web page or HTML file in the project (stills/), whole with scroll; add puts it in a still scene at the end.',
    input: {
      project,
      target: z.string().min(1).describe('a URL or a file'),
      scroll: z.boolean().optional(),
      add: z.boolean().optional(),
      duration: seconds.positive().optional(),
      wait: z.number().int().nonnegative().optional().describe('ms after loading'),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      name: z.string().optional(),
    },
    argv: (input) => [
      'capture-page',
      input.target,
      ...on('scroll', input.scroll),
      ...on('add', input.add),
      ...option('duration', input.duration),
      ...option('wait', input.wait),
      ...option('width', input.width),
      ...option('height', input.height),
      ...option('name', input.name),
    ],
  }),
  tool({ name: 'motion_templates', title: 'Motion templates', description: 'The motion templates to start a page from (or write one from nothing).', input: {}, global: true, readOnly: true, argv: () => ['motion', 'templates'] }),
  tool({
    name: 'motion_new',
    title: 'A motion page from a template',
    description: "Copies a motion template into motion/<name>/ and adds it: a scene, an overlay or a transition, as the template is.",
    input: { project, template: z.string().min(1), name: z.string().optional(), at: seconds.optional(), duration: seconds.positive().optional(), first: z.boolean().optional(), after: z.string().optional(), into: z.string().optional() },
    argv: (input) => ['motion', 'new', input.template, ...option('name', input.name), ...option('at', input.at), ...option('duration', input.duration), ...on('first', input.first), ...option('after', input.after), ...option('into', input.into)],
  }),
  tool({
    name: 'motion_add',
    title: 'Add a motion page',
    description: 'Adds a page you wrote (an HTML file in the project) to the video: a scene (at the end, first, or after a scene), an overlay over the clips, or the transition into a scene.',
    input: {
      project,
      page: z.string().min(1).describe('the page, relative to the project (motion/<name>/index.html)'),
      as: z.enum(['scene', 'overlay', 'transition']).optional(),
      label: z.string().optional(),
      duration: seconds.positive().optional(),
      first: z.boolean().optional(),
      after: z.string().optional(),
      at: seconds.optional(),
      into: z.string().optional(),
    },
    argv: (input) => ['motion', 'add', input.page, ...option('as', input.as), ...option('label', input.label), ...option('duration', input.duration), ...on('first', input.first), ...option('after', input.after), ...option('at', input.at), ...option('into', input.into)],
  }),
  tool({
    name: 'motion_check',
    title: 'Check a motion page',
    description: "Renders a page's frames and says what failed (script errors, missing files, what it logged); answered with its contact sheet as an image. Fix every error and check again.",
    input: { project, src: z.string().min(1), duration: seconds.positive().optional(), at: z.array(seconds).optional(), format: format.optional() },
    readOnly: true,
    argv: (input) => ['motion', 'check', input.src, ...option('duration', input.duration), ...options('at', input.at), ...option('format', input.format)],
  }),
  tool({ name: 'music_templates', title: 'Music templates', description: 'The music templates to start the music page from.', input: {}, global: true, readOnly: true, argv: () => ['music', 'templates'] }),
  tool({
    name: 'music_new',
    title: 'Music from a template',
    description: 'Copies a music template into music/<name>/ and makes it the video\'s music: composed in code (WebAudio), fitted to its scenes and cuts.',
    input: { project, template: z.string().min(1), name: z.string().optional() },
    argv: (input) => ['music', 'new', input.template, ...option('name', input.name)],
  }),
  tool({
    name: 'music_set',
    title: 'Set the music',
    description: "The music's page, level, duck under speech, its params, its stems' levels (drums, bass, keys, pads, lead: 0 silent, 1 as composed, up to 2; music_check lists them), and whether it plays.",
    input: {
      project,
      src: z.string().optional(),
      volume: z.number().min(0).max(1).optional(),
      duck: z.number().min(0).max(40).optional(),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('the page\'s params (a value "" removes one)'),
      stems: z.record(z.string(), z.number().min(0).max(2)).optional().describe("each stem's level, e.g. { drums: 0.5 }"),
      play: z.boolean().optional(),
    },
    argv: (input) => [
      'music',
      'set',
      ...option('src', input.src),
      ...option('volume', input.volume),
      ...option('duck', input.duck),
      ...options('stem', Object.entries(input.stems ?? {}).map(([name, level]) => `${name}=${level}`)),
      ...options('param', Object.entries(input.params ?? {}).map(([name, value]) => `${name}=${value}`)),
      ...(input.play === true ? ['--on'] : input.play === false ? ['--off'] : []),
    ],
  }),
  tool({
    name: 'music_check',
    title: 'Check the music',
    description: 'Renders the music and says what failed; answered with its waveform (music.png) as an image.',
    input: { project, src: z.string().optional() },
    readOnly: true,
    argv: (input) => ['music', 'check', ...option('src', input.src)],
  }),
  tool({
    name: 'annotate',
    title: 'Annotate the screen',
    description: "A mark on the screen's content at a moment of the take (source seconds): an arrow from `from` to `to`, or a box, ellipse, highlight, spotlight or magnifier over `rect`, in source px (read them off frame with grid). It draws itself in and moves with the content under zooms.",
    input: {
      project,
      kind: z.enum(['arrow', 'box', 'ellipse', 'highlight', 'spotlight', 'magnifier']),
      at: seconds,
      duration: seconds.positive().optional(),
      rect: z.array(z.number()).length(4).optional().describe('x, y, width, height in source px'),
      from: z.array(z.number()).length(2).optional().describe("an arrow's start, x and y"),
      to: z.array(z.number()).length(2).optional().describe('what an arrow points at, x and y'),
      text: z.string().optional().describe('a callout beside it'),
      color: z.string().optional(),
      zoom: z.number().min(1.5).max(4).optional().describe('a magnifier: how much it enlarges'),
      label: z.string().optional(),
    },
    argv: (input) => [
      'annotate',
      input.kind,
      '--at',
      String(input.at),
      ...option('duration', input.duration),
      ...option('rect', input.rect?.join(',')),
      ...option('from', input.from?.join(',')),
      ...option('to', input.to?.join(',')),
      ...option('text', input.text),
      ...option('color', input.color),
      ...option('zoom', input.zoom),
      ...option('label', input.label),
    ],
  }),
  tool({
    name: 'items',
    title: 'List the items',
    description: "The project's zooms, masks, captions, annotations, motion overlays, sounds and cuts with their ids, source seconds, on or off, and whether Cuttle made them (and for what), filtered by kind, maker, stretch or id.",
    input: { project, ...ITEM_FILTERS },
    readOnly: true,
    argv: (input) => ['items', ...itemFilters(input)],
  }),
  tool({
    name: 'items_edit',
    title: 'Edit many items at once',
    description: 'Turns on, turns off, deletes or moves (by source seconds, negative: earlier) every item the filters pick, in one write: all click zooms, every mask of a stretch. Give at least one filter; list them with items first.',
    input: { project, ...ITEM_FILTERS, change: z.enum(['on', 'off', 'delete', 'shift']), by: z.number().optional().describe('shift: the source seconds to move them by') },
    argv: (input) => ['items', ...itemFilters(input), ...(input.change === 'shift' ? option('shift', input.by ?? 0) : [`--${input.change}`])],
  }),
  tool({
    name: 'zoom_path',
    title: "A zoom's path",
    description: "A zoom that follows something: where it starts and each move (source seconds and px). With at and rect it adds a move (or places the one at that second anew); ease is how it gets there (settle as a camera, smooth, linear, or jump); remove takes the move at `at` off; clear holds the zoom still.",
    input: {
      project,
      id: z.string().min(1).describe("the zoom's id"),
      at: seconds.optional(),
      rect: z.array(z.number()).length(4).optional().describe('x, y, width, height in source px'),
      ease: z.enum(['settle', 'smooth', 'linear', 'jump']).optional(),
      remove: z.boolean().optional(),
      clear: z.boolean().optional(),
    },
    argv: (input) => ['zoom-path', input.id, ...option('at', input.at), ...option('rect', input.rect?.join(',')), ...option('ease', input.ease), ...on('remove', input.remove), ...on('clear', input.clear)],
  }),
  tool({
    name: 'camera',
    title: 'Show the camera',
    description: 'The webcam in another layout for a while (source seconds, as a caption): full over the whole video (a talking-head intro or outro), side beside the screen (below it on a tall video), large a big bubble. The bubble turns into it and back over half a second.',
    input: { project, layout: z.enum(['full', 'side', 'large']), at: seconds, duration: seconds.positive().optional(), label: z.string().optional() },
    argv: (input) => ['camera', input.layout, '--at', String(input.at), ...option('duration', input.duration), ...option('label', input.label)],
  }),
  tool({ name: 'sound_list', title: 'Built-in sounds', description: 'The built-in sounds (whoosh, click, pop, …).', input: {}, global: true, readOnly: true, argv: () => ['sound', 'list'] }),
  tool({
    name: 'sound_add',
    title: 'Add a sound',
    description: 'A built-in sound or a sound file of the project at a moment: source seconds, or seconds into a scene.',
    input: { project, sound: z.string().min(1), at: seconds, scene: z.string().optional(), volume: z.number().min(0).max(1).optional(), label: z.string().optional() },
    argv: (input) => ['sound', 'add', input.sound, '--at', String(input.at), ...option('scene', input.scene), ...option('volume', input.volume), ...option('label', input.label)],
  }),
  tool({
    name: 'voice_list',
    title: 'Voices',
    description: "The narration's voices on this computer and which are downloaded; elevenlabs: the ElevenLabs account's voices (needs ELEVENLABS_API_KEY).",
    input: { elevenlabs: z.boolean().optional() },
    global: true,
    readOnly: true,
    argv: (input) => ['voice', 'list', ...on('elevenlabs', input.elevenlabs)],
  }),
  tool({ name: 'voice_download', title: 'Download a voice', description: 'Downloads a voice for this computer once (about 21 MB). Ask the person first.', input: { name: z.string().min(1) }, global: true, argv: (input) => ['voice', 'download', input.name] }),
  tool({
    name: 'voice_use',
    title: "The narration's voice",
    description: "The voice that speaks the narration: one on this computer by its name, or ElevenLabs' by its voice ID (elevenlabs: true).",
    input: { project, id: z.string().min(1), elevenlabs: z.boolean().optional(), speed: z.number().min(0.5).max(2).optional(), model: z.string().optional(), stability: z.number().min(0).max(1).optional(), similarity: z.number().min(0).max(1).optional(), style: z.number().min(0).max(1).optional() },
    argv: (input) => ['voice', 'use', input.id, ...on('elevenlabs', input.elevenlabs), ...option('speed', input.speed), ...option('model', input.model), ...option('stability', input.stability), ...option('similarity', input.similarity), ...option('style', input.style)],
  }),
  tool({
    name: 'voice_add',
    title: 'Add a line of narration',
    description: 'A line the narration speaks at a moment (source seconds, or seconds into a scene); file: a recording made elsewhere plays instead, its text for the subtitles.',
    input: { project, text: z.string(), at: seconds, scene: z.string().optional(), voice: z.string().optional(), file: z.string().optional(), volume: z.number().min(0).max(1).optional(), label: z.string().optional(), elevenlabs: z.boolean().optional() },
    argv: (input) => ['voice', 'add', input.text, '--at', String(input.at), ...option('scene', input.scene), ...option('voice', input.voice), ...option('file', input.file), ...option('volume', input.volume), ...option('label', input.label), ...on('elevenlabs', input.elevenlabs)],
  }),
  tool({
    name: 'voice_render',
    title: 'Speak the narration',
    description: 'Speaks every line not spoken yet, and says each line\'s length, where it plays, and which run into the next.',
    input: { project },
    argv: () => ['voice', 'render'],
  }),
  tool({
    name: 'background',
    title: 'The background',
    description: 'The background behind the video: a preset (sunset-sky, aurora, mesh, solid, image, gradient, flow, bokeh, dots), colours (or read from the take or the logo), an image.',
    input: {
      project,
      preset: z.enum(['sunset-sky', 'aurora', 'mesh', 'solid', 'image', 'gradient', 'flow', 'bokeh', 'dots']).optional(),
      colors: z.array(z.string()).optional().describe('hex colours'),
      from: z.string().optional().describe('take, logo or an image file'),
      angle: z.number().min(0).max(360).optional(),
      radial: z.boolean().optional(),
      color: z.string().optional(),
      image: z.string().optional(),
      wallpaper: z.boolean().optional(),
      blur: z.number().min(0).max(1).optional(),
      dim: z.number().min(0).max(0.8).optional(),
    },
    argv: (input) => [
      'background',
      ...(input.preset ? [input.preset] : []),
      ...option('colors', input.colors?.join(',')),
      ...option('from', input.from),
      ...option('angle', input.angle),
      ...on('radial', input.radial),
      ...option('color', input.color),
      ...option('image', input.image),
      ...on('wallpaper', input.wallpaper),
      ...option('blur', input.blur),
      ...option('dim', input.dim),
    ],
  }),
  tool({ name: 'brand_list', title: 'Brand kits', description: 'The brand kits saved on this computer.', input: {}, global: true, readOnly: true, argv: () => ['brand', 'list'] }),
  tool({ name: 'brand_apply', title: 'Apply a brand kit', description: "A brand kit's name, URL, logo, colours, heading font, background, frame and cursor, applied to the project.", input: { project, name: z.string().min(1) }, argv: (input) => ['brand', 'apply', input.name] }),
  tool({ name: 'brand_save', title: 'Save a brand kit', description: "Saves the project's brand as a kit for other projects.", input: { project, name: z.string().min(1) }, argv: (input) => ['brand', 'save', input.name] }),
  tool({
    name: 'fit',
    title: 'Fit the length',
    description: 'Fits the video to a length where it rests (never cutting speech, clicks or typing), or takes the fit out.',
    input: { project, seconds: seconds.positive().optional(), off: z.boolean().optional() },
    argv: (input) => ['fit', ...(input.seconds !== undefined ? [String(input.seconds)] : []), ...on('off', input.off)],
  }),
  tool({ name: 'chapters', title: 'Chapters', description: "The video's chapters from the script's steps, for a YouTube description.", input: { project }, readOnly: true, argv: () => ['chapters'] }),
  tool({
    name: 'transcript',
    title: 'The transcript',
    description: 'What the mic said: as words, SRT, VTT or plain text.',
    input: { project, as: z.enum(['srt', 'vtt', 'text']).optional() },
    readOnly: true,
    argv: (input) => ['transcript', ...(input.as ? [`--${input.as}`] : [])],
  }),
  tool({
    name: 'translate_subtitles',
    title: 'Start a translation',
    description:
      "Writes subtitles/<language>.json: the transcript's sentences on their original timing, each with an empty text to translate into (sentences translated before keep theirs). Edit the file to write each sentence's text in that language, then call captions_set with translation.",
    input: { project, language: z.string().min(2).describe('a language code: de, en, pt-BR') },
    argv: (input) => ['transcript', '--translate', input.language],
  }),
  tool({
    name: 'captions_set',
    title: 'Subtitle languages',
    description: "Takes a translation in once every sentence is written (translation, with file if it is not subtitles/<language>.json), or puts a language in the picture (show: a translation, or 'spoken'). The export writes subtitle files in every language.",
    input: { project, translation: z.string().optional(), file: z.string().optional(), show: z.string().optional() },
    argv: (input) => ['captions', 'set', ...option('translation', input.translation), ...option('file', input.file), ...option('show', input.show)],
  }),
  tool({
    name: 'render',
    title: 'Render the video',
    description:
      'Renders the video as an MP4 (out/<format>.mp4 in the project unless out is given), with subtitle files on request. Several formats render in one go (their frames side by side, the sound once); all: every project in a folder. It takes a while: progress is reported.',
    input: {
      project,
      format: format.optional(),
      formats: z.array(z.enum(['16:9', '1:1', '9:16'])).optional().describe('several formats in one go, each to out/<format>.mp4'),
      all: z.string().optional().describe('a folder: every project in it (it and the folders in it with a cuttle.json), one after another'),
      out: z.string().optional(),
      captions: z.boolean().optional().describe('false: no captions burned in'),
      srt: z.boolean().optional(),
      vtt: z.boolean().optional(),
      loudness: z.enum(['youtube', 'podcast', 'broadcast', 'off']).optional().describe("the sound at a platform's loudness: youtube -14 LUFS (also Spotify, TikTok, Instagram), podcast -16, broadcast -23 (default: the project's)"),
      transparent: z.boolean().optional().describe('with transparency, no background, for another editor: VP9 with alpha in a .webm, or ProRes 4444 when out ends in .mov'),
      size: z.enum(['hd', '4k']).optional().describe('4k: the short side 2160'),
      fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
      codec: z.enum(['h264', 'hevc']).optional().describe('hevc: smaller files at 4K, needs a hardware encoder'),
    },
    argv: (input) => ['render', ...option('format', input.format), ...options('format', input.formats), ...option('all', input.all), ...option('out', input.out), ...off('captions', input.captions), ...on('srt', input.srt), ...on('vtt', input.vtt), ...option('loudness', input.loudness), ...on('alpha', input.transparent), ...option('size', input.size), ...option('fps', input.fps), ...option('codec', input.codec)],
  }),
  tool({
    name: 'import',
    title: 'Import a video',
    description: 'A video made elsewhere (a phone, OBS, a download) as the next take, its sound as the mic.',
    input: { project, file: z.string().min(1), from: seconds.optional(), to: seconds.positive().optional() },
    argv: (input) => ['import', input.file, ...option('from', input.from), ...option('to', input.to)],
  }),
  tool({ name: 'recover', title: 'Recover a take', description: 'Makes a take usable after a crash (takes/<n>).', input: { project, take: z.string().min(1) }, argv: (input) => ['recover', input.take] }),
];

/** The guides, as the skill has them. */
const GUIDES = { workflow: skillGuide, project: projectGuide, motion: motionGuide, music: musicGuide } as const;

/** What a command said, as the tool's answer. */
interface Ran {
  code: number;
  result: unknown;
  warnings: string;
}

/** Runs a cuttle command in this process: its JSON, its warnings; status lines go to `progress`. */
export async function runCommand(argv: readonly string[], progress?: (text: string) => void): Promise<Ran> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(['--json', ...argv], { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text), ...(progress && { progress }) });
  let result: unknown;
  try {
    result = JSON.parse(stdout || '{}');
  } catch {
    result = { output: stdout };
  }
  return { code, result, warnings: stderr.trim() };
}

/** The pictures in a command's result (a sheet first, at most four), as JPEG at most 1600 px wide. */
async function imagesOf(result: unknown): Promise<CallToolResult['content']> {
  const found: string[] = [];
  const walk = (value: unknown, key?: string): void => {
    if (typeof value === 'string' && /\.png$/i.test(value)) {
      if (key === 'sheet') found.unshift(value);
      else found.push(value);
    } else if (Array.isArray(value)) value.forEach((item) => walk(item));
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) walk(item, name);
  };
  walk(result);
  const pictures = [...new Set(found)].filter((path) => existsSync(path)).slice(0, 4);
  const content: CallToolResult['content'] = [];
  for (const path of pictures) {
    const { stdout } = await runFfmpeg(['-i', path, '-vf', "scale='min(1600,iw)':-2", '-frames:v', '1', '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', '-']).catch(() => ({ stdout: Buffer.alloc(0) }));
    if (stdout.length > 0) content.push({ type: 'image', data: stdout.toString('base64'), mimeType: 'image/jpeg' });
  }
  return content;
}

/** The answer of a command's tool: its JSON (an error's too), its warnings, and its pictures. */
async function answer(ran: Ran): Promise<CallToolResult> {
  const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(ran.result, null, 2) }];
  if (ran.warnings) content.push({ type: 'text', text: ran.warnings });
  if (ran.code === 0) content.push(...(await imagesOf(ran.result)));
  return { content, ...(ran.code !== 0 && { isError: true }) };
}

/** The server with every tool; `serveMcp` connects it to stdio, the tests to their client. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'cuttle', version: VERSION }, { instructions: INSTRUCTIONS });
  server.registerTool(
    'guide',
    {
      title: 'Read a guide',
      description: 'The guides to making videos with Cuttle: workflow (how to plan, record, edit and render), project (cuttle.json\'s reference), motion (writing scenes as pages), music (composing in code).',
      inputSchema: { topic: z.enum(['workflow', 'project', 'motion', 'music']) },
      annotations: { readOnlyHint: true },
    },
    async ({ topic }) => ({ content: [{ type: 'text', text: GUIDES[topic] }] }),
  );
  server.registerTool(
    'read_project',
    {
      title: 'Read cuttle.json',
      description: "The project's cuttle.json as written, and its problems if it has any.",
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    async ({ project: dir }) => {
      const path = join(resolve(dir), PROJECT_FILE);
      const text = await readFile(path, 'utf8').catch(() => undefined);
      if (text === undefined) return { content: [{ type: 'text', text: `there is no ${PROJECT_FILE} in ${dir}: make one with init` }], isError: true };
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        return { content: [{ type: 'text', text: `${path} is not JSON: ${(error as Error).message}` }], isError: true };
      }
      const parsed = parseProject(raw);
      return { content: [{ type: 'text', text: JSON.stringify({ path, project: raw, ...(!parsed.ok && { issues: parsed.issues }) }, null, 2) }] };
    },
  );
  server.registerTool(
    'write_project',
    {
      title: 'Write cuttle.json',
      description: "Replaces the project's cuttle.json with `json` (checked first: nothing is written when it is not a valid project); the file before is kept as cuttle.json.bak.",
      inputSchema: { project, json: z.record(z.string(), z.unknown()).describe("the whole of cuttle.json (read it first with read_project; guide topic project is its reference)") },
    },
    async ({ project: dir, json }) => {
      const parsed = parseProject(json);
      if (!parsed.ok) return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'invalid-project', issues: parsed.issues } }, null, 2) }], isError: true };
      try {
        const file = projectExists(resolve(dir)) ? await readProjectFile(resolve(dir)) : newProjectFile(resolve(dir));
        file.raw = json;
        const { file: written, backup } = await writeProjectFile(file, 'mcp write_project', { backup: true });
        return { content: [{ type: 'text', text: JSON.stringify({ path: written.path, ...(backup && { backup }) }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: { code: (error as { code?: string }).code ?? 'internal', message: (error as Error).message } }, null, 2) }], isError: true };
      }
    },
  );
  for (const spec of COMMAND_TOOLS) {
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.input, annotations: { readOnlyHint: spec.readOnly ?? false } },
      async (input: Record<string, unknown>, extra) => {
        const token = extra._meta?.progressToken;
        let step = 0;
        const progress =
          token === undefined
            ? undefined
            : (text: string) => void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++step, message: text } }).catch(() => {});
        const dir = typeof input.project === 'string' ? resolve(input.project) : undefined;
        const argv = spec.argv(input as Record<string, never>);
        return answer(await runCommand([...(dir !== undefined && !spec.global ? ['-C', dir] : []), ...argv], progress));
      },
    );
  }
  return server;
}

/** `cuttle mcp`: serves the tools on stdin and stdout until the client goes. Nothing else may write to stdout. */
export async function serveMcp(): Promise<void> {
  // stdout is the protocol's: anything logged goes to stderr
  console.log = (...args: unknown[]) => console.error(...args);
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => (transport.onclose = resolve));
  await server.connect(transport);
  await closed;
}
