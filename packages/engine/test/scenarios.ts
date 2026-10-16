import type { CuttleProjectInput, InputEvent } from '@cuttle/project';

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

export const SCENARIOS: Scenario[] = [
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

  // Cursors: six styles with a click ripple, then the system shapes
  ...(['system', 'arrow-white', 'arrow-black', 'dot', 'ring', 'spotlight'] as const).map(cursorScenario),
  ...(['text', 'pointer', 'wait', 'crosshair', 'move', 'not-allowed'] as const).map(shapeScenario),
];
