// The screenshot editor: the shot as it comes out (the engine draws it here, as the export does),
// its look beside it (the background, the window, the size), the library of shots on the left, and
// Copy, Save and drag it out on top. Each change goes into the shot's shot.json and shot.png as it is
// made, and the next screenshot takes this look.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { drawShot, loadEngineAssets, type ShotLayout } from '@cuttle/engine';
import { BACKGROUND_PRESETS, FRAME_STYLES, SOLID_DEFAULT, backgroundColors, isColouredBackground, parseShot, switchBackground, type BackgroundPreset, type FrameStyle, type Shot } from '@cuttle/project';
import type { ShotEntry, ShotView } from '../../shared/ipc';
import { BACKGROUND_NAMES, FRAME_NAMES } from '../../shared/names';
import { swatchStyle } from '../background-swatch';
import { bridge } from '../bridge';
import { CheckIcon, CopyIcon, ExportIcon, FolderIcon, ShotIcon, WarningIcon } from '../icons';
import { Select } from '../Select';

type Raw = Record<string, unknown>;
type Format = 'png' | 'jpeg' | 'webp';

/** The canvas's sizes: its own (pixel for pixel), ratios it grows to, pixels it is fitted into. */
const SIZES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Its own size' },
  { value: '16:9', label: '16:9 · X, YouTube' },
  { value: '1:1', label: '1:1 · square' },
  { value: '4:5', label: '4:5 · Instagram, LinkedIn' },
  { value: '9:16', label: '9:16 · stories' },
  { value: '1.91:1', label: '1.91:1 · link preview' },
  { value: '1200x630', label: '1200 × 630 · Open Graph' },
];
/** The output's pixels per point: '' for the shot's own (pixel for pixel). */
const SCALES = [
  { value: '', label: 'Pixel for pixel' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
];
/** Frame styles with a title bar that shows a title. */
const TITLED = new Set<FrameStyle>(['mac-dark', 'mac-light', 'browser-light', 'browser-dark', 'windows-light', 'windows-dark', 'terminal']);
/** A change waits this long for the next before it is written. */
const WRITE_MS = 350;

const sizeValue = (size: Shot['size']) => (typeof size === 'object' ? `${size.width}x${size.height}` : size);
const sizeOf = (value: string): Shot['size'] => {
  const pixels = /^(\d+)x(\d+)$/.exec(value);
  return pixels ? { width: Number(pixels[1]), height: Number(pixels[2]) } : value;
};
const bitmapOf = (bytes: Uint8Array) => createImageBitmap(new Blob([new Uint8Array(bytes)]), { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' });

/** Draws the shot into a canvas of its own: its pixels, in a format, or as a bitmap for the preview. */
function draw(shot: Shot, image: ImageBitmap, background: ImageBitmap | undefined, scale: number | undefined): { canvas: OffscreenCanvas; layout: ShotLayout; free: () => void } {
  const canvas = new OffscreenCanvas(1, 1);
  const layout = drawShot(canvas, shot, image, { ...(scale !== undefined && { scale }), ...(background && { backgroundImage: background }) });
  // a context a draw: free it now (browsers keep only a few)
  const free = () => (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  return { canvas, layout, free };
}

async function encode(shot: Shot, image: ImageBitmap, background: ImageBitmap | undefined, scale: number | undefined, format: Format): Promise<Uint8Array> {
  const { canvas, free } = draw(shot, image, background, scale);
  try {
    const blob = await canvas.convertToBlob({ type: `image/${format}`, ...(format !== 'png' && { quality: 0.92 }) });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    free();
  }
}

export function Shot() {
  const [view, setView] = useState<ShotView>();
  const [raw, setRaw] = useState<Raw>();
  const [image, setImage] = useState<ImageBitmap>();
  const [background, setBackground] = useState<ImageBitmap>();
  const [scale, setScale] = useState('');
  const [size, setSize] = useState<{ width: number; height: number; scale: number }>();
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' }>();
  const [library, setLibrary] = useState<(ShotEntry & { url?: string })[]>([]);
  const preview = useRef<HTMLCanvasElement>(null);
  const changed = useRef(false);
  const ready = useMemo(() => loadEngineAssets(), []);

  // the shot shown: the one the window opened on, a new one, one from the library
  const show = useCallback(async (next: ShotView) => {
    const [bitmap, behind] = await Promise.all([bitmapOf(next.image), next.backgroundImage ? bitmapOf(next.backgroundImage) : undefined]);
    changed.current = false;
    setView(next);
    setRaw(next.raw);
    setImage(bitmap);
    setBackground(behind);
    setNote(undefined);
  }, []);
  const loadLibrary = useCallback(async () => {
    const entries = await bridge.invoke('shot:library');
    setLibrary((before) => {
      for (const entry of before) if (entry.url) URL.revokeObjectURL(entry.url);
      return entries.map((entry) => ({ ...entry, ...(entry.thumb && { url: URL.createObjectURL(new Blob([new Uint8Array(entry.thumb)], { type: 'image/png' })) }) }));
    });
  }, []);
  useEffect(() => {
    void bridge.invoke('shot:view').then((first) => first && show(first));
    void loadLibrary();
    return bridge.on('shot:show', (next) => {
      void show(next);
      void loadLibrary();
    });
  }, [show, loadLibrary]);

  const parsed = useMemo(() => (raw ? parseShot(raw) : undefined), [raw]);
  const shot = parsed?.ok ? parsed.shot : undefined;
  const outScale = scale === '' ? undefined : Number(scale);

  // the preview: drawn whenever the shot changes, a frame after the change
  useEffect(() => {
    if (!shot || !image) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void ready.then(() => {
        if (cancelled) return;
        try {
          const { canvas, layout, free } = draw(shot, image, background, outScale);
          // copied before the context goes (its pictures go with it)
          const target = preview.current;
          if (target) {
            target.width = canvas.width;
            target.height = canvas.height;
            // a pixel of the shot on a pixel of the screen, made smaller to fit
            target.style.width = `${canvas.width / devicePixelRatio}px`;
            target.getContext('2d')?.drawImage(canvas, 0, 0);
          }
          free();
          setSize({ ...layout.output, scale: Math.round(layout.scale * 100) / 100 });
        } catch (error) {
          setNote({ text: (error as Error).message, tone: 'warn' });
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [shot, image, background, outScale, ready]);

  // each change written a moment later: shot.json, then its shot.png
  useEffect(() => {
    if (!raw || !changed.current || !shot || !image) return;
    const timer = setTimeout(() => {
      void (async () => {
        const answer = await bridge.invoke('shot:change', { raw });
        if (answer.issues) return setNote({ text: answer.issues.join('; '), tone: 'warn' });
        await bridge.invoke('shot:save', { data: await encode(shot, image, background, outScale, 'png'), format: 'png', as: false });
      })();
    }, WRITE_MS);
    return () => clearTimeout(timer);
  }, [raw, shot, image, background, outScale]);

  const change = (update: (before: Raw) => Raw) => {
    changed.current = true;
    setRaw((before) => (before ? update(before) : before));
  };
  const setField = (key: string, value: unknown) => change((before) => ({ ...before, [key]: value }));
  const setFrame = (key: string, value: unknown) => change((before) => ({ ...before, frame: { ...((before.frame as Raw | undefined) ?? {}), [key]: value } }));
  const setBackgroundField = (fields: Raw) => change((before) => ({ ...before, transparent: false, background: { ...((before.background as Raw | undefined) ?? { preset: 'sunset-sky' }), ...fields } }));

  const copy = useCallback(async () => {
    if (!shot || !image) return;
    await bridge.invoke('shot:copy', { png: await encode(shot, image, background, outScale, 'png') });
    setNote({ text: 'Copied', tone: 'ok' });
  }, [shot, image, background, outScale]);
  const save = useCallback(
    async (format: Format) => {
      if (!shot || !image) return;
      if (format === 'jpeg' && shot.transparent) return setNote({ text: 'A JPEG has no transparency: save it as PNG or WebP', tone: 'warn' });
      const where = await bridge.invoke('shot:save', { data: await encode(shot, image, background, outScale, format), format, as: true });
      if (where) setNote({ text: `Saved to ${where}`, tone: 'ok' });
    },
    [shot, image, background, outScale],
  );
  const chooseImage = async (kind: 'choose' | 'wallpaper') => {
    const chosen = await bridge.invoke('shot:background-image', kind);
    if (!chosen) return;
    setBackground(await bitmapOf(chosen.bytes));
    setBackgroundField({ preset: 'image', image: chosen.image, ...(kind === 'wallpaper' && { blur: 0.6 }) });
  };

  // Ctrl or ⌘: C copies, S saves a PNG, N takes a new screenshot (not while typing)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const key = event.key.toLowerCase();
      if (key === 'c' && !typing && !window.getSelection()?.toString()) {
        event.preventDefault();
        void copy();
      } else if (key === 's') {
        event.preventDefault();
        void save('png');
      } else if (key === 'n') {
        event.preventDefault();
        void bridge.invoke('shot:new');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copy, save]);

  if (!view || !raw) return <div className="shot-app loading" />;
  const look = shot;
  const preset = look?.background.preset ?? 'sunset-sky';
  return (
    <div className="shot-app" data-testid="shot-editor">
      <header className="shot-bar">
        <span className="shot-title">
          <ShotIcon size={15} />
          <b>Screenshot</b>
          <span>{view.name}</span>
        </span>
        <div className="shot-actions">
          <button type="button" className="ghost" onClick={() => void bridge.invoke('shot:new')} title="A new screenshot (Ctrl+N)" data-testid="shot-new">
            <ShotIcon size={14} />
            New
          </button>
          <button type="button" className="ghost icon" onClick={() => void bridge.invoke('shot:reveal')} title="Show in folder" aria-label="Show in folder">
            <FolderIcon size={15} />
          </button>
          <Select
            value={undefined}
            options={[
              { value: 'png', label: 'Save as PNG…' },
              { value: 'jpeg', label: 'Save as JPEG…', disabled: look?.transparent === true },
              { value: 'webp', label: 'Save as WebP…' },
            ]}
            onChange={(format) => void save(format as Format)}
            label="Save"
            variant="compact"
            className="shot-save"
            testId="shot-save"
          >
            <ExportIcon size={14} /> Save
          </Select>
          <button type="button" className="primary" onClick={() => void copy()} title="Copy the screenshot (Ctrl+C)" data-testid="shot-copy">
            <CopyIcon size={14} />
            Copy
          </button>
        </div>
      </header>
      <aside className="shot-library" aria-label="Screenshots">
        {library.map((entry) => (
          <button key={entry.dir} type="button" className="shot-thumb" aria-current={entry.dir === view.dir} title={entry.name} onClick={() => void bridge.invoke('shot:open', { dir: entry.dir })}>
            {entry.url ? <img src={entry.url} alt="" draggable={false} /> : <i />}
            <span>{entry.name}</span>
          </button>
        ))}
      </aside>
      <main className={`shot-stage${look?.transparent ? ' transparent' : ''}`}>
        <div
          className="shot-picture"
          draggable
          onDragStart={(event) => {
            event.preventDefault();
            void bridge.invoke('shot:drag');
          }}
          title="Drag it into a chat, a mail or a document"
        >
          <canvas ref={preview} data-testid="shot-preview" />
        </div>
        <footer className="shot-foot">
          {size && (
            <span data-testid="shot-size">
              {size.width} × {size.height} px · {size.scale}× a point
            </span>
          )}
          {note && (
            <span className={`shot-note ${note.tone}`} role="status">
              {note.tone === 'ok' ? <CheckIcon size={13} /> : <WarningIcon size={13} />}
              {note.text}
            </span>
          )}
        </footer>
      </main>
      <section className="shot-inspector" aria-label="The screenshot's look">
        <Part title="Background">
          <div className="swatches" role="group" aria-label="Background">
            <button type="button" className="swatch-button bg-none" aria-pressed={look?.transparent === true} title="Nothing: the shot and its shadow on transparency" onClick={() => setField('transparent', true)} data-testid="shot-bg-none">
              <span>None</span>
            </button>
            {BACKGROUND_PRESETS.map((each) => (
              <button
                key={each}
                type="button"
                className={`swatch-button bg-${each}`}
                aria-pressed={!look?.transparent && preset === each}
                title={BACKGROUND_NAMES[each]}
                style={look ? swatchStyle(look.background, each) : undefined}
                onClick={() => (each === 'image' ? void chooseImage('choose') : setBackgroundField({ ...switchBackground((raw.background as Raw | undefined) ?? { preset: 'sunset-sky' }, each), preset: each }))}
                data-testid={`shot-bg-${each}`}
              >
                <span>{BACKGROUND_NAMES[each]}</span>
              </button>
            ))}
          </div>
          {!look?.transparent && preset === 'solid' && (
            <Field label="Colour">
              <input type="color" value={look?.background.color ?? SOLID_DEFAULT} onChange={(event) => setBackgroundField({ color: event.target.value })} aria-label="Background colour" />
            </Field>
          )}
          {!look?.transparent && isColouredBackground(preset as BackgroundPreset) && look && (
            <Field label="Colours">
              <span className="shot-colors">
                {backgroundColors(look.background).map((colour, i) => (
                  <input
                    key={i}
                    type="color"
                    value={colour}
                    aria-label={`Colour ${i + 1}`}
                    onChange={(event) => setBackgroundField({ colors: backgroundColors(look.background).map((each, j) => (j === i ? event.target.value : each)) })}
                  />
                ))}
                <button type="button" className="ghost small" onClick={() => void bridge.invoke('shot:palette').then((colors) => colors.length >= 2 && setBackgroundField({ colors: colors.slice(0, 4) }))} data-testid="shot-colors-from">
                  From the shot
                </button>
              </span>
            </Field>
          )}
          {!look?.transparent && preset === 'image' && (
            <>
              <Field label="Image">
                <span className="shot-colors">
                  <button type="button" className="ghost small" onClick={() => void chooseImage('choose')}>
                    Choose…
                  </button>
                  <button type="button" className="ghost small" onClick={() => void chooseImage('wallpaper')}>
                    Wallpaper
                  </button>
                </span>
              </Field>
              <Field label="Soft">
                <Range value={Math.round((look?.background.blur ?? 0) * 100)} max={100} label="How soft the image is" onChange={(value) => setBackgroundField({ blur: value / 100 })} />
              </Field>
              <Field label="Darker">
                <Range value={Math.round((look?.background.dim ?? 0) * 100)} max={80} label="How much darker the image is" onChange={(value) => setBackgroundField({ dim: value / 100 })} />
              </Field>
            </>
          )}
        </Part>
        <Part title="Window">
          <Field label="Frame">
            <Select
              value={look?.frame.style ?? 'none'}
              options={[...FRAME_STYLES].reverse().map((style) => ({ value: style, label: style === 'none' ? 'None: the shot, rounded' : FRAME_NAMES[style] }))}
              onChange={(style) => setFrame('style', style)}
              label="Frame"
              testId="shot-frame"
            />
          </Field>
          {look && TITLED.has(look.frame.style) && (
            <Field label="Title">
              <input type="text" defaultValue={look.frame.title} key={`${view.dir}:${look.frame.style}`} placeholder={look.frame.style.startsWith('browser') ? 'example.com' : 'A title'} onChange={(event) => setFrame('title', event.target.value)} aria-label="Title" />
            </Field>
          )}
          {look && !FRAME_DEVICES.has(look.frame.style) && (
            <Field label="Corners">
              <Range value={look.frame.radius} max={40} label="Corner radius" onChange={(value) => setFrame('radius', value)} />
            </Field>
          )}
          <Field label="Shadow">
            <input type="checkbox" checked={look?.frame.shadow ?? true} onChange={(event) => setFrame('shadow', event.target.checked)} aria-label="Shadow" data-testid="shot-shadow" />
          </Field>
        </Part>
        <Part title="Size">
          <Field label="Padding">
            <Range value={look?.padding ?? 64} max={240} label="Padding" onChange={(value) => setField('padding', value)} testId="shot-padding" />
          </Field>
          <Field label="Canvas">
            <Select value={sizeValue(look?.size ?? 'auto')} options={SIZES} onChange={(value) => setField('size', sizeOf(value))} label="Canvas size" testId="shot-size-select" />
          </Field>
          <Field label="Scale">
            <Select value={scale} options={SCALES} onChange={setScale} label="Scale" />
          </Field>
        </Part>
      </section>
    </div>
  );
}

const FRAME_DEVICES = new Set<FrameStyle>(['iphone', 'android']);

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="shot-part">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="shot-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Range({ value, max, label, onChange, testId }: { value: number; max: number; label: string; onChange: (value: number) => void; testId?: string }) {
  return (
    <span className="shot-range">
      <input type="range" min={0} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} data-testid={testId} />
      <output>{value}</output>
    </span>
  );
}
