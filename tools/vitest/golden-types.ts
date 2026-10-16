export interface GoldenOptions {
  /** pixelmatch per-pixel colour threshold, 0..1 (default 0.05). */
  threshold?: number;
  /** How many pixels may differ before the test fails (default 0). */
  allowedMismatchedPixels?: number;
}

export interface GoldenResult {
  status: 'created' | 'updated' | 'match';
  mismatched: number;
}
