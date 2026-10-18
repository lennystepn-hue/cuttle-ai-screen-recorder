// `cuttle music check`: the project's music and sounds rendered alone (no frames), written as a WAV
// to listen to, and measured for whoever cannot listen: the loudness (LUFS, true peak), each part's
// level, whether a hit lands on each scene change, and a sheet of the waveforms over the scenes.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { BrowserWindow, app } from 'electron';
import { AUDIO_SAMPLE_RATE } from '../audio';
import { ExportError } from '../errors';
import { ffmpegPath } from './ffmpeg';
import { soundtrackReport, type SoundtrackReport } from './export';
import { motionTake, loadSources } from './sources';
import { duckEnvelope, planSoundtrack, renderSoundtrack, writeSoundTrack } from './soundtrack';

export interface MusicCheckOptions {
  projectDir: string;
  /** The WAV to write (the music and sounds, no mic). */
  out: string;
  /** The sheet to draw (PNG). */
  sheet?: string;
  /** A page to check in place of the project's `music.src`. */
  src?: string;
}

export interface MusicCheckPart {
  name: string;
  start: number;
  end: number;
  energy?: number;
  /** The music's level (RMS dBFS, after its volume and the duck) and the effects'. */
  musicDb: number;
  effectsDb: number;
}

export interface MusicCheckResult extends SoundtrackReport {
  out: string;
  sheet?: string;
  seconds: number;
  /** Integrated loudness and true peak of the music and sounds alone. */
  loudness: { lufs: number | null; truePeak: number | null };
  /** The page's sections (or the video's scenes) with their levels. */
  parts: MusicCheckPart[];
  /** Each scene change (not a jump cut), and whether the sound gets louder on it (a hit). */
  cuts: { t: number; hit: boolean; riseDb: number }[];
}

const db = (rms: number) => (rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -120);

/** RMS of an interleaved stereo stem from `from` to `to` seconds, each sample scaled by `gain(t)`. */
function rms(stem: Float32Array, from: number, to: number, gain: (t: number) => number = () => 1): number {
  const a = Math.max(0, Math.floor(from * AUDIO_SAMPLE_RATE));
  const b = Math.min(stem.length / 2, Math.floor(to * AUDIO_SAMPLE_RATE));
  if (b <= a) return 0;
  let sum = 0;
  let g = 1;
  for (let i = a; i < b; i++) {
    if ((i - a) % 256 === 0) g = gain(i / AUDIO_SAMPLE_RATE);
    const l = stem[i * 2]! * g;
    const r = stem[i * 2 + 1]! * g;
    sum += (l * l + r * r) / 2;
  }
  return Math.sqrt(sum / (b - a));
}

/** Integrated loudness and true peak by ffmpeg's EBU R128 meter. */
async function loudness(wav: string): Promise<{ lufs: number | null; truePeak: number | null }> {
  const text = await new Promise<string>((done) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('close', () => done(err));
    child.on('error', () => done(''));
  });
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1];
  return { lufs: lufs ? Number(lufs) : null, truePeak: peak ? Number(peak) : null };
}

/** The sheet's page: the stems' waveforms over the scenes, the speech, the cuts and their hits. */
function sheetHtml(data: unknown): string {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:#101014"><canvas id="c" width="1600" height="900"></canvas><script>
const d = ${JSON.stringify(data)};
const c = document.getElementById('c').getContext('2d');
const W = 1600, L = 40, R = 1560, x = (t) => L + (t / d.seconds) * (R - L);
c.fillStyle = '#101014'; c.fillRect(0, 0, W, 900);
c.font = '600 22px Segoe UI, sans-serif'; c.fillStyle = '#f2f2f5';
c.fillText(d.title, L, 42);
c.font = '15px Segoe UI, sans-serif'; c.fillStyle = '#9a9aa6';
c.fillText(d.subtitle, L, 68);
const lanes = [{ name: 'music (after its volume and the duck)', y: 120, h: 300, peaks: d.music, color: '#d97757' }, { name: 'effects', y: 470, h: 220, peaks: d.effects, color: '#7ec8e3' }];
// the parts, as bands
d.parts.forEach((p, i) => {
  c.fillStyle = i % 2 ? '#17171d' : '#1d1d25';
  c.fillRect(x(p.start), 100, x(p.end) - x(p.start), 610);
  c.fillStyle = '#c9c9d6'; c.font = '600 14px Segoe UI, sans-serif';
  c.fillText(p.name + (p.energy !== undefined ? ' · ' + p.energy : ''), x(p.start) + 6, 116);
  c.fillStyle = '#7d7d8a'; c.font = '12px Segoe UI, sans-serif';
  c.fillText(p.musicDb + ' dB', x(p.start) + 6, 412);
});
// speech
c.fillStyle = 'rgba(126, 224, 165, 0.16)';
for (const s of d.speech) c.fillRect(x(s.start), 720, Math.max(1, x(s.end) - x(s.start)), 18);
c.fillStyle = '#7ee0a5'; c.font = '12px Segoe UI, sans-serif'; c.fillText('speech', L, 754);
for (const lane of lanes) {
  const mid = lane.y + lane.h / 2;
  c.strokeStyle = '#2a2a33'; c.beginPath(); c.moveTo(L, mid); c.lineTo(R, mid); c.stroke();
  c.fillStyle = lane.color;
  lane.peaks.forEach(([lo, hi], i) => {
    const px = L + i;
    c.fillRect(px, mid - hi * lane.h / 2, 1, Math.max(1, (hi - lo) * lane.h / 2));
  });
  c.fillStyle = '#9a9aa6'; c.font = '12px Segoe UI, sans-serif'; c.fillText(lane.name, L, lane.y + lane.h + 14);
}
// the cuts and whether they hit
for (const cut of d.cuts) {
  c.strokeStyle = cut.hit ? '#7ee0a5' : '#ff6b6b'; c.lineWidth = 2; c.setLineDash([5, 4]);
  c.beginPath(); c.moveTo(x(cut.t), 100); c.lineTo(x(cut.t), 710); c.stroke(); c.setLineDash([]);
  c.fillStyle = cut.hit ? '#7ee0a5' : '#ff6b6b'; c.font = '11px Segoe UI, sans-serif';
  c.fillText((cut.hit ? 'hit ' : 'no hit ') + cut.riseDb + ' dB', x(cut.t) + 3, 704);
}
// seconds
c.fillStyle = '#7d7d8a'; c.font = '12px Segoe UI, sans-serif';
const step = d.seconds > 120 ? 10 : 5;
for (let t = 0; t <= d.seconds; t += step) { c.fillRect(x(t), 770, 1, 8); c.fillText(t + ' s', x(t) - 8, 795); }
window.done = true;
</script>`;
}

/** Min and max of a stem in each of `columns` columns (mono: the louder ear), scaled by `gain(t)`. */
function columnsOf(stem: Float32Array, columns: number, gain: (t: number) => number = () => 1): [number, number][] {
  const frames = stem.length / 2;
  const out: [number, number][] = [];
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c * frames) / columns);
    const b = Math.max(a + 1, Math.floor(((c + 1) * frames) / columns));
    let lo = 0;
    let hi = 0;
    const g = gain(a / AUDIO_SAMPLE_RATE);
    for (let i = a; i < b && i < frames; i++) {
      const v = (Math.abs(stem[i * 2]!) > Math.abs(stem[i * 2 + 1]!) ? stem[i * 2]! : stem[i * 2 + 1]!) * g;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out.push([Math.max(-1, lo), Math.min(1, hi)]);
  }
  return out;
}

/** Draws the sheet in a hidden window and writes it as a PNG. */
async function drawSheet(path: string, data: unknown): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 1600, height: 900, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: true } });
  try {
    await win.loadURL(`data:text/html;base64,${Buffer.from(sheetHtml(data)).toString('base64')}`);
    for (let i = 0; i < 50 && !(await win.webContents.executeJavaScript('window.done === true')); i++) await new Promise((done) => setTimeout(done, 50));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 900 });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, image.resize({ width: 1600, height: 900 }).toPNG());
  } finally {
    win.destroy();
  }
}

export async function checkMusic(options: MusicCheckOptions): Promise<MusicCheckResult> {
  await app.whenReady();
  const projectDir = resolve(options.projectDir);
  const sources = await loadSources(projectDir);
  let project = sources.project;
  if (options.src) project = { ...project, music: { volume: 0.8, duck: 12, network: false, params: {}, ...project.music, src: options.src, enabled: true } };
  const inputs = sources.motionTake ?? (await motionTake(projectDir, project));
  const plan = await planSoundtrack(projectDir, project, inputs);
  if (!plan) {
    const why = !project.look.audio.enabled ? 'the audio is off (look.audio.enabled)' : 'the project has no music and no sounds: add some with "cuttle music new" or "cuttle sound add"';
    throw new ExportError('invalid-project', why);
  }
  const stems = await renderSoundtrack(projectDir, plan);
  const report = soundtrackReport(projectDir, plan, stems);
  const seconds = plan.video.duration;
  const music = project.music?.enabled ? project.music : undefined;
  const volume = music?.volume ?? 0;
  const duck = duckEnvelope(plan.video.speech, music?.duck ?? 0);
  const musicGain = (t: number) => volume * duck(t);
  const effectsVolume = project.look.audio.effects ? project.look.audio.effectsVolume : 0;
  const out = resolve(options.out);
  await mkdir(dirname(out), { recursive: true });
  await writeSoundTrack(out, { seconds, stems, ...(music && { music: { volume: music.volume, duck: music.duck } }), speech: plan.video.speech, effectsVolume });

  // the page's own sections (what it says is checked), else the scenes
  const told = (Array.isArray(report.info?.sections) ? report.info.sections : [])
    .filter((part) => typeof part?.start === 'number' && typeof part.end === 'number' && part.end > part.start)
    .map((part) => ({ start: part.start, end: part.end, name: String(part.name ?? ''), ...(typeof part.energy === 'number' && { energy: part.energy }) }));
  const sections: { start: number; end: number; name: string; energy?: number }[] =
    told.length > 0 ? told : plan.video.scenes.map((scene) => ({ start: scene.start, end: scene.end, name: scene.label ?? scene.type }));
  const parts: MusicCheckPart[] = sections.map((part) => ({
    name: part.name,
    start: part.start,
    end: part.end,
    ...(part.energy !== undefined && { energy: part.energy }),
    musicDb: db(rms(stems.music, part.start, part.end, musicGain)),
    effectsDb: db(rms(stems.effects, part.start, part.end, () => effectsVolume)),
  }));
  // a hit: the 60 ms after the cut are clearly louder than the second before it (a riser's last 0.3 s left out)
  const both = new Float32Array(stems.music.length);
  let gain = 0;
  for (let i = 0; i < both.length; i++) {
    if (i % 512 === 0) gain = musicGain(i / 2 / AUDIO_SAMPLE_RATE);
    both[i] = stems.music[i]! * gain + stems.effects[i]! * effectsVolume;
  }
  const cuts = plan.video.cuts
    .filter((cut) => !cut.jump)
    .map((cut) => {
      const rise = db(rms(both, cut.t, cut.t + 0.06)) - db(rms(both, Math.max(0, cut.t - 1.3), cut.t - 0.3));
      return { t: cut.t, hit: rise >= 4, riseDb: Math.round(rise * 10) / 10 };
    });
  const level = await loudness(out);
  const sheet = options.sheet ? resolve(options.sheet) : undefined;
  if (sheet) {
    const info = report.info;
    await drawSheet(sheet, {
      title: `${report.src ?? 'the sounds'}${info?.bpm ? ` · ${info.bpm} BPM` : ''}${info?.key ? ` · ${info.key}` : ''}`,
      subtitle: `${seconds.toFixed(1)} s · ${level.lufs ?? '?'} LUFS · true peak ${level.truePeak ?? '?'} dBFS · ${cuts.filter((cut) => cut.hit).length} of ${cuts.length} scene changes hit · ${report.errors.length} errors`,
      seconds,
      parts,
      cuts,
      speech: plan.video.speech,
      music: columnsOf(stems.music, 1520, musicGain),
      effects: columnsOf(stems.effects, 1520, () => effectsVolume),
    });
  }
  return { ...report, out, ...(sheet && { sheet }), seconds, loudness: level, parts, cuts };
}
