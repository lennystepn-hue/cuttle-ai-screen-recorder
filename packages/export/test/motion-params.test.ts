import { describe, expect, it } from 'vitest';
import { declaredParams, paramDefaults } from '../src/motion/params';

const page = (json: string) => `<!doctype html><title>x</title><script type="application/json" id="cuttle-params">${json}</script><h1>x</h1>`;

describe('the params a page declares', () => {
  it("reads each kind with its default, a select's choices and a number's range", () => {
    const { params, issues } = declaredParams(
      page(`[
        { "name": "title", "label": "Title", "type": "text", "default": "Hello" },
        { "name": "accent", "type": "color", "default": "#d97757" },
        { "name": "size", "label": "Size", "type": "number", "default": 1, "min": 0.5, "max": 2 },
        { "name": "logo", "label": "Logo", "type": "image", "default": null },
        { "name": "dark", "label": "Dark", "type": "bool", "default": true },
        { "name": "side", "label": "Side", "type": "select", "default": "left", "options": ["left", "right"] }
      ]`),
    );
    expect(issues).toEqual([]);
    expect(params).toEqual([
      { name: 'title', label: 'Title', type: 'text', default: 'Hello' },
      { name: 'accent', label: 'accent', type: 'color', default: '#d97757' },
      { name: 'size', label: 'Size', type: 'number', default: 1, min: 0.5, max: 2 },
      { name: 'logo', label: 'Logo', type: 'image', default: null },
      { name: 'dark', label: 'Dark', type: 'bool', default: true },
      { name: 'side', label: 'Side', type: 'select', default: 'left', options: ['left', 'right'] },
    ]);
    expect(paramDefaults(params)).toEqual({ title: 'Hello', accent: '#d97757', size: 1, logo: null, dark: true, side: 'left' });
  });

  it('finds none in a page without a declaration', () => {
    expect(declaredParams('<!doctype html><h1>Hi</h1>')).toEqual({ params: [], issues: [] });
  });

  it('names what is wrong and keeps the params that are right', () => {
    const { params, issues } = declaredParams(
      page(`[
        { "name": "ok", "type": "text", "default": "x" },
        { "name": "bad name", "type": "text" },
        { "name": "n", "type": "number", "default": "1" },
        { "name": "s", "type": "select", "default": "a" },
        { "name": "ok", "type": "bool", "default": false },
        { "name": "w", "type": "weird" }
      ]`),
    );
    expect(params.map((param) => param.name)).toEqual(['ok']);
    expect(issues).toEqual([
      'cuttle-params[1].name must be a name of letters, digits, - or _',
      'cuttle-params[2].default does not fit its type number',
      'cuttle-params[3].options must list the choices of a select',
      'cuttle-params[4].name "ok" is declared twice',
      'cuttle-params[5].type must be one of text, color, number, image, bool, select',
    ]);
    expect(declaredParams(page('{ "name": "x" }')).issues).toEqual(['cuttle-params must be a list of params']);
    expect(declaredParams(page('[oops')).issues[0]).toMatch(/^cuttle-params is not JSON/);
  });
});
