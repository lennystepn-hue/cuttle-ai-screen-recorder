import type { CuttleProjectInput, InputEvent, TranscriptWord } from '@cuttle/project';

/** One golden image: a project, the output time to render and the fake inputs to feed it. */
export interface Scenario {
  name: string;
  project: CuttleProjectInput;
  /** Output seconds. */
  t: number;
  /** Cursor track for the timeline. */
  events?: InputEvent[];
  /** Feed the fake webcam frame to clip layers (the project must enable `look.webcam`). */
  webcam?: boolean;
  /** The take's transcript, for captions. */
  transcript?: TranscriptWord[];
}

type Look = NonNullable<CuttleProjectInput['look']>;

/** 640×360 output, one 10 s clip of the fake screen; `look` and `rest` replace the defaults. */
function project(look: Look = {}, rest: Partial<CuttleProjectInput> = {}): CuttleProjectInput {
  return {
    version: 1,
    output: { width: 640, height: 360, fps: 30 },
    sources: { screen: 'screen.mp4' },
    look,
    scenes: [{ type: 'clip', from: 0, to: 10 }],
    ...rest,
  };
}

const SLATE = { preset: 'solid', color: '#3B4252' } as const;
/** One piece of footage: 0–5 s at 1×, then 5–25 s at 4× (output 5–10 s). */
const SPEED_CHANGE: CuttleProjectInput['scenes'] = [
  { type: 'clip', from: 0, to: 5 },
  { type: 'clip', from: 5, to: 25, speed: 4 },
];
const TITLE = 'claude · ~/treg-demo';

/** Cursor resting at the screen centre, clicked 0.1 s before t = 5 (ripple at 25 %). */
const CLICK: InputEvent[] = [
  { t: 0, type: 'move', x: 640, y: 400 },
  { t: 4.9, type: 'click', x: 640, y: 400, button: 'left' },
];
/** Zoom on the cursor so its art is big enough to judge. */
const CURSOR_ZOOM = [{ at: 0, duration: 10, rect: [520, 325, 240, 150] as [number, number, number, number] }];

function cursorScenario(style: 'system' | 'arrow-white' | 'arrow-black' | 'dot' | 'ring' | 'spotlight'): Scenario {
  return {
    name: `cursor-${style}`,
    project: project({ background: SLATE, frame: { title: TITLE }, cursor: { style } }, { zooms: CURSOR_ZOOM }),
    t: 5,
    events: CLICK,
  };
}

function shapeScenario(shape: 'text' | 'pointer' | 'wait' | 'crosshair' | 'move' | 'not-allowed'): Scenario {
  return {
    name: `cursor-system-${shape}`,
    project: project({ background: SLATE, frame: { title: TITLE } }, { zooms: CURSOR_ZOOM }),
    t: 5,
    events: [
      { t: 0, type: 'move', x: 640, y: 400 },
      { t: 0, type: 'shape', shape },
    ],
  };
}

function textScenario(style: 'pill' | 'lower-third' | 'caption', position: 'top' | 'bottom'): Scenario {
  return {
    name: `text-${style}`,
    project: project({ frame: { title: TITLE } }, { texts: [{ at: 0, duration: 10, text: 'One prompt, one call', style, position }] }),
    t: 5,
  };
}

/** Two sentences spoken over the clip; at t = 5 the word "Bildschirm" is being said. */
const SPOKEN: TranscriptWord[] = 'Cuttle nimmt deinen Bildschirm auf und schneidet das Video für dich'
  .split(' ')
  .map((text, i) => ({ t: 3.2 + i * 0.45, end: 3.2 + i * 0.45 + 0.4, text }));

function captionScenario(style: 'subtitle' | 'karaoke' | 'bold', format: 'wide' | 'vertical' = 'wide'): Scenario {
  const output = format === 'wide' ? { width: 640, height: 360, fps: 30 } : { width: 360, height: 640, fps: 30 };
  return {
    name: `caption-${style}${format === 'vertical' ? '-vertical' : ''}`,
    project: project({ frame: { title: TITLE } }, { output, captions: { style, ...(style === 'bold' && { position: 'center' }) } }),
    t: 4.6,
    transcript: SPOKEN,
  };
}

export const SCENARIOS: Scenario[] = [
  // Captions in their three styles; bold in a 9:16 video too
  captionScenario('subtitle'),
  captionScenario('karaoke'),
  captionScenario('bold'),
  captionScenario('bold', 'vertical'),
  // Backgrounds, behind an end card
  ...(['sunset-sky', 'aurora', 'mesh'] as const).map((preset) => ({
    name: `background-${preset}`,
    project: project({ background: { preset } }, { scenes: [{ type: 'card', title: preset, duration: 3 }] }),
    t: 1,
  })),
  {
    name: 'background-solid',
    project: project({ background: { preset: 'solid', color: '#1E1E2E' } }, { scenes: [{ type: 'card', title: 'solid', duration: 3 }] }),
    t: 1,
  },
  {
    name: 'background-image',
    project: project({ background: { preset: 'image', image: 'bg.png' } }, { scenes: [{ type: 'card', title: 'image', duration: 3 }] }),
    t: 1,
  },
  {
    name: 'card',
    project: project({}, { scenes: [{ type: 'card', title: 'Claude Code + treg', subtitle: 'treg.to', duration: 3 }] }),
    t: 1,
  },

  // Window frames
  { name: 'frame-mac-dark', project: project({ background: SLATE, frame: { style: 'mac-dark', title: TITLE } }), t: 1 },
  { name: 'frame-mac-light', project: project({ background: SLATE, frame: { style: 'mac-light', title: TITLE } }), t: 1 },
  { name: 'frame-browser-light', project: project({ background: SLATE, frame: { style: 'browser-light', title: 'treg.to' } }), t: 1 },
  { name: 'frame-none', project: project({ background: SLATE, frame: { style: 'none' } }), t: 1 },
  { name: 'frame-disabled', project: project({ background: SLATE, frame: { enabled: false } }), t: 1 },

  // Masks and zoom
  {
    name: 'mask-fill',
    project: project({ frame: { title: TITLE } }, { masks: [{ from: 0, to: 10, rect: [270, 170, 700, 22], style: 'fill' }] }),
    t: 1,
  },
  {
    name: 'mask-blur',
    project: project({ frame: { title: TITLE } }, { masks: [{ from: 0, to: 10, rect: [900, 520, 340, 200], style: 'blur' }] }),
    t: 1,
  },
  {
    name: 'zoom',
    project: project(
      { frame: { title: TITLE } },
      {
        zooms: [{ at: 0, duration: 10, rect: [800, 450, 480, 300] }],
        masks: [{ from: 0, to: 10, rect: [930, 620, 260, 54], style: 'fill' }],
      },
    ),
    t: 5,
  },

  // A clip cropped to a wide band of the screen: the window takes its shape, the mask stays on its text
  {
    name: 'crop',
    project: project(
      { frame: { title: TITLE } },
      { scenes: [{ type: 'clip', from: 0, to: 10, crop: { rect: [240, 40, 1000, 420] } }], masks: [{ from: 0, to: 10, rect: [270, 170, 700, 22], style: 'fill' }] },
    ),
    t: 1,
  },

  // Cursors: six styles with a click ripple, then the system shapes
  ...(['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const).map(cursorScenario),
  ...(['text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const).map(shapeScenario),

  // Webcam bubble
  {
    name: 'webcam-circle',
    project: project({ frame: { title: TITLE }, webcam: { enabled: true, shape: 'circle', corner: 'bottom-left', size: 0.25 } }),
    t: 1,
    webcam: true,
  },
  {
    name: 'webcam-rounded',
    project: project({ frame: { title: TITLE }, webcam: { enabled: true, shape: 'rounded', corner: 'top-right', size: 0.25 } }),
    t: 1,
    webcam: true,
  },

  // Texts and the speed badge
  textScenario('pill', 'top'),
  textScenario('lower-third', 'bottom'),
  textScenario('caption', 'bottom'),
  { name: 'badge', project: project({ frame: { title: TITLE } }, { scenes: [{ type: 'clip', from: 0, to: 120, speed: 12 }] }), t: 5 },
  // A bottom lower third moves up, clear of the webcam bubble in its default corner
  {
    name: 'text-lower-third-webcam',
    project: project(
      { frame: { title: TITLE }, webcam: { enabled: true } },
      {
        sources: { screen: 'screen.mp4', webcam: 'webcam.mp4' },
        texts: [{ at: 0, duration: 10, text: 'One prompt, one call', style: 'lower-third', position: 'bottom' }],
      },
    ),
    t: 5,
    webcam: true,
  },

  // Still scenes
  {
    name: 'still-browser',
    project: project({}, { scenes: [{ type: 'still', image: 'page.png', duration: 4, frame: 'browser-light' }] }),
    t: 1,
  },
  {
    name: 'still-scroll',
    project: project({}, { scenes: [{ type: 'still', image: 'page.png', duration: 4, motion: 'scroll', frame: 'mac-light' }] }),
    t: 2,
  },
  {
    name: 'still-kenburns',
    project: project({}, { scenes: [{ type: 'still', image: 'page.png', duration: 4, motion: 'kenburns' }] }),
    t: 3,
  },

  // Crossfade from a clip to a card, halfway
  {
    name: 'crossfade',
    project: project(
      { frame: { title: TITLE } },
      { scenes: [{ type: 'clip', from: 0, to: 2 }, { type: 'card', title: 'The end', duration: 2 }] },
    ),
    t: 2,
  },
  // Crossfade between two clips of one recording, halfway: the outgoing clip holds its last frame
  // with its mask and cursor, the incoming clip starts at a later source time without the mask,
  // its cursor further right and down (900, 600). The cursor as recorded (smoothing would hold it
  // still through the 2 s without a move).
  {
    name: 'crossfade-clips',
    project: project(
      { frame: { title: TITLE }, cursor: { smoothing: 0 } },
      {
        scenes: [
          { type: 'clip', from: 0, to: 2 },
          { type: 'clip', from: 6, to: 8 },
        ],
        masks: [{ from: 0, to: 2, rect: [270, 170, 700, 22], style: 'fill' }],
      },
    ),
    t: 2,
    events: [
      { t: 0, type: 'move', x: 400, y: 300 },
      { t: 2, type: 'move', x: 440, y: 340 },
      { t: 6, type: 'move', x: 900, y: 600 },
    ],
  },

  // A speed change inside one piece of footage (1× up to 5 s, then 4×) is a continuous cut: one
  // layer, no crossfade. The zoom (source 4.7–8.7) and the caption (4–5.4) ramp in output seconds
  // across it: the zoom is halfway in at the cut, the caption 40 % into its fade-out.
  {
    name: 'speed-change-zoom',
    project: project({ frame: { title: TITLE } }, { scenes: SPEED_CHANGE, zooms: [{ at: 4.7, duration: 4, rect: [800, 450, 480, 300] }] }),
    t: 5,
  },
  {
    name: 'speed-change-caption',
    project: project(
      { frame: { title: TITLE } },
      { scenes: SPEED_CHANGE, texts: [{ at: 4, duration: 1.4, text: 'Claude at work', style: 'caption', position: 'bottom' }] },
    ),
    t: 5,
  },

  // Other output formats: everything scales with the short side
  ...(
    [
      ['format-square', 360, 360],
      ['format-vertical', 360, 640],
    ] as const
  ).map(([name, width, height]) => ({
    name,
    project: project(
      { frame: { title: TITLE }, webcam: { enabled: true } },
      { output: { width, height, fps: 30 }, texts: [{ at: 0, duration: 10, text: 'One prompt, one call' }] },
    ),
    t: 5,
    webcam: true,
  })),
];

/**
 * The same clip whole and split at 5 s, with a zoom ramping across the split, rendered at output
 * times around the split: a continuous cut must look exactly like no cut.
 */
export const SPLIT_CHECKS: { whole: Scenario; split: Scenario }[] = [4.9, 5, 5.1].map((t) => {
  const zooms = [{ at: 4.5, duration: 1, rect: [800, 450, 480, 300] as [number, number, number, number] }];
  return {
    whole: { name: `whole-${t}`, project: project({ frame: { title: TITLE } }, { zooms }), t },
    split: {
      name: `split-${t}`,
      project: project({ frame: { title: TITLE } }, { scenes: [{ type: 'clip', from: 0, to: 5 }, { type: 'clip', from: 5, to: 10 }], zooms }),
      t,
    },
  };
});
