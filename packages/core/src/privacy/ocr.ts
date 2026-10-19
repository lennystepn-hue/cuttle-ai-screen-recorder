// Reading the screen's text with the system's own OCR: on Windows Windows.Media.Ocr through a
// Windows PowerShell 5.1 helper, on macOS the Vision framework through the recorder's cuttle-capture
// (`cuttle-capture ocr`, native/macos/capture.swift). Either, started once, reads PNG files one
// request per line on stdin and answers one JSON line each. Nothing leaves this computer.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Rect, ScreenTextLine } from '@cuttle/project';
import { captureHelper } from '@cuttle/recorder';
import { CoreError } from '../errors';

/**
 * The helper. It scales each picture up (cubic) before reading it: the OCR reads small text much
 * better at twice its size, and cubic kept what a pre-scaled picture gave (the spike's fixture).
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { [Console]::Out.WriteLine('{"ready":false}'); exit 0 }
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ ready = $true; language = $engine.RecognizerLanguage.LanguageTag; max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension } -Compress))
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($request.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $scale = [double]$request.scale
      $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
      $transform.ScaledWidth = [uint32][Math]::Round($decoder.PixelWidth * $scale)
      $transform.ScaledHeight = [uint32][Math]::Round($decoder.PixelHeight * $scale)
      $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    } finally { $stream.Dispose() }
    $lines = @(foreach ($l in $result.Lines) {
      ,@(foreach ($w in $l.Words) { $r = $w.BoundingRect; @{ t = $w.Text; r = @([Math]::Round($r.X / $scale, 1), [Math]::Round($r.Y / $scale, 1), [Math]::Round($r.Width / $scale, 1), [Math]::Round($r.Height / $scale, 1)) } })
    })
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ lines = $lines } -Compress -Depth 6))
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ error = $_.Exception.Message } -Compress))
  }
}
`;

/** Pictures are read at up to twice their size on Windows (its OCR reads small text much better so; Vision needs no help). */
export const OCR_SCALE = 2;

/**
 * Seconds the helper may take to start (Windows PowerShell, cold, can take several) and to read one
 * picture (well under one here) before it counts as hung: then it is ended, and the screen is not read.
 */
export const OCR_TIMEOUT = { start: 60, read: 60 };

/**
 * The helper's next answer, or `ocr-missing` when none came within `seconds` (`hung` is called
 * then: it ends the helper).
 */
export function answerWithin(answers: AsyncIterator<string>, seconds: number, what: string, hung: () => void): Promise<IteratorResult<string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hung();
      reject(new CoreError('ocr-missing', `the OCR helper did not answer within ${seconds} s (${what})`));
    }, seconds * 1000);
    answers.next().then(
      (answer) => {
        clearTimeout(timer);
        resolve(answer);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** What the helper answers to a picture: its lines, each a list of words with their rects. */
type Answer = { lines?: { t: string; r: [number, number, number, number] }[][]; error?: string };

/** The lines of words of an answer, each with the rect that holds its words. */
export function linesOf(answer: Answer): ScreenTextLine[] {
  return (answer.lines ?? []).flatMap((words) => {
    if (words.length === 0) return [];
    const rects = words.map((word) => word.r);
    const left = Math.min(...rects.map((r) => r[0]));
    const top = Math.min(...rects.map((r) => r[1]));
    const rect: Rect = [left, top, Math.max(...rects.map((r) => r[0] + r[2])) - left, Math.max(...rects.map((r) => r[1] + r[3])) - top];
    return [{ text: words.map((word) => word.t).join(' '), rect, words: words.map((word) => ({ text: word.t, rect: word.r })) }];
  });
}

/** The OCR helper: started once, then one picture after the other. */
export class ScreenReader {
  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly answers: AsyncIterator<string>,
    /** The largest picture side the OCR takes. */
    readonly maxSide: number,
    /** The OCR's languages (from the person's Windows or macOS languages), comma separated. */
    readonly language: string,
    /** Whether pictures are read larger than they are (Windows' OCR), up to `OCR_SCALE`. */
    private readonly upscales: boolean,
  ) {}

  /**
   * Starts the helper; `ocr-missing` where it cannot run (neither Windows nor macOS, PowerShell
   * refused, no OCR language, cuttle-capture not built).
   */
  static async start(): Promise<ScreenReader> {
    // the switch first: it says the same on every platform (the checks and the tests set it)
    if (process.env.CUTTLE_OCR === 'off') throw new CoreError('ocr-missing', 'reading the screen is switched off (CUTTLE_OCR=off)');
    let child: ChildProcessWithoutNullStreams;
    if (process.platform === 'win32') {
      const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      // CUTTLE_CAPTURE_HELPER=none chooses avfoundation for the screen: the helper still reads text
      const chosen = process.env.CUTTLE_CAPTURE_HELPER;
      const helper = captureHelper(chosen === 'none' ? '' : chosen);
      if (!helper) throw new CoreError('ocr-missing', "the screen's text is read by cuttle-capture, which was not built here (xcode-select --install, then pnpm install)");
      child = spawn(helper, ['ocr']);
    } else {
      throw new CoreError('ocr-missing', "the screen's text is read with Windows' or macOS's own OCR, which this system does not have");
    }
    child.stdin.setDefaultEncoding('utf8');
    const answers = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const started = new Promise<never>((_, reject) => child.on('error', (error) => reject(new CoreError('ocr-missing', `the OCR helper did not start (${error.message})`))));
    const first = await Promise.race([answerWithin(answers, OCR_TIMEOUT.start, 'starting', () => child.kill()), started]);
    const hello = first.done ? undefined : (JSON.parse(first.value) as { ready: boolean; language?: string; max?: number });
    if (!hello?.ready) {
      child.kill();
      throw new CoreError('ocr-missing', hello ? 'Windows has no OCR language installed (Settings > Time & language > Language)' : `the OCR helper did not start${stderr ? `: ${stderr.trim().split(/\r?\n/)[0]}` : ''}`);
    }
    return new ScreenReader(child, answers, hello.max ?? 10_000, (hello.language ?? '').split(',').filter(Boolean).join(', '), process.platform === 'win32');
  }

  /** The text of a PNG of `width` × `height` (on Windows read at up to `OCR_SCALE` times its size); rects in its pixels. */
  async read(path: string, width: number, height: number): Promise<ScreenTextLine[]> {
    const scale = this.upscales ? Math.max(1, Math.min(OCR_SCALE, this.maxSide / Math.max(width, height))) : 1;
    this.child.stdin.write(`${JSON.stringify({ path, scale })}\n`);
    const next = await answerWithin(this.answers, OCR_TIMEOUT.read, `reading ${path}`, () => this.child.kill());
    if (next.done) throw new CoreError('ocr-missing', 'the OCR helper stopped');
    const answer = JSON.parse(next.value) as Answer;
    if (answer.error) throw new CoreError('invalid-media', `the OCR could not read ${path}: ${answer.error}`);
    return linesOf(answer);
  }

  close(): void {
    this.child.stdin.end();
    setTimeout(() => this.child.kill(), 2000).unref();
  }
}
