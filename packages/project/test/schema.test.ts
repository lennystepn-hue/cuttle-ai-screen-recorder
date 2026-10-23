import { describe, expect, it } from 'vitest';
import {
  CLICK_EFFECTS,
  CURRENT_VERSION,
  EASES,
  InputEventSchema,
  MASK_STYLES,
  MOUSE_BUTTONS,
  ProjectSchema,
  STILL_MOTIONS,
  TEXT_POSITIONS,
  WEBCAM_CORNERS,
  WEBCAM_SHAPES,
} from '../src/schema';

const minimal = { version: 1, sources: { screen: 'takes/1/screen.mp4' } };

function pathsOf(input: unknown): string[] {
  const r = ProjectSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => i.path.map(String).join('.'));
}

describe('ProjectSchema', () => {
  it('fills defaults for a minimal project', () => {
    const p = ProjectSchema.parse(minimal);
    expect(p.output).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(p.look.background).toEqual({ preset: 'sunset-sky' });
    expect(p.look.frame).toEqual({ enabled: true, style: 'mac-dark', title: '', radius: 14, shadow: true });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
    expect(p.look.keys).toEqual({ enabled: true, show: 'shortcuts', position: 'bottom', size: 1 });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18, border: true, shadow: true, mirror: false });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true, cleanup: true, typing: true, typingVolume: 0.5, effects: true, effectsVolume: 0.8, system: true, systemVolume: 0.8, systemDuck: 12 });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
    expect(p.masks).toEqual([]);
    expect(p.texts).toEqual([]);
    expect(p.overlays).toEqual([]);
    expect(p.music).toBeUndefined();
    expect(p.sounds).toEqual([]);
  });

  it("takes the video's music and its sounds, with their defaults", () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [{ type: 'card', id: 's1', title: 'Hi', duration: 2 }],
      music: { src: 'music/pulse/index.html', params: { key: 'E', bpm: 0, hits: true } },
      sounds: [{ id: 'a1', sound: 'whoosh', at: 3.5 }, { sound: 'sounds/ding.wav', at: 0.4, scene: 's1', volume: 0.5, label: 'Done' }],
    });
    expect(p.music).toEqual({ src: 'music/pulse/index.html', params: { key: 'E', bpm: 0, hits: true }, network: false, volume: 0.8, duck: 12, enabled: true });
    expect(p.sounds).toEqual([
      { id: 'a1', sound: 'whoosh', at: 3.5, volume: 0.8, enabled: true },
      { sound: 'sounds/ding.wav', at: 0.4, scene: 's1', volume: 0.5, label: 'Done', enabled: true },
    ]);
  });

  it("rejects a sound in a scene that does not exist, a sound's id used elsewhere, and levels out of range", () => {
    expect(pathsOf({ ...minimal, sounds: [{ sound: 'pop', at: 1, scene: 's9' }] })).toEqual(['sounds.0.scene']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'card', id: 'x', title: 'Hi', duration: 2 }], sounds: [{ id: 'x', sound: 'pop', at: 1 }] })).toEqual(['sounds.0.id']);
    expect(pathsOf({ ...minimal, music: { src: 'm.html', volume: 2, duck: -1 } })).toEqual(['music.volume', 'music.duck']);
    expect(pathsOf({ ...minimal, music: { volume: 0.5 } })).toEqual(['music.src']);
  });

  it('parses the spec example and applies item defaults', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'clip', from: 63.5, to: 70.5 },
        { type: 'clip', from: 5.3, to: 152.5, speed: 12, badge: '12× speed' },
        { type: 'still', image: 'page.png', duration: 4, motion: 'scroll', frame: 'browser-light' },
        { type: 'card', title: 'Claude Code + treg', subtitle: 'treg.to', duration: 2.5 },
      ],
      zooms: [{ at: 150, duration: 4, rect: [0, 170, 1600, 900] }],
      masks: [{ from: 0, to: 70, rect: [30, 774, 780, 84] }],
      texts: [{ at: 2, duration: 3, text: 'One prompt, one call' }],
    });
    expect(p.scenes[0]).toEqual({ type: 'clip', from: 63.5, to: 70.5, speed: 1 });
    expect(p.scenes[2]).toEqual({ type: 'still', image: 'page.png', duration: 4, motion: 'scroll', frame: 'browser-light' });
    expect(p.zooms[0]).toEqual({ at: 150, duration: 4, rect: [0, 170, 1600, 900], ease: 'smooth', enabled: true });
    expect(p.masks[0]).toEqual({ from: 0, to: 70, rect: [30, 774, 780, 84], style: 'fill', enabled: true });
    expect(p.texts[0]).toEqual({
      at: 2, duration: 3, text: 'One prompt, one call', style: 'pill', position: 'top', enabled: true,
    });
  });

  it('keeps the optional id and label of scenes and overlays', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'clip', id: 's1', label: 'Claude at work', from: 0, to: 9, speed: 12 },
        { type: 'card', id: 'end-card', label: 'End', title: 'Done', duration: 2 },
      ],
      zooms: [{ id: 'z1', label: 'Answer', at: 1, duration: 2, rect: [0, 0, 10, 10] }],
      masks: [{ id: 'm_1', from: 0, to: 1, rect: [0, 0, 1, 1] }],
      texts: [{ label: '', at: 0, duration: 1, text: 'Hi' }],
    });
    expect(p.scenes.map((scene) => [scene.id, scene.label])).toEqual([['s1', 'Claude at work'], ['end-card', 'End']]);
    expect(p.zooms[0]).toMatchObject({ id: 'z1', label: 'Answer' });
    expect(p.masks[0]?.id).toBe('m_1');
    expect(p.texts[0]).toMatchObject({ label: '' });
    expect(ProjectSchema.parse({ ...minimal, zooms: [{ at: 1, duration: 2, rect: [0, 0, 10, 10] }] }).zooms[0]).not.toHaveProperty('id');
  });

  it('rejects an id with other characters, and one used twice anywhere in the project', () => {
    expect(pathsOf({ ...minimal, zooms: [{ id: 'zoom 1', at: 1, duration: 2, rect: [0, 0, 10, 10] }] })).toEqual(['zooms.0.id']);
    expect(pathsOf({ ...minimal, zooms: [{ id: '', at: 1, duration: 2, rect: [0, 0, 10, 10] }] })).toEqual(['zooms.0.id']);
    const twice = ProjectSchema.safeParse({
      ...minimal,
      scenes: [{ type: 'clip', id: 'a', from: 0, to: 1 }],
      masks: [{ id: 'b', from: 0, to: 1, rect: [0, 0, 1, 1] }],
      texts: [{ id: 'a', at: 0, duration: 1, text: 'Hi' }, { id: 'b', at: 0, duration: 1, text: 'Ho' }],
    });
    expect(twice.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['texts.0.id', 'the id "a" is already used by scenes[0]'],
      ['texts.1.id', 'the id "b" is already used by masks[0]'],
    ]);
  });

  it('reads a script: steps with an id, a title and a note, each id unique in the project', () => {
    expect(ProjectSchema.parse(minimal).script).toEqual([]);
    const steps = [{ id: 'step1', title: 'Open the settings', note: 'The gear, top right.' }, { id: 'step2', title: 'Turn on dark mode' }];
    expect(ProjectSchema.parse({ ...minimal, script: steps }).script).toEqual(steps);
    expect(pathsOf({ ...minimal, script: [{ title: 'No id' }] })).toEqual(['script.0.id']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: '   ' }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'x'.repeat(81) }] })).toEqual(['script.0.title']);
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'Go', note: 'x'.repeat(1001) }] })).toEqual(['script.0.note']);
    // a step's title may be a motion template's, the kit's lower third or title
    expect(ProjectSchema.parse({ ...minimal, script: [{ id: 'step1', title: 'Go', motion: 'lower-third' }] }).script[0]!.motion).toBe('lower-third');
    expect(pathsOf({ ...minimal, script: [{ id: 'step1', title: 'Go', motion: 'end-card' }] })).toEqual(['script.0.motion']);
    expect(pathsOf({ ...minimal, script: Array.from({ length: 51 }, (_, i) => ({ id: `step${i + 1}`, title: 'Go' })) })).toEqual(['script']);
    const twice = ProjectSchema.safeParse({ ...minimal, scenes: [{ type: 'clip', id: 'step1', from: 0, to: 1 }], script: [{ id: 'step1', title: 'Go' }] });
    expect(twice.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([['script.0.id', 'the id "step1" is already used by scenes[0]']]);
  });

  it('rejects unknown keys and names them', () => {
    const r = ProjectSchema.safeParse({ ...minimal, look: { frame: { foo: 1 } } });
    expect(r.success).toBe(false);
    const issue = r.error?.issues.find((i) => i.path.join('.') === 'look.frame');
    expect(issue?.message).toContain('foo');
  });

  it('rejects a clip whose end is not after its start', () => {
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 5, to: 5 }] })).toContain('scenes.0.to');
  });

  it('rejects a mask whose end is not after its start', () => {
    expect(pathsOf({ ...minimal, masks: [{ from: 3, to: 1, rect: [0, 0, 1, 1] }] })).toContain('masks.0.to');
  });

  it('needs a color for the solid background and an image for the image background', () => {
    expect(pathsOf({ ...minimal, look: { background: { preset: 'solid' } } })).toContain('look.background.color');
    expect(pathsOf({ ...minimal, look: { background: { preset: 'image' } } })).toContain('look.background.image');
  });

  it('rejects zero-sized rects and a speed of zero', () => {
    expect(pathsOf({ ...minimal, zooms: [{ at: 0, duration: 1, rect: [0, 0, 0, 10] }] })).toContain('zooms.0.rect.2');
  });

  it('takes a mask that follows, and the privacy guard\'s words', () => {
    const mask = { from: 2, to: 6, rect: [10, 10, 300, 40] };
    const moves = [{ at: 3, rect: [10, 60, 300, 40] }];
    expect(ProjectSchema.parse({ ...minimal, masks: [{ ...mask, moves }] }).masks[0]!.moves).toEqual(moves);
    expect(pathsOf({ ...minimal, masks: [{ ...mask, moves: [{ at: 6, rect: [0, 0, 9, 9] }] }] })).toEqual(['masks.0.moves.0.at']);
    expect(pathsOf({ ...minimal, masks: [{ ...mask, to: 2 }] })).toEqual(['masks.0.to']);
    expect(ProjectSchema.parse(minimal).privacy).toEqual({ words: [] });
    expect(ProjectSchema.parse({ ...minimal, privacy: { words: [' Lena Müller '] } }).privacy.words).toEqual(['Lena Müller']);
    expect(pathsOf({ ...minimal, privacy: { words: [''] } })).toEqual(['privacy.words.0']);
  });

  it('takes a zoom that follows: its moves come in time order, inside the zoom', () => {
    const zoom = { at: 2, duration: 4, rect: [0, 0, 800, 450] };
    const moves = [{ at: 3, rect: [100, 0, 800, 450] }, { at: 4.5, rect: [100, 200, 800, 450] }];
    expect(ProjectSchema.parse({ ...minimal, zooms: [{ ...zoom, moves }] }).zooms[0]!.moves).toEqual(moves);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [{ at: 2, rect: [0, 0, 8, 4] }] }] })).toEqual(['zooms.0.moves.0.at']);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [moves[1], moves[0]] }] })).toEqual(['zooms.0.moves.1.at']);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [{ at: 6, rect: [0, 0, 8, 4] }] }] })).toEqual(['zooms.0.moves.0.at']);
    expect(pathsOf({ ...minimal, zooms: [{ ...zoom, moves: [{ at: 3, rect: [0, 0, 0, 4] }] }] })).toEqual(['zooms.0.moves.0.rect.2']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 1, speed: 0 }] })).toContain('scenes.0.speed');
  });

  it('accepts the six cursor styles and rejects others', () => {
    expect(ProjectSchema.parse({ ...minimal, look: { cursor: { style: 'spotlight' } } }).look.cursor.style).toBe('spotlight');
    expect(pathsOf({ ...minimal, look: { cursor: { style: 'laser' } } })).toContain('look.cursor.style');
  });

  it('reads the key badges and refuses an unknown choice and a size out of range', () => {
    expect(ProjectSchema.parse({ ...minimal, look: { keys: { show: 'keys', position: 'top', size: 1.5 } } }).look.keys).toEqual({ enabled: true, show: 'keys', position: 'top', size: 1.5 });
    expect(pathsOf({ ...minimal, look: { keys: { show: 'letters', position: 'center', size: 3 } } })).toEqual(['look.keys.show', 'look.keys.position', 'look.keys.size']);
  });

  it('reports every problem in one pass, including cross-field checks', () => {
    const paths = pathsOf({
      ...minimal,
      output: { width: 'x' },
      look: { background: { preset: 'solid' } },
      scenes: [{ type: 'clip', from: 5, to: 2 }, { type: 'clap' }],
    });
    expect(paths).toContain('output.width');
    expect(paths).toContain('look.background.color');
    expect(paths).toContain('scenes.0.to');
    expect(paths).toContain('scenes.1.type');
  });

  it('accepts a solid background with a color and an image background with an image', () => {
    const solid = ProjectSchema.parse({ ...minimal, look: { background: { preset: 'solid', color: '#0c0c0c' } } });
    expect(solid.look.background).toEqual({ preset: 'solid', color: '#0c0c0c' });
    const image = ProjectSchema.parse({ ...minimal, look: { background: { preset: 'image', image: 'bg.png' } } });
    expect(image.look.background).toEqual({ preset: 'image', image: 'bg.png' });
  });

  it('names an unknown key inside a scene at the scene path', () => {
    const r = ProjectSchema.safeParse({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 1, sped: 2 }] });
    expect(r.success).toBe(false);
    const issue = r.error?.issues.find((i) => i.path.join('.') === 'scenes.0');
    expect(issue?.message).toContain('sped');
  });

  it('fills the remaining defaults of a partial block', () => {
    const p = ProjectSchema.parse({ ...minimal, look: { cursor: { style: 'dot' } } });
    expect(p.look.cursor).toEqual({ enabled: true, style: 'dot', size: 1, color: '#D97757', clickEffect: 'ripple', smoothing: 0.5 });
  });

  it('rejects non-finite numbers', () => {
    expect(pathsOf({ ...minimal, zooms: [{ at: Infinity, duration: 1, rect: [0, 0, 1, 1] }] })).toContain('zooms.0.at');
    expect(pathsOf({ ...minimal, zooms: [{ at: 0, duration: NaN, rect: [0, 0, 1, 1] }] })).toContain('zooms.0.duration');
  });

  describe('output', () => {
    it('defaults each field on its own', () => {
      const p = ProjectSchema.parse({ ...minimal, output: { fps: 60 } });
      expect(p.output).toEqual({ width: 1920, height: 1080, fps: 60 });
    });

    it('rejects an odd width or height', () => {
      expect(pathsOf({ ...minimal, output: { width: 1921 } })).toContain('output.width');
      expect(pathsOf({ ...minimal, output: { height: 1081 } })).toContain('output.height');
    });

    it('rejects a size above 4096', () => {
      expect(pathsOf({ ...minimal, output: { width: 5000 } })).toContain('output.width');
    });

    it('accepts a 9:16 portrait size', () => {
      const p = ProjectSchema.parse({ ...minimal, output: { width: 1080, height: 1920 } });
      expect(p.output).toEqual({ width: 1080, height: 1920, fps: 30 });
    });
  });
});

describe('exported enum lists', () => {
  it('match the values the schema accepts', () => {
    expect(EASES).toEqual(['smooth', 'linear']);
    expect(MASK_STYLES).toEqual(['fill', 'blur']);
    expect(TEXT_POSITIONS).toEqual(['top', 'center', 'bottom']);
    expect(STILL_MOTIONS).toEqual(['none', 'kenburns', 'scroll']);
    expect(WEBCAM_SHAPES).toEqual(['circle', 'rounded', 'squircle', 'square']);
    expect(WEBCAM_CORNERS).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    expect(CLICK_EFFECTS).toEqual(['ripple', 'none']);
    expect(MOUSE_BUTTONS).toEqual(['left', 'right', 'middle']);
    expect(CURRENT_VERSION).toBe(1);
  });
});

describe('InputEventSchema', () => {
  it('parses each event type of events.jsonl and rejects unknown cursor shapes', () => {
    expect(InputEventSchema.parse({ t: 1.5, type: 'click', x: 10, y: 20, button: 'left' })).toEqual({
      t: 1.5, type: 'click', x: 10, y: 20, button: 'left',
    });
    expect(InputEventSchema.parse({ t: 2, type: 'shape', shape: 'text' }).type).toBe('shape');
    expect(InputEventSchema.parse({ t: 3, type: 'keys', count: 4 }).type).toBe('keys');
    expect(InputEventSchema.parse({ t: 4, type: 'scroll', x: 0, y: 0, dx: 0, dy: -3 }).type).toBe('scroll');
    expect(InputEventSchema.parse({ t: 5, type: 'shortcut', keys: ['⌘', '⇧', 'P'] })).toEqual({ t: 5, type: 'shortcut', keys: ['⌘', '⇧', 'P'] });
    expect(InputEventSchema.safeParse({ t: 5, type: 'shortcut', keys: [] }).success).toBe(false);
    expect(InputEventSchema.safeParse({ t: 2, type: 'shape', shape: 'banana' }).success).toBe(false);
  });

  it('rejects an extra key and a negative time', () => {
    expect(InputEventSchema.safeParse({ t: 1, type: 'move', x: 0, y: 0, z: 1 }).success).toBe(false);
    expect(InputEventSchema.safeParse({ t: -0.1, type: 'move', x: 0, y: 0 }).success).toBe(false);
  });
});

describe('automatic edits in the project', () => {
  it('has no cuts and every kind of automatic edit on by default', () => {
    const p = ProjectSchema.parse(minimal);
    expect(p.cuts).toEqual([]);
    expect(p.autoEdits).toEqual({
      crop: true, privacy: true, retakes: true, fillers: true, pauses: true, typingZooms: true, dialogZooms: true, clickZooms: true, answerZoom: true, stepTitles: true, stepZooms: true,
    });
  });

  it('reads cuts, crops and the tags of automatic items', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [{ type: 'clip', id: 's1', from: 0, to: 40, crop: { rect: [62, 141, 2478, 1237], auto: 'crop' } }],
      cuts: [{ id: 'c1', label: 'Filler: ähm', from: 12.4, to: 12.8, auto: 'filler' }],
      zooms: [{ id: 'z1', at: 30, duration: 3, rect: [0, 0, 960, 540], auto: 'click' }],
      masks: [{ id: 'm1', from: 1, to: 2, rect: [0, 0, 10, 10], auto: 'privacy' }],
      texts: [{ id: 't1', at: 1, duration: 3, text: 'Open the settings', auto: 'title' }],
      overlays: [{ id: 'o1', src: 'motion/lower-third/index.html', at: 8, duration: 4, auto: 'title' }],
      autoEdits: { fillers: false },
    });
    expect(p.scenes[0]).toMatchObject({ crop: { rect: [62, 141, 2478, 1237], enabled: true, auto: 'crop' } });
    expect(p.cuts[0]).toEqual({ id: 'c1', label: 'Filler: ähm', from: 12.4, to: 12.8, enabled: true, auto: 'filler' });
    expect(p.zooms[0]!.auto).toBe('click');
    expect([p.texts[0]!.auto, p.overlays[0]!.auto]).toEqual(['title', 'title']);
    expect(p.autoEdits).toMatchObject({ fillers: false, pauses: true });
  });

  it('refuses a cut that ends before it starts, an unknown kind, a crop tagged otherwise and an id used twice', () => {
    expect(pathsOf({ ...minimal, cuts: [{ from: 3, to: 2 }] })).toEqual(['cuts.0.to']);
    expect(pathsOf({ ...minimal, zooms: [{ at: 1, duration: 2, rect: [0, 0, 10, 10], auto: 'magic' }] })).toEqual(['zooms.0.auto']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 2, crop: { rect: [0, 0, 10, 10], auto: 'click' } }] })).toEqual(['scenes.0.crop.auto']);
    expect(pathsOf({ ...minimal, zooms: [{ id: 'c1', at: 1, duration: 2, rect: [0, 0, 10, 10] }], cuts: [{ id: 'c1', from: 1, to: 2 }] })).toEqual(['cuts.0.id']);
  });
});

describe('captions', () => {
  it('are on, as subtitles at the bottom, by default', () => {
    expect(ProjectSchema.parse(minimal).captions).toEqual({ enabled: true, style: 'subtitle', position: 'bottom', size: 1, color: '#D97757', fixes: [] });
  });

  it('read a style, a size and fixes of the transcript', () => {
    const p = ProjectSchema.parse({ ...minimal, captions: { style: 'karaoke', size: 1.4, fixes: [{ at: 3.12, end: 3.58, text: 'Holofish' }, { at: 5, end: 5.2, text: '' }] } });
    expect(p.captions).toMatchObject({ enabled: true, style: 'karaoke', size: 1.4, fixes: [{ at: 3.12, end: 3.58, text: 'Holofish' }, { at: 5, end: 5.2, text: '' }] });
  });

  it('refuse an unknown style, a size out of range and a fix that ends before it starts', () => {
    expect(pathsOf({ ...minimal, captions: { style: 'marquee' } })).toEqual(['captions.style']);
    expect(pathsOf({ ...minimal, captions: { size: 3 } })).toEqual(['captions.size']);
    expect(pathsOf({ ...minimal, captions: { fixes: [{ at: 2, end: 1, text: 'x' }] } })).toEqual(['captions.fixes.0.end']);
  });
});

describe('motion', () => {
  it('reads a motion scene and a motion overlay, with their defaults', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [{ type: 'motion', id: 's1', label: 'Intro', src: 'motion/intro/index.html', duration: 3, params: { title: 'Cuttle', size: 2, dark: true, logo: null } }],
      overlays: [{ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6 }],
    });
    expect(p.scenes[0]).toEqual({
      type: 'motion',
      id: 's1',
      label: 'Intro',
      src: 'motion/intro/index.html',
      duration: 3,
      params: { title: 'Cuttle', size: 2, dark: true, logo: null },
      network: false,
    });
    expect(p.overlays[0]).toEqual({ id: 'o1', src: 'motion/callouts/index.html', at: 4.2, duration: 6, params: {}, network: false, enabled: true });
  });

  it('reads the transition page into any scene, with its defaults, and refuses one too long or without a page', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'card', title: 'A', duration: 2 },
        { type: 'clip', from: 0, to: 4, transition: { src: 'motion/fold/index.html' } },
        { type: 'card', title: 'B', duration: 2, transition: { src: 'motion/fold/index.html', duration: 1.5, params: { direction: 'right' }, enabled: false } },
      ],
    });
    expect(p.scenes[1]!.transition).toEqual({ src: 'motion/fold/index.html', params: {}, network: false, duration: 0.8, enabled: true });
    expect(p.scenes[2]!.transition).toEqual({ src: 'motion/fold/index.html', params: { direction: 'right' }, network: false, duration: 1.5, enabled: false });
    expect(p.scenes[0]!.transition).toBeUndefined();
    expect(pathsOf({ ...minimal, scenes: [{ type: 'card', title: 'A', duration: 2, transition: { src: 'a.html', duration: 5 } }] })).toEqual(['scenes.0.transition.duration']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'card', title: 'A', duration: 2, transition: { duration: 1 } }] })).toEqual(['scenes.0.transition.src']);
  });

  it('reads motion blur with its defaults, and refuses too few samples and a shutter of zero', () => {
    const p = ProjectSchema.parse({
      ...minimal,
      scenes: [
        { type: 'motion', src: 'a.html', duration: 1, motionBlur: {} },
        { type: 'motion', src: 'b.html', duration: 1, motionBlur: { samples: 16, shutter: 1 } },
      ],
      overlays: [{ src: 'c.html', at: 0, duration: 1, motionBlur: { samples: 4 } }],
    });
    expect(p.scenes.map((scene) => (scene.type === 'motion' ? scene.motionBlur : undefined))).toEqual([
      { samples: 8, shutter: 0.5 },
      { samples: 16, shutter: 1 },
    ]);
    expect(p.overlays[0]!.motionBlur).toEqual({ samples: 4, shutter: 0.5 });
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 1, motionBlur: { samples: 1 } }] })).toEqual(['scenes.0.motionBlur.samples']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 1, motionBlur: { shutter: 0 } }] })).toEqual(['scenes.0.motionBlur.shutter']);
  });

  it('refuses a page without a path, a length of zero, a param that is a list and an id used elsewhere', () => {
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: '', duration: 2 }] })).toEqual(['scenes.0.src']);
    expect(pathsOf({ ...minimal, scenes: [{ type: 'motion', src: 'a.html', duration: 0 }] })).toEqual(['scenes.0.duration']);
    expect(pathsOf({ ...minimal, overlays: [{ src: 'a.html', at: 1, duration: 2, params: { list: [1, 2] } }] })).toEqual(['overlays.0.params.list']);
    expect(pathsOf({ ...minimal, texts: [{ id: 'o1', at: 1, duration: 2, text: 'Hi' }], overlays: [{ id: 'o1', src: 'a.html', at: 1, duration: 2 }] })).toEqual(['overlays.0.id']);
  });
});

describe('the theme (the brand)', () => {
  it('has white text and the Archivo headings by default, and nothing else', () => {
    expect(ProjectSchema.parse(minimal).theme).toEqual({ foreground: '#FFFFFF', font: 'Archivo' });
  });

  it('reads a name, URL, logo, colours, a heading font and its kit', () => {
    const theme = { name: 'Acme', url: 'acme.dev', logo: 'brand/acme.svg', accent: '#3366FF', foreground: '#F0F0F0', background: '#0A0A14', font: 'Instrument Serif', kit: 'Acme' };
    expect(ProjectSchema.parse({ ...minimal, theme }).theme).toEqual(theme);
  });

  it('refuses a colour that is no hex colour, a font of none of the kit\'s faces and an unknown key', () => {
    expect(pathsOf({ ...minimal, theme: { accent: 'blue' } })).toEqual(['theme.accent']);
    expect(pathsOf({ ...minimal, theme: { font: 'Comic Sans' } })).toEqual(['theme.font']);
    expect(pathsOf({ ...minimal, theme: { colour: '#000000' } })).toEqual(['theme']);
  });
});

describe('the watermark and the device frames', () => {
  it('has the watermark off by default, in the bottom right corner', () => {
    expect(ProjectSchema.parse(minimal).look.watermark).toEqual({ enabled: false, corner: 'bottom-right', size: 0.06, opacity: 0.7 });
  });

  it('reads an image or a text, a corner, a size and an opacity, and refuses them out of range', () => {
    const watermark = { enabled: true, image: 'images/mark.png', text: 'acme.dev', corner: 'top-left', size: 0.1, opacity: 0.5 };
    expect(ProjectSchema.parse({ ...minimal, look: { watermark } }).look.watermark).toEqual(watermark);
    expect(pathsOf({ ...minimal, look: { watermark: { size: 0.5 } } })).toEqual(['look.watermark.size']);
    expect(pathsOf({ ...minimal, look: { watermark: { opacity: 0 } } })).toEqual(['look.watermark.opacity']);
    expect(pathsOf({ ...minimal, look: { watermark: { corner: 'middle' } } })).toEqual(['look.watermark.corner']);
  });

  it('reads the new frames, for the window and for a still', () => {
    for (const style of ['browser-dark', 'windows-light', 'windows-dark', 'terminal', 'iphone', 'android']) {
      expect(pathsOf({ ...minimal, look: { frame: { style } }, scenes: [{ type: 'still', image: 'a.png', duration: 1, frame: style }] })).toEqual([]);
    }
  });
});

describe('backgrounds', () => {
  it('read a gradient, the quiet ones in colours of their own, and a softened, darker image', () => {
    const gradient = { preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90, kind: 'radial' };
    expect(ProjectSchema.parse({ ...minimal, look: { background: gradient } }).look.background).toEqual(gradient);
    for (const preset of ['flow', 'bokeh', 'dots', 'mesh']) expect(pathsOf({ ...minimal, look: { background: { preset, colors: ['#000000', '#FFFFFF'] } } })).toEqual([]);
    expect(pathsOf({ ...minimal, look: { background: { preset: 'flow' } } })).toEqual([]);
    expect(pathsOf({ ...minimal, look: { background: { preset: 'image', image: 'images/wallpaper.jpg', blur: 0.6, dim: 0.3 } } })).toEqual([]);
  });

  it('refuse a gradient without colours, too few or too many, an angle past 360, an unknown shape, and too much blur or dark', () => {
    const issues = (background: Record<string, unknown>) => pathsOf({ ...minimal, look: { background } });
    expect(issues({ preset: 'gradient' })).toEqual(['look.background.colors']);
    expect(issues({ preset: 'gradient', colors: ['#000000'] })).toEqual(['look.background.colors']);
    expect(issues({ preset: 'flow', colors: ['#000000', '#111111', '#222222', '#333333', '#444444'] })).toEqual(['look.background.colors']);
    expect(issues({ preset: 'gradient', colors: ['#000000', 'red'] })).toEqual(['look.background.colors.1']);
    expect(issues({ preset: 'gradient', colors: ['#000000', '#FFFFFF'], angle: 400 })).toEqual(['look.background.angle']);
    expect(issues({ preset: 'gradient', colors: ['#000000', '#FFFFFF'], kind: 'conic' })).toEqual(['look.background.kind']);
    expect(issues({ preset: 'image', image: 'a.png', blur: 1.5 })).toEqual(['look.background.blur']);
    expect(issues({ preset: 'image', image: 'a.png', dim: 0.9 })).toEqual(['look.background.dim']);
  });
});
