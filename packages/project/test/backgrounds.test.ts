import { describe, expect, it } from 'vitest';
import { BACKGROUND_PALETTES, backgroundColors, backgroundTone, darkTone, isColouredBackground, switchBackground } from '../src/index';

describe('background colours', () => {
  it('are a background\'s own, else its preset\'s, and none for the others', () => {
    expect(backgroundColors({ preset: 'flow', colors: ['#000000', '#FFFFFF'] })).toEqual(['#000000', '#FFFFFF']);
    expect(backgroundColors({ preset: 'bokeh' })).toEqual(BACKGROUND_PALETTES.bokeh);
    expect(backgroundColors({ preset: 'aurora' })).toEqual([]);
    expect(['gradient', 'mesh', 'flow', 'bokeh', 'dots'].every((preset) => isColouredBackground(preset as never))).toBe(true);
    expect(isColouredBackground('image')).toBe(false);
  });

  it('give pages a dark tone of them', () => {
    expect(darkTone(['#FF8080', '#204060'], 0.5)).toBe('#102030');
    expect(backgroundTone({ preset: 'gradient', colors: ['#FFFFFF', '#406080'] })).toBe('#1d2b3a');
    // the presets' own tones stay as they were
    expect(backgroundTone({ preset: 'mesh' })).toBe('#2a2140');
    expect(backgroundTone({ preset: 'flow' })).toBe('#0d0a24');
  });
});

describe('switchBackground', () => {
  it('keeps what the new preset reads: colours from one coloured background to the next', () => {
    expect(switchBackground({ preset: 'gradient', colors: ['#000000', '#FFFFFF'], angle: 90 }, 'flow')).toEqual({ preset: 'flow', colors: ['#000000', '#FFFFFF'] });
    expect(switchBackground({ preset: 'flow', colors: ['#000000', '#FFFFFF'] }, 'gradient')).toEqual({ preset: 'gradient', colors: ['#000000', '#FFFFFF'] });
    expect(switchBackground({ preset: 'image', image: 'a.png', blur: 0.5 }, 'aurora')).toEqual({ preset: 'aurora' });
  });

  it('gives a new gradient its preset\'s colours and a solid one a dark grey', () => {
    expect(switchBackground({ preset: 'aurora' }, 'gradient')).toEqual({ preset: 'gradient', colors: ['#7C5CFF', '#FF7AB6'] });
    expect(switchBackground({ preset: 'aurora' }, 'solid')).toEqual({ preset: 'solid', color: '#1C1C22' });
    expect(switchBackground({ preset: 'solid', color: '#102030' }, 'solid')).toEqual({ preset: 'solid', color: '#102030' });
  });
});
