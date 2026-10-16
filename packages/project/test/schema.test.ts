import { describe, expect, it } from 'vitest';
import { InputEventSchema, ProjectSchema } from '../src/schema';

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
    expect(p.look.cursor).toEqual({ enabled: true, style: 'system', size: 1, color: '#D97757', clickEffect: 'ripple' });
    expect(p.look.webcam).toEqual({ enabled: false, shape: 'circle', corner: 'bottom-left', size: 0.18 });
    expect(p.look.audio).toEqual({ enabled: true, muteSpedUp: true });
    expect(p.look.transition).toEqual({ enabled: true, duration: 0.3 });
    expect(p.scenes).toEqual([]);
    expect(p.zooms).toEqual([]);
    expect(p.masks).toEqual([]);
    expect(p.texts).toEqual([]);
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
    expect(pathsOf({ ...minimal, scenes: [{ type: 'clip', from: 0, to: 1, speed: 0 }] })).toContain('scenes.0.speed');
  });

  it('accepts the six cursor styles and rejects others', () => {
    expect(ProjectSchema.parse({ ...minimal, look: { cursor: { style: 'spotlight' } } }).look.cursor.style).toBe('spotlight');
    expect(pathsOf({ ...minimal, look: { cursor: { style: 'laser' } } })).toContain('look.cursor.style');
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
    expect(InputEventSchema.safeParse({ t: 2, type: 'shape', shape: 'banana' }).success).toBe(false);
  });
});
