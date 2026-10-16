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

];
