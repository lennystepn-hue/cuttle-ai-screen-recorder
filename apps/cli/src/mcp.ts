/// <reference path="./raw.d.ts" />
// `cuttle mcp`: Cuttle as an MCP server over stdio, for any agent (Claude Desktop, Claude Code,
// Cursor). Each tool runs a cuttle command in this process, its typed input as the command's options,
// and answers with the command's JSON; the stills a preview, a frame or a check draws come along as
// images. The guides the skill holds are tools too. Recording stays with the person: no tool records (screenshot_take takes a single picture).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PROJECT_FILE, newProjectFile, projectExists, readProjectFile, runFfmpeg, writeProjectFile } from '@cuttle/core';
import { THEME_FONTS, parseProject } from '@cuttle/project';
import { z } from 'zod';
import skillGuide from '../../../skill/cuttle/SKILL.md?raw';
import motionGuide from '../../../skill/cuttle/motion.md?raw';
import musicGuide from '../../../skill/cuttle/music.md?raw';
import projectGuide from '../../../skill/cuttle/project.md?raw';
import storyGuide from '../../../skill/cuttle/story.md?raw';
import { REVIEW_KINDS } from './commands/review';
import { VERSION, runCli } from './main';

/** How an agent starts: what the server says about itself when a client connects. */
const INSTRUCTIONS = `Cuttle makes videos two ways that mix freely: screen recordings turned into polished demos, and videos written entirely in code (every scene a web page you write, music composed in code). Read the guide first (guide topic "workflow"; "story" finds what a video is before any scene, "project" is cuttle.json's reference, "motion" how to write scenes, "music" how to compose; a guide that names story.md, motion.md, music.md or project.md means that topic). Every project tool takes "project": the project folder's absolute path. Make a project with init, write scenes as pages in its folder and add them with motion_add, check them with motion_check and preview (both answer with images), then render. open_in_editor shows the project to the person in the Cuttle app, where they see each change you make. Recording is the person's: ask them to record in the Cuttle app or with "cuttle record".`;

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

/** What a screenshot gets for publishing: where it sits, a headline, masks over private data, a brand, a style, a watermark. */
const SHOT_PUBLISH = {
  align: z.enum(['center', 'top', 'bottom', 'left', 'right']).optional().describe('where the shot sits in a canvas larger than it'),
  bleed: z.number().min(0).max(0.6).optional().describe('the share of the shot past the edge it is aligned to (a product shot)'),
  headline: z.string().optional().describe('a title on the background, above the shot'),
  subtitle: z.string().optional().describe('a line under the headline'),
  headlinePosition: z.enum(['above', 'below']).optional(),
  font: z.enum(THEME_FONTS).optional().describe("the headline's and a watermark's font (default Archivo)"),
  redact: z.boolean().optional().describe("read the shot's text on this computer and mask what is private: email addresses, keys, tokens, card and phone numbers"),
  masks: z.array(z.string()).optional().describe('parts blurred, "x,y,w,h" each, in the image\'s pixels'),
  brand: z.string().optional().describe("a brand kit's background, frame, font and logo (brand_list)"),
  style: z.string().optional().describe("a saved style's look (screenshot_styles)"),
  saveStyle: z.string().optional().describe('keep the look as a style under this name'),
  watermark: z.string().optional().describe('a logo (an image file) or a name in a corner'),
};
const shotPublish = (input: { align?: string; bleed?: number; headline?: string; subtitle?: string; headlinePosition?: string; font?: string; redact?: boolean; masks?: string[]; brand?: string; style?: string; saveStyle?: string; watermark?: string }): string[] => [
  ...option('align', input.align),
  ...option('bleed', input.bleed),
  ...option('headline', input.headline),
  ...option('subtitle', input.subtitle),
  ...option('headline-position', input.headlinePosition),
  ...option('font', input.font),
  ...on('redact', input.redact),
  ...options('mask', input.masks),
  ...option('brand', input.brand),
  ...option('style', input.style),
  ...option('save-style', input.saveStyle),
  ...option('watermark', input.watermark),
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
    name: 'review',
    title: 'Review the video',
    description: "Measures what makes the video dull or hard to follow before it renders (an empty first frame, stretches where nothing changes, scenes that look alike or all come in the same way, lines too short to read or too small for a phone, no sound, the look of a recent video) and answers with notes (P0 first) and a sheet of each scene and each cut as an image. Fix the P0 and P1 notes, then review again.",
    input: { project, format: format.optional(), ignore: z.array(z.enum(REVIEW_KINDS)).optional() },
    readOnly: true,
    argv: (input) => ['review', ...option('format', input.format), ...options('ignore', input.ignore)],
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
    name: 'blocks_search',
    title: 'Find blocks',
    description: "Motion blocks from HyperFrames' registry (about 200: charts, logos, titles, transitions, 3D, code, carousels) that show these words, best first, each with a poster URL; or icons from Iconify (source icons). Look at one with blocks_show before bringing it in.",
    input: { words: z.array(z.string().min(1)).min(1), source: z.enum(['hyperframes', 'icons']).optional(), tag: z.string().optional() },
    global: true,
    readOnly: true,
    argv: (input) => ['blocks', 'search', ...input.words, ...option('source', input.source), ...option('tag', input.tag)],
  }),
  tool({
    name: 'blocks_show',
    title: 'Look at a block',
    description: "A block's preview picture (answered as an image), its description, tags and params.",
    input: { project, name: z.string().min(1) },
    readOnly: true,
    argv: (input) => ['blocks', 'show', input.name],
  }),
  tool({
    name: 'blocks_add',
    title: 'Bring in a block',
    description: "Brings a block (hyperframes:<name>), a Lottie animation (a URL of its JSON) or an icon (icons:<set>:<name>) into the project: what its page loads comes with it (it renders offline), its licence goes into CREDITS.md, and a page goes into the video as motion_add puts one. Then make it this video's own (its params, colours, timing) and check it with motion_check.",
    input: { project, name: z.string().min(1), as: z.enum(['scene', 'overlay']).optional(), duration: seconds.positive().optional(), first: z.boolean().optional(), after: z.string().optional(), folder: z.string().optional() },
    argv: (input) => ['blocks', 'add', input.name, ...option('as', input.as), ...option('duration', input.duration), ...on('first', input.first), ...option('after', input.after), ...option('name', input.folder)],
  }),
  tool({
    name: 'motion_icons',
    title: 'Find icons',
    description: "The kit's icons (Lucide's, about 2,000) that show these words, by name and tags, for icon(name) from 'cuttle/icons' in a page.",
    input: { words: z.array(z.string().min(1)).min(1).describe('what the icon shows, e.g. ["rocket", "launch"]') },
    global: true,
    readOnly: true,
    argv: (input) => ['motion', 'icons', ...input.words],
  }),
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
      src: z.string().min(1).describe('the page, relative to the project (motion/<name>/index.html), as motion_check and cuttle.json name it'),
      as: z.enum(['scene', 'overlay', 'transition']).optional(),
      label: z.string().optional(),
      duration: seconds.positive().optional(),
      first: z.boolean().optional(),
      after: z.string().optional(),
      at: seconds.optional(),
      into: z.string().optional(),
    },
    argv: (input) => ['motion', 'add', input.src, ...option('as', input.as), ...option('label', input.label), ...option('duration', input.duration), ...on('first', input.first), ...option('after', input.after), ...option('at', input.at), ...option('into', input.into)],
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
  tool({
    name: 'webcam_background',
    title: 'Behind the person',
    description: 'What shows behind the person in the camera, in the bubble and every camera layout: keep (the room as filmed), blur, color (with color, a hex) or remove (only the person, without the bubble). A model finds the person in each frame, on this computer.',
    input: { project, mode: z.enum(['keep', 'blur', 'color', 'remove']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() },
    argv: (input) => ['webcam', 'background', input.mode, ...option('color', input.color)],
  }),
  tool({
    name: 'screenshot_take',
    title: 'Take a screenshot',
    description:
      "Takes a screenshot of the person's screen (the primary monitor, another one, a region of it in its pixels, or a window by itself, by part of its title), keeps it as a shot folder (Pictures/Cuttle, or save) and frames it as screenshot_frame does (raw: not framed); answered as an image. It shows what is on their screen: ask them first, and look for private data before it goes anywhere. macOS asks them to allow Screen Recording for the app that runs Cuttle.",
    input: {
      monitor: z.number().int().min(0).optional().describe('monitor index from devices (default: the primary monitor)'),
      region: z.array(z.number()).length(4).optional().describe("x, y, w, h in the monitor's pixels"),
      window: z.string().optional().describe('a window by itself, by part of its title'),
      delay: z.number().min(0).max(60).optional().describe('seconds to wait first'),
      cursor: z.boolean().optional().describe('with the pointer'),
      raw: z.boolean().optional().describe('the picture alone, not framed'),
      frame: z.enum(['none', 'mac-dark', 'mac-light', 'browser-light', 'browser-dark', 'windows-light', 'windows-dark', 'terminal', 'iphone', 'android']).optional(),
      title: z.string().optional(),
      background: z.enum(['sunset-sky', 'aurora', 'mesh', 'solid', 'image', 'gradient', 'flow', 'bokeh', 'dots']).optional(),
      transparent: z.boolean().optional(),
      padding: z.number().min(0).max(1000).optional(),
      size: z.string().optional().describe('auto, a ratio (16:9) or pixels (1200x630)'),
      out: z.string().optional().describe('the framed image, .png, .jpg or .webp (default: shot.png in the shot folder)'),
      save: z.string().optional().describe("the shot folder (default: a new one in Pictures/Cuttle)"),
      ...SHOT_PUBLISH,
    },
    global: true,
    argv: (input) => [
      'shot',
      'take',
      ...option('monitor', input.monitor),
      ...option('region', input.region?.join(',')),
      ...option('window', input.window),
      ...option('delay', input.delay),
      ...on('cursor', input.cursor),
      ...on('raw', input.raw),
      ...option('frame', input.frame),
      ...option('title', input.title),
      ...option('background', input.background),
      ...on('transparent', input.transparent),
      ...off('transparent', input.transparent),
      ...option('padding', input.padding),
      ...option('size', input.size),
      ...option('out', input.out),
      ...option('save', input.save),
      ...shotPublish(input),
    ],
  }),
  tool({
    name: 'screenshot_frame',
    title: 'Frame a screenshot',
    description:
      "Frames a screenshot as the videos are and writes it as a PNG, JPEG or WebP (answered as an image): the image in a window, a browser, a phone or alone (frame), on a background or on nothing (transparent), with rounded corners, a shadow and padding, pixel for pixel at the image's own scale (a Retina PNG's from its resolution). For a README, a launch post, a PR. image: a PNG, JPEG or WebP, or a shot's folder made with save (its settings change and it is drawn again). Lengths are points.",
    input: {
      image: z.string().min(1).describe("a PNG, JPEG or WebP (absolute path), or a shot's folder"),
      background: z.enum(['sunset-sky', 'aurora', 'mesh', 'solid', 'image', 'gradient', 'flow', 'bokeh', 'dots']).optional(),
      colors: z.array(z.string()).optional().describe("hex colours: a gradient's stops, or the tints of mesh, flow, bokeh and dots"),
      from: z.string().optional().describe('"shot" (the colours of the image itself) or an image file'),
      angle: z.number().min(0).max(360).optional(),
      radial: z.boolean().optional(),
      color: z.string().optional().describe("the solid background's colour"),
      backgroundImage: z.string().optional().describe('an image behind the shot'),
      wallpaper: z.boolean().optional().describe("the desktop's wallpaper behind the shot, softened"),
      blur: z.number().min(0).max(1).optional(),
      dim: z.number().min(0).max(0.8).optional(),
      transparent: z.boolean().optional().describe('no background: the framed shot and its shadow on nothing (PNG or WebP)'),
      frame: z.enum(['none', 'mac-dark', 'mac-light', 'browser-light', 'browser-dark', 'windows-light', 'windows-dark', 'terminal', 'iphone', 'android']).optional().describe('none (default): the image alone, rounded'),
      title: z.string().optional().describe("the title bar's text: a window's title, a browser's address"),
      radius: z.number().min(0).max(1000).optional(),
      shadow: z.boolean().optional(),
      padding: z.number().min(0).max(1000).optional().describe('default 64'),
      size: z.string().optional().describe('auto (default), a ratio the canvas grows to (16:9, 1:1, 4:5, 9:16, 1.91:1) or pixels it is fitted into (1200x630)'),
      crop: z.array(z.number()).length(4).optional().describe("x, y, w, h in the image's pixels"),
      shotScale: z.number().positive().max(8).optional().describe("the image's pixels per point (default: from a PNG's resolution, else 1)"),
      scale: z.number().positive().max(8).optional().describe("the output's pixels per point (default: the image's own)"),
      quality: z.number().min(0).max(1).optional(),
      out: z.string().optional().describe("the image to write, .png, .jpg or .webp (default: <image>-framed.png beside it; a shot folder's shot.png)"),
      save: z.string().optional().describe('also keep the shot as this folder, to frame it again with other settings'),
      ...SHOT_PUBLISH,
    },
    global: true,
    argv: (input) => [
      'shot',
      'frame',
      input.image,
      ...option('background', input.background),
      ...option('colors', input.colors?.join(',')),
      ...option('from', input.from),
      ...option('angle', input.angle),
      ...on('radial', input.radial),
      ...option('color', input.color),
      ...option('image', input.backgroundImage),
      ...on('wallpaper', input.wallpaper),
      ...option('blur', input.blur),
      ...option('dim', input.dim),
      ...on('transparent', input.transparent),
      ...off('transparent', input.transparent),
      ...option('frame', input.frame),
      ...option('title', input.title),
      ...option('radius', input.radius),
      ...on('shadow', input.shadow),
      ...off('shadow', input.shadow),
      ...option('padding', input.padding),
      ...option('size', input.size),
      ...option('crop', input.crop?.join(',')),
      ...option('shot-scale', input.shotScale),
      ...option('scale', input.scale),
      ...option('quality', input.quality),
      ...option('out', input.out),
      ...option('save', input.save),
      ...shotPublish(input),
    ],
  }),
  tool({
    name: 'screenshot_styles',
    title: 'Screenshot styles',
    description: 'The saved screenshot styles (a look kept with save_style), by name.',
    input: {},
    global: true,
    readOnly: true,
    argv: () => ['shot', 'styles'],
  }),
  tool({
    name: 'open_in_editor',
    title: 'Open in the editor',
    description: "Shows the project in the Cuttle app's editor (Windows and macOS, the app installed), which then follows every change to its files: for the person to watch the video take shape or fine-tune it by hand.",
    input: { project },
    argv: () => ['open'],
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
      'Renders the video as an MP4 (out/<format>.mp4 in the project unless out is given), with subtitle files on request. Several formats render in one go (their frames side by side, the sound once); all: every project in a folder. It takes a while: progress is reported. still: only the frame at that output second, as a PNG (a thumbnail, a post\'s image; answered as an image).',
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
      still: seconds.optional().describe('only this output second, as a PNG (out/still-<t>s.png unless out is given)'),
    },
    argv: (input) => ['render', ...option('format', input.format), ...options('format', input.formats), ...option('all', input.all), ...option('out', input.out), ...option('still', input.still), ...off('captions', input.captions), ...on('srt', input.srt), ...on('vtt', input.vtt), ...option('loudness', input.loudness), ...on('alpha', input.transparent), ...option('size', input.size), ...option('fps', input.fps), ...option('codec', input.codec)],
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
const GUIDES = { workflow: skillGuide, story: storyGuide, project: projectGuide, motion: motionGuide, music: musicGuide } as const;

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
    if (typeof value === 'string' && /\.(png|jpe?g|webp)$/i.test(value)) {
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
      description: 'The guides to making videos with Cuttle: workflow (how to plan, record, edit and render), story (what a video is before any scene: its one idea, three storylines, the hook, the banned defaults, the review), project (cuttle.json\'s reference), motion (writing scenes as pages), music (composing in code).',
      inputSchema: { topic: z.enum(['workflow', 'story', 'project', 'motion', 'music']) },
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
