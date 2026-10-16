import { defaultProject } from '@cuttle/project';
import { describe, expect, it } from 'vitest';
import { EXPORT_FORMATS, isExportFormat, withFormat } from '../src/formats';

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
