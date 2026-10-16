import { BACKGROUND_PRESETS, CURSOR_SHAPES, CURSOR_STYLES, FRAME_STYLES, TEXT_STYLES } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { BACKGROUNDS } from '../src/presets/backgrounds';
import { CURSOR_ART, CURSOR_GRID, cursorImageFor } from '../src/presets/cursors';
import { FRAME_CHROME } from '../src/presets/frames';
import { TEXT_LABELS } from '../src/presets/labels';

describe('preset registries', () => {
  it('have a shader for every background preset', () => {
    for (const preset of BACKGROUND_PRESETS) expect(BACKGROUNDS[preset]).toContain('void main()');
  });

  it('have chrome for every frame style; only "none" has no title bar', () => {
    for (const style of FRAME_STYLES) expect(FRAME_CHROME[style].titleBar > 0).toBe(style !== 'none');
  });

  it('have a label style for every text style', () => {
    for (const style of TEXT_STYLES) expect(TEXT_LABELS[style].size).toBeGreaterThan(0);
  });
});

describe('cursor art', () => {
  it('gives system cursors one image per shape and the designed arrows a fixed image', () => {
    for (const shape of CURSOR_SHAPES) {
      expect(cursorImageFor('system', shape)).toBe(`system:${shape}`);
      expect(cursorImageFor('arrow-white', shape)).toBe('arrow-white');
      expect(cursorImageFor('arrow-black', shape)).toBe('arrow-black');
      expect(cursorImageFor('dot', shape)).toBeUndefined();
    }
  });

  it('has art with an in-grid hotspot for every image a style can ask for', () => {
    for (const style of CURSOR_STYLES) {
      for (const shape of CURSOR_SHAPES) {
        const image = cursorImageFor(style, shape);
        if (!image) continue;
        const art = CURSOR_ART[image];
        expect(art.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">')).toBe(true);
        for (const coordinate of art.hotspot) {
          expect(coordinate).toBeGreaterThanOrEqual(0);
          expect(coordinate).toBeLessThanOrEqual(CURSOR_GRID);
        }
      }
    }
  });
});
