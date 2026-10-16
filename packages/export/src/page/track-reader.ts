import { VideoSampleSink, type InputVideoTrack, type VideoSample, type VideoSinkDecoderOptions } from 'mediabunny';

/**
 * Decoded frames of one track for one scene. `times` (ascending, no duplicates) are all the track
 * times the scene will ask for; decoding starts at once in the background, from the key frame before
 * the first time, and skips whole GOPs that no time needs (sped-up scenes).
 */
export class TrackReader {
  private readonly samples: AsyncGenerator<VideoSample | null, void, unknown>;
  private next = 0;
  private current: { sample: VideoSample; frame: VideoFrame } | undefined;
  private closed = false;

  constructor(
    track: InputVideoTrack,
    private readonly times: readonly number[],
    decoder: VideoSinkDecoderOptions,
  ) {
    this.samples = new VideoSampleSink(track, decoder).samplesAtTimestamps(times);
  }

  /**
   * The frame shown at `time`: the one decoded for the newest planned time up to `time`. Times
   * never go back; asking for the same time again (a held crossfade layer) returns the same frame.
   * Undefined where the track has no frame: before its first frame, or where a cut-off file has no
   * data (the demuxer can list samples whose bytes are missing). The frame stays valid until a later
   * call moves on or `close()`; do not close it.
   */
  async frameAt(time: number): Promise<VideoFrame | undefined> {
    if (this.closed) throw new Error('TrackReader: read after close');
    while (this.next < this.times.length && this.times[this.next]! <= time) {
      const result = await this.samples.next();
      this.next++;
      this.release();
      if (result.done) break;
      if (result.value) this.current = { sample: result.value, frame: result.value.toVideoFrame() };
    }
    return this.current?.frame;
  }

  private release(): void {
    this.current?.frame.close();
    this.current?.sample.close();
    this.current = undefined;
  }

  /** Stops decoding and frees every frame. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.release();
    await this.samples.return(undefined);
  }
}
