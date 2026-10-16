import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../src/color';

describe('hexToRgb', () => {
  it('converts #RRGGBB to 0..1 components', () => {
    expect(hexToRgb('#FF8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('#d97757')).toEqual([217 / 255, 119 / 255, 87 / 255]);
  });

  it('rejects anything else', () => {
    expect(() => hexToRgb('red')).toThrow('not a hex color: red');
    expect(() => hexToRgb('#FFF')).toThrow();
  });
});
