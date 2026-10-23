import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runFfmpeg } from '@cuttle/core';
import { COMMAND_TOOLS, createMcpServer, runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** Every field a tool's input can have, set: its options all on the command line. */
function everything(shape: Record<string, unknown>): Record<string, unknown> {
  const sample: Record<string, unknown> = {
    project: '/p',
    target: 'https://example.com',
    template: 'title',
    page: 'motion/a/index.html',
    src: 'motion/a/index.html',
    sound: 'whoosh',
    text: 'Hello',
    id: 'en_US-amy-medium',
    name: 'n',
    file: 'a.mp4',
    take: 'takes/1',
    preset: 'gradient',
    as: 'scene',
    format: '9:16',
    model: 'small',
    language: 'en',
    params: { bpm: 120 },
    colors: ['#000000', '#ffffff'],
    at: 1,
    seconds: 2,
  };
  const input: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
    if (inner instanceof z.ZodArray) input[key] = key === 'colors' ? sample.colors : inner.element instanceof z.ZodNumber ? [1, 2] : ['secret'];
    else if (inner instanceof z.ZodEnum) input[key] = inner.options[0];
    else if (key in sample) input[key] = sample[key];
    else if (inner instanceof z.ZodNumber) input[key] = 0.5;
    else input[key] = true;
  }
  return input;
}

describe('cuttle mcp', () => {
  let client: Client;
  beforeAll(async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer().connect(serverSide);
    client = new Client({ name: 'check', version: '1' });
    await client.connect(clientSide);
  });

  it('offers every command as a tool, the guides, and cuttle.json to read and write', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['guide', 'read_project', 'write_project', ...COMMAND_TOOLS.map((tool) => tool.name)].sort());
    // no tool records: that stays with the person
    expect(tools.some((tool) => /record/.test(tool.name))).toBe(false);
    for (const tool of tools) expect(tool.description, tool.name).toBeTruthy();
  });

  it("maps each tool's input to a command and options the CLI has", async () => {
    for (const tool of COMMAND_TOOLS) {
      const argv = tool.argv(everything(tool.input) as Record<string, never>);
      const words = argv.slice(0, argv[0] === 'motion' || argv[0] === 'music' || argv[0] === 'sound' || argv[0] === 'voice' || argv[0] === 'brand' ? 2 : 1);
      const help = await runCommand([...words, '--help']);
      const text = String((help.result as { output?: string }).output ?? JSON.stringify(help.result));
      expect(text, tool.name).toContain(`cuttle ${words.join(' ')}`);
      for (const flag of argv.filter((part) => part.startsWith('--'))) expect(new RegExp(`${flag}(?![\\w-])`).test(text), `${tool.name} ${flag}`).toBe(true);
    }
  });

  it('makes a project, writes and reads cuttle.json, adds a sound and a line of narration, and refuses a project that is not valid', async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-mcp-')), 'demo');
    dirs.push(project);
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = (result: CallToolResult) => (result.content[0] as { text: string }).text;
    expect((await call('init', { project })).isError).toBeFalsy();
    const read = JSON.parse(text(await call('read_project', { project }))) as { project: Record<string, unknown> };
    const scenes = [{ type: 'card', id: 'c1', title: 'Hello', duration: 3 }];
    const written = await call('write_project', { project, json: { ...read.project, scenes } });
    expect(written.isError).toBeFalsy();
    expect(JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')).scenes).toEqual(scenes);
    // a scene without its length: nothing written, the problem named
    const refused = await call('write_project', { project, json: { ...read.project, scenes: [{ type: 'card', title: 'x' }] } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('scenes[0].duration');
    expect(JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')).scenes).toEqual(scenes);
    // commands, through the tools
    expect(JSON.parse(text(await call('sound_add', { project, sound: 'whoosh', at: 0.5, scene: 'c1' }))).sound).toMatchObject({ sound: 'whoosh', at: 0.5, scene: 'c1' });
    expect((await call('voice_use', { project, id: 'en_US-amy-medium' })).isError).toBeFalsy();
    expect(JSON.parse(text(await call('voice_add', { project, text: 'Hello there', at: 0.2, scene: 'c1' }))).line).toMatchObject({ id: 'v1', text: 'Hello there' });
    const after = JSON.parse(text(await call('read_project', { project }))) as { project: { voiceover: unknown }; issues?: unknown };
    expect(after.issues).toBeUndefined();
    expect(after.project.voiceover).toEqual({ voice: { provider: 'local', id: 'en_US-amy-medium' }, lines: [{ id: 'v1', text: 'Hello there', at: 0.2, scene: 'c1' }] });
    // a command's failure is the tool's error, with the CLI's code
    const failed = await call('sound_add', { project, sound: 'nope', at: 0 });
    expect(failed.isError).toBe(true);
    expect(JSON.parse(text(failed)).error.code).toBe('usage');
    // the guides
    expect(text(await call('guide', { topic: 'project' }))).toContain('cuttle.json');
    expect(text(await call('guide', { topic: 'motion' })).length).toBeGreaterThan(1000);
  });

  it('reports progress while a command runs, as the CLI says it', async () => {
    const project = join(mkdtempSync(join(tmpdir(), 'cuttle-mcp-')), 'narrated');
    dirs.push(project);
    await client.callTool({ name: 'init', arguments: { project } });
    mkdirSync(join(project, 'audio'));
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-y', join(project, 'audio', 'line.wav')]);
    await client.callTool({ name: 'write_project', arguments: { project, json: { version: 1, sources: { screen: 'none.mp4' }, scenes: [{ type: 'card', id: 'c1', title: 'A', duration: 3 }] } } });
    await client.callTool({ name: 'voice_add', arguments: { project, text: 'one two', at: 0.5, scene: 'c1', file: 'audio/line.wav' } });
    const said: string[] = [];
    const result = (await client.callTool({ name: 'voice_render', arguments: { project } }, undefined, { onprogress: (progress) => said.push(progress.message ?? '') })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(said).toEqual(['speaking v1 (1 of 1) …']);
    expect(JSON.parse((result.content[0] as { text: string }).text).lines).toMatchObject([{ id: 'v1', spoken: true, at: 0.5 }]);
  });
});
