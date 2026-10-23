import { defaultProject } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { EXPORT_FORMATS, atSize, isExportFormat, withFormat } from '../src/formats';

describe('withFormat', () => {
  it('sets the output size of the preset and keeps the frame rate', () => {
    const project = defaultProject();
    project.output.fps = 60;
    expect(withFormat(project, '9:16').output).toEqual({ width: 1080, height: 1920, fps: 60 });
    expect(withFormat(project, '1:1').output).toEqual({ width: 1080, height: 1080, fps: 60 });
    expect(project.output.width).toBe(1920);
  });

  it('keeps the project output without a format', () => {
    const project = defaultProject();
    expect(withFormat(project, undefined)).toBe(project);
  });

  it('only knows the three presets', () => {
    expect(Object.keys(EXPORT_FORMATS)).toEqual(['16:9', '1:1', '9:16']);
    expect(isExportFormat('9:16')).toBe(true);
    expect(isExportFormat('4:3')).toBe(false);
    expect(isExportFormat('toString')).toBe(false);
  });
});

describe('withFormat at 4K and another frame rate', () => {
  it('doubles the presets to 2160 on the short side, the project’s own size too, both sides even, at the frame rate asked', () => {
    const project = defaultProject();
    expect([withFormat(project, '16:9', { size: '4k' }).output, withFormat(project, '9:16', { size: '4k' }).output, withFormat(project, '1:1', { size: '4k' }).output].map(({ width, height }) => [width, height])).toEqual([
      [3840, 2160],
      [2160, 3840],
      [2160, 2160],
    ]);
    const small = { ...project, output: { ...project.output, width: 1280, height: 720 } };
    expect(withFormat(small, undefined, { size: '4k', fps: 60 }).output).toMatchObject({ width: 3840, height: 2160, fps: 60 });
    expect(atSize({ width: 1366, height: 768 }, '4k')).toEqual({ width: 3842, height: 2160 });
    // nothing asked: the project as it is
    expect(withFormat(project, undefined, {})).toBe(project);
  });
});
