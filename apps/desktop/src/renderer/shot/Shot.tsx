// The screenshot editor: the shot as it comes out (the engine draws it here, as the export does),
// its look beside it (a brand kit or a style, the background, the window, the size and where the shot
// sits, a headline, masks over what is private, a watermark), the library of shots on the left, and
// Copy, Save and drag it out on top. Each change goes into the shot's shot.json and shot.png as it is
// made, and the next screenshot takes this look.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { drawShot, loadEngineAssets, loadHeadingFont, type ShotLayout } from '@cuttle/engine';
import { svgBitmap } from '@cuttle/export/svg';
import { BACKGROUND_PRESETS, FRAME_STYLES, SHOT_ALIGNS, SOLID_DEFAULT, THEME_FONTS, WEBCAM_CORNERS, backgroundColors, isColouredBackground, parseShot, switchBackground, type BackgroundPreset, type FrameStyle, type Shot } from '@cuttle/project';
import type { ShotEntry, ShotLookAnswer, ShotView } from '../../shared/ipc';
import { BACKGROUND_NAMES, CORNER_NAMES, FRAME_NAMES } from '../../shared/names';
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
  { value: '1500x500', label: '1500 × 500 · X header' },
  { value: '1290x2796', label: '1290 × 2796 · App Store, iPhone' },
  { value: '2880x1800', label: '2880 × 1800 · Mac App Store' },
];
/** What each heading font is like, beside its name in the list. */
const FONT_NOTES: Record<(typeof THEME_FONTS)[number], string> = { Archivo: 'bold grotesque', Inter: 'plain and clear', 'Space Grotesk': 'geometric', Fraunces: 'display serif', 'Instrument Serif': 'light serif', 'Bebas Neue': 'tall capitals' };
const ALIGN_NAMES: Record<(typeof SHOT_ALIGNS)[number], string> = { center: 'In the middle', top: 'At the top', bottom: 'At the bottom', left: 'On the left', right: 'On the right' };
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
// an SVG (a brand's logo) is no image createImageBitmap reads: an image draws it
const bitmapOf = (bytes: Uint8Array) => createImageBitmap(new Blob([new Uint8Array(bytes)]), { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' }).catch((error: unknown) => svgBitmap(new Uint8Array(bytes)).catch(() => Promise.reject(error)));

/** The pictures a shot is drawn from: its image, and a background's and a watermark's when it has them. */
interface Pictures {
  image: ImageBitmap;
  background?: ImageBitmap;
  logo?: ImageBitmap;
}

/** Draws the shot into a canvas of its own: its pixels, in a format, or as a bitmap for the preview. */
function draw(shot: Shot, pictures: Pictures, scale: number | undefined): { canvas: OffscreenCanvas; layout: ShotLayout; free: () => void } {
  const canvas = new OffscreenCanvas(1, 1);
  const layout = drawShot(canvas, shot, pictures.image, { ...(scale !== undefined && { scale }), ...(pictures.background && { backgroundImage: pictures.background }), ...(pictures.logo && { watermarkImage: pictures.logo }) });
  // a context a draw: free it now (browsers keep only a few)
  const free = () => (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  return { canvas, layout, free };
}

async function encode(shot: Shot, pictures: Pictures, scale: number | undefined, format: Format): Promise<Uint8Array> {
  await loadHeadingFont(shot.font);
  const { canvas, free } = draw(shot, pictures, scale);
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
  const [logo, setLogo] = useState<ImageBitmap>();
  const pictures = useMemo(() => (image ? { image, ...(background && { background }), ...(logo && { logo }) } : undefined), [image, background, logo]);
  const [brands, setBrands] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [styleName, setStyleName] = useState('');
  const [reading, setReading] = useState(false);
  const [scale, setScale] = useState('');
  const [size, setSize] = useState<{ width: number; height: number; scale: number }>();
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' }>();
  const [library, setLibrary] = useState<(ShotEntry & { url?: string })[]>([]);
  const preview = useRef<HTMLCanvasElement>(null);
  const changed = useRef(false);
  const ready = useMemo(() => loadEngineAssets(), []);

  // the shot shown: the one the window opened on, a new one, one from the library
  const show = useCallback(async (next: ShotView) => {
    const [bitmap, behind, mark] = await Promise.all([bitmapOf(next.image), next.backgroundImage ? bitmapOf(next.backgroundImage) : undefined, next.watermarkImage ? bitmapOf(next.watermarkImage) : undefined]);
    // the kits and the styles as they are now (one may have been made meanwhile)
    void bridge.invoke('shot:brands').then(setBrands);
    void bridge.invoke('shot:styles').then(setStyles);
    changed.current = false;
    setView(next);
    setRaw(next.raw);
    setImage(bitmap);
    setBackground(behind);
    setLogo(mark);
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
    if (!shot || !pictures) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void Promise.all([ready, loadHeadingFont(shot.font)]).then(() => {
        if (cancelled) return;
        try {
          const { canvas, layout, free } = draw(shot, pictures, outScale);
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
  }, [shot, pictures, outScale, ready]);

  // each change written a moment later: shot.json, then its shot.png
  useEffect(() => {
    if (!raw || !changed.current || !shot || !pictures) return;
    const timer = setTimeout(() => {
      void (async () => {
        const answer = await bridge.invoke('shot:change', { raw });
        if (answer.issues) return setNote({ text: answer.issues.join('; '), tone: 'warn' });
        await bridge.invoke('shot:save', { data: await encode(shot, pictures, outScale, 'png'), format: 'png', as: false });
      })();
    }, WRITE_MS);
    return () => clearTimeout(timer);
  }, [raw, shot, pictures, outScale]);

  const change = (update: (before: Raw) => Raw) => {
    changed.current = true;
    setRaw((before) => (before ? update(before) : before));
  };
  const setField = (key: string, value: unknown) => change((before) => ({ ...before, [key]: value }));
  const setFrame = (key: string, value: unknown) => change((before) => ({ ...before, frame: { ...((before.frame as Raw | undefined) ?? {}), [key]: value } }));
  const setBackgroundField = (fields: Raw) => change((before) => ({ ...before, transparent: false, background: { ...((before.background as Raw | undefined) ?? { preset: 'sunset-sky' }), ...fields } }));

  const copy = useCallback(async () => {
    if (!shot || !pictures) return;
    await bridge.invoke('shot:copy', { png: await encode(shot, pictures, outScale, 'png') });
    setNote({ text: 'Copied', tone: 'ok' });
  }, [shot, pictures, outScale]);
  const save = useCallback(
    async (format: Format) => {
      if (!shot || !pictures) return;
      if (format === 'jpeg' && shot.transparent) return setNote({ text: 'A JPEG has no transparency: save it as PNG or WebP', tone: 'warn' });
      const where = await bridge.invoke('shot:save', { data: await encode(shot, pictures, outScale, format), format, as: true });
      if (where) setNote({ text: `Saved to ${where}`, tone: 'ok' });
    },
    [shot, pictures, outScale],
  );
  /** A brand kit's or a style's look over the shot's: its fields, and the pictures they name. */
  const takeLook = async (answer: ShotLookAnswer, from: 'brand' | 'style') => {
    const { fields } = answer;
    if (answer.backgroundImage) setBackground(await bitmapOf(answer.backgroundImage));
    // a kit without a logo or a name keeps the shot's watermark; a style brings its own, or none
    if (from === 'style' || fields.watermark) setLogo(answer.watermarkImage ? await bitmapOf(answer.watermarkImage) : undefined);
    change((before) =>
      from === 'brand'
        ? { ...before, transparent: false, background: fields.background, frame: { ...((before.frame as Raw | undefined) ?? {}), ...(fields.frame as Raw) }, font: fields.font, ...(fields.watermark ? { watermark: fields.watermark } : {}) }
        : { version: before.version, source: before.source, ...(before.scale !== undefined && { scale: before.scale }), ...(before.crop !== undefined && { crop: before.crop }), ...(before.masks !== undefined && { masks: before.masks }), ...(before.headline !== undefined && { headline: before.headline }), ...fields },
    );
    setNote({ text: from === 'brand' ? 'The brand kit is on' : 'The style is on', tone: 'ok' });
  };
  /** Masks over what the shot's text shows that is private, read on this computer (those found before go). */
  const redact = async () => {
    setReading(true);
    try {
      const { masks } = await bridge.invoke('shot:redact');
      change((before) => ({ ...before, masks: [...((before.masks as Raw[] | undefined) ?? []).filter((mask) => mask.auto !== 'privacy'), ...masks] }));
      setNote({ text: masks.length === 0 ? 'Nothing private found: still look yourself' : `${masks.length} private ${masks.length === 1 ? 'thing' : 'things'} masked: still look yourself`, tone: masks.length === 0 ? 'ok' : 'warn' });
    } catch (error) {
      setNote({ text: `The text could not be read: ${(error as Error).message}`, tone: 'warn' });
    } finally {
      setReading(false);
    }
  };
  /** A kit or a style put on, or what kept it from that (one removed meanwhile). */
  const putOn = (from: 'brand' | 'style', name: string) =>
    void (from === 'brand' ? bridge.invoke('shot:brand', { name }) : bridge.invoke('shot:style', { name }))
      .then((answer) => takeLook(answer, from))
      .catch((error: Error) => setNote({ text: error.message, tone: 'warn' }));
  const saveStyle = async () => {
    const name = styleName.trim();
    if (!name) return;
    try {
      await bridge.invoke('shot:style-save', { name });
    } catch (error) {
      return setNote({ text: (error as Error).message, tone: 'warn' });
    }
    setStyles(await bridge.invoke('shot:styles'));
    setStyleName('');
    setNote({ text: `Saved as the style “${name}”`, tone: 'ok' });
  };
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
        <Part title="Brand and style">
          <Field label="Brand">
            <Select
              value={undefined}
              placeholder={brands.length === 0 ? 'No brand kits yet' : 'Choose a kit…'}
              disabled={brands.length === 0}
              options={brands.map((name) => ({ value: name, label: name }))}
              onChange={(name) => putOn('brand', name)}
              label="Brand kit"
              testId="shot-brand"
            />
          </Field>
          <Field label="Style">
            <Select
              value={undefined}
              placeholder={styles.length === 0 ? 'No styles yet' : 'Choose a style…'}
              disabled={styles.length === 0}
              options={styles.map((name) => ({ value: name, label: name }))}
              onChange={(name) => putOn('style', name)}
              label="Style"
              testId="shot-style"
            />
          </Field>
          <Field label="Keep as">
            <span className="shot-colors">
              <input type="text" value={styleName} placeholder="A name for this look" maxLength={80} onChange={(event) => setStyleName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void saveStyle()} aria-label="Style name" data-testid="shot-style-name" />
              <button type="button" className="ghost small" disabled={!styleName.trim()} onClick={() => void saveStyle()} data-testid="shot-style-save">
                Save
              </button>
            </span>
          </Field>
        </Part>
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
          {look && look.size !== 'auto' && (
            <>
              <Field label="Sits">
                <Select value={look.align} options={SHOT_ALIGNS.map((align) => ({ value: align, label: ALIGN_NAMES[align] }))} onChange={(align) => setField('align', align)} label="Where the shot sits" testId="shot-align" />
              </Field>
              {look.align !== 'center' && (
                <Field label="Bleed">
                  <Range value={Math.round(look.bleed * 100)} max={60} label="How much of the shot reaches past the edge" onChange={(value) => setField('bleed', value / 100)} testId="shot-bleed" />
                </Field>
              )}
            </>
          )}
          <Field label="Scale">
            <Select value={scale} options={SCALES} onChange={setScale} label="Scale" />
          </Field>
        </Part>
        <Part title="Headline">
          <HeadlineFields key={view.dir} headline={look?.headline} onChange={(headline) => change((before) => { const { headline: _old, ...rest } = before; return headline ? { ...rest, headline } : rest; })} />
          <Field label="Font">
            <Select value={look?.font} options={THEME_FONTS.map((font) => ({ value: font, label: font, note: FONT_NOTES[font] }))} onChange={(font) => setField('font', font)} label="The headline's and the watermark's font" testId="shot-font" />
          </Field>
        </Part>
        <Part title="Private data">
          <span className="shot-colors">
            <button type="button" className="ghost small" disabled={reading} onClick={() => void redact()} data-testid="shot-redact">
              {reading ? 'Reading the text…' : 'Hide private data'}
            </button>
            {(look?.masks.length ?? 0) > 0 && (
              <button type="button" className="ghost small" onClick={() => setField('masks', [])} data-testid="shot-masks-clear">
                Remove {look!.masks.length} {look!.masks.length === 1 ? 'mask' : 'masks'}
              </button>
            )}
          </span>
          <p className="shot-hint">Email addresses, keys and tokens, card and phone numbers, read on this computer and filled in. It misses things: look yourself before you share.</p>
        </Part>
        <Part title="Watermark">
          <Field label="Text">
            <input
              type="text"
              key={`${view.dir}:${look?.watermark?.image ?? ''}`}
              defaultValue={look?.watermark?.image ? '' : (look?.watermark?.text ?? '')}
              placeholder={look?.watermark?.image ? 'The brand’s logo' : 'A name in a corner'}
              maxLength={80}
              onChange={(event) => {
                const text = event.target.value.trim();
                change((before) => {
                  const { watermark: _old, ...rest } = before;
                  return text ? { ...rest, watermark: { ...((before.watermark as Raw | undefined) ?? {}), image: undefined, text } } : rest;
                });
                if (text) setLogo(undefined);
              }}
              aria-label="Watermark"
              data-testid="shot-watermark"
            />
          </Field>
          {look?.watermark && (
            <>
              <Field label="Corner">
                <Select value={look.watermark.corner} options={WEBCAM_CORNERS.map((corner) => ({ value: corner, label: CORNER_NAMES[corner] }))} onChange={(corner) => change((before) => ({ ...before, watermark: { ...(before.watermark as Raw), corner } }))} label="Watermark corner" testId="shot-watermark-corner" />
              </Field>
              <span className="shot-colors">
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => {
                    change((before) => {
                      const { watermark: _old, ...rest } = before;
                      return rest;
                    });
                    setLogo(undefined);
                  }}
                  data-testid="shot-watermark-remove"
                >
                  No watermark
                </button>
              </span>
            </>
          )}
        </Part>
      </section>
    </div>
  );
}

const FRAME_DEVICES = new Set<FrameStyle>(['iphone', 'android']);

/** The headline's fields: a title makes one, an empty title takes it away. */
function HeadlineFields({ headline, onChange }: { headline: Shot['headline']; onChange: (headline: Raw | undefined) => void }) {
  const set = (fields: Raw) => {
    const next = { ...(headline ?? {}), ...fields } as Raw;
    onChange(typeof next.title === 'string' && next.title.trim() !== '' ? next : undefined);
  };
  return (
    <>
      <Field label="Title">
        <input type="text" defaultValue={headline?.title ?? ''} placeholder="A title over the shot" maxLength={120} onChange={(event) => set({ title: event.target.value })} aria-label="Headline" data-testid="shot-headline" />
      </Field>
      {headline && (
        <>
          <Field label="Line">
            <input type="text" defaultValue={headline.subtitle ?? ''} placeholder="A line under it" maxLength={240} onChange={(event) => set({ subtitle: event.target.value || undefined })} aria-label="Line under the headline" />
          </Field>
          <Field label="Place">
            <Select value={headline.position} options={[{ value: 'above', label: 'Above the shot' }, { value: 'below', label: 'Below the shot' }]} onChange={(position) => set({ position })} label="Where the headline goes" />
          </Field>
          <Field label="Colour">
            <input type="color" value={headline.color ?? '#ffffff'} onChange={(event) => set({ color: event.target.value })} aria-label="Headline colour" />
          </Field>
        </>
      )}
    </>
  );
}

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
