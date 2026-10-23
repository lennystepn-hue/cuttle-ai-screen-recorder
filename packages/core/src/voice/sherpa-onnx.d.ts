// The part of sherpa-onnx-node (it ships no types) that speaks with a local voice.
declare module 'sherpa-onnx-node' {
  export interface OfflineTtsConfig {
    model: { vits: { model: string; tokens: string; dataDir: string }; numThreads?: number; provider?: 'cpu'; debug?: boolean };
    /** Sentences generated at once. */
    maxNumSentences?: number;
  }
  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }
  export class OfflineTts {
    static createAsync(config: OfflineTtsConfig): Promise<OfflineTts>;
    readonly sampleRate: number;
    readonly numSpeakers: number;
    generateAsync(request: { text: string; sid: number; speed: number }): Promise<GeneratedAudio>;
  }
}
