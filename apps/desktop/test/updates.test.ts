import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createUpdates, failureOf, type Updater } from '../src/main/update-state';

/** An updater whose check and download do what the test says, and say it as electron-updater does. */
class FakeUpdater implements Updater {
  private readonly listeners = new Map<string, ((...args: never[]) => void)[]>();
  on(event: string, listener: (...args: never[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...values: unknown[]) => void)(...args);
  }
  check: () => void = () => this.emit('update-not-available', {});
  fetch: () => void = () => {};
  quitAndInstall = vi.fn();
  checkForUpdates() {
    return Promise.resolve().then(() => this.check());
  }
  downloadUpdate() {
    return Promise.resolve().then(() => this.fetch());
  }
}

const base = { version: '0.1.1', supported: true, autoDownload: true };
const at = () => 1_000;

describe('updates', () => {
  it('finds nothing newer: the newest version, when it looked', async () => {
    const updates = createUpdates(new FakeUpdater(), base, at);
    expect(updates.status()).toEqual({ version: '0.1.1', supported: true, state: 'idle' });
    expect(await updates.check()).toEqual({ version: '0.1.1', supported: true, state: 'current', checked: 1_000 });
  });

  it('finds a version, downloads it by itself with progress, and installs it when asked', async () => {
    const updater = new FakeUpdater();
    updater.check = () => updater.emit('update-available', { version: '0.1.2' });
    const updates = createUpdates(updater, base, at);
    const seen: string[] = [];
    updates.onStatus((status) => seen.push(status.state));
    expect(updates.install()).toBe(false);
    await updates.check();
    expect(updates.status()).toMatchObject({ state: 'downloading', next: '0.1.2' });
    updater.emit('download-progress', { transferred: 40, total: 100 });
    expect(updates.status()).toMatchObject({ state: 'downloading', download: { received: 40, total: 100 } });
    // no second check while it downloads
    expect(await updates.check()).toBe(updates.status());
    updater.emit('update-downloaded', { version: '0.1.2' });
    expect(updates.status()).toEqual({ version: '0.1.1', supported: true, state: 'ready', next: '0.1.2', checked: 1_000 });
    expect(updates.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(seen).toEqual(['checking', 'downloading', 'downloading', 'ready']);
  });

  it('downloads only when asked where the updater does not by itself, and can try again', async () => {
    const updater = new FakeUpdater();
    updater.check = () => updater.emit('update-available', { version: '0.2.0' });
    updater.fetch = () => updater.emit('error', new Error('net::ERR_CONNECTION_RESET\n    at …'));
    const updates = createUpdates(updater, { ...base, autoDownload: false }, at);
    await updates.check();
    expect(updates.status()).toMatchObject({ state: 'available', next: '0.2.0' });
    await updates.download();
    expect(updates.status()).toMatchObject({ state: 'failed', next: '0.2.0', failure: 'net::ERR_CONNECTION_RESET' });
    updater.fetch = () => updater.emit('update-downloaded', { version: '0.2.0' });
    await updates.download();
    expect(updates.status()).toMatchObject({ state: 'ready', next: '0.2.0' });
  });

  it('says why a check failed, in a line; a repository without a release yet has nothing newer', async () => {
    const updater = new FakeUpdater();
    updater.check = () => {
      updater.emit('error', new Error('getaddrinfo ENOTFOUND api.github.com'));
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    };
    const updates = createUpdates(updater, base, at);
    expect(await updates.check()).toMatchObject({ state: 'failed', failure: 'getaddrinfo ENOTFOUND api.github.com' });
    // a rejection without an event counts too
    updater.check = () => {
      throw new Error('Unable to find latest version on GitHub (https://github.com/o/r/releases/latest), please ensure a production release exists');
    };
    expect(await updates.check()).toMatchObject({ state: 'current', checked: 1_000 });
    expect(failureOf(new Error(`HttpError: 500\n${'x'.repeat(400)}`))).toEqual({ message: 'HttpError: 500' });
    // another server's 404 is a failure (its feed is missing), and says so
    expect(failureOf(new Error('HttpError: 404 \n"method: GET url: http://127.0.0.1/updates/latest.yml"'))).toEqual({ message: 'HttpError: 404' });
    expect(failureOf('a'.repeat(200))).toEqual({ message: `${'a'.repeat(157)}…` });
  });

  it('does nothing where the app cannot update (run from the repository)', async () => {
    const updater = new FakeUpdater();
    const check = vi.spyOn(updater, 'checkForUpdates');
    const updates = createUpdates(updater, { ...base, supported: false }, at);
    expect(await updates.check()).toEqual({ version: '0.1.1', supported: false, state: 'idle' });
    expect(check).not.toHaveBeenCalled();
  });
});

describe('the release', () => {
  it("names one version for the app and the cuttle command, and the releases' page of package.json's repository", async () => {
    const desktop = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const cli = readFileSync(new URL('../../cli/src/main.ts', import.meta.url), 'utf8');
    expect(cli).toContain(`export const VERSION = '${desktop.version}';`);
    const { RELEASES, APP_UPDATE_YML } = await import('../scripts/releases.mjs');
    expect(RELEASES).toEqual({ owner: 'lennystepn-hue', repo: 'cuttle-ai-screen-recorder' });
    expect(APP_UPDATE_YML).toBe('provider: github\nowner: lennystepn-hue\nrepo: cuttle-ai-screen-recorder\nupdaterCacheDirName: cuttle-updater\n');
    expect(readFileSync(new URL('../src/main/updates.ts', import.meta.url), 'utf8')).toContain(`'https://github.com/${RELEASES.owner}/${RELEASES.repo}/releases'`);
  });
});
