// Audio into the meter analysis: microphone recordings and picked files,
// mixed to mono and halved to ~22 kHz (plenty for rhythm, twice as fast).

import { analyseAudio, type ListenResult } from './listen';

function half(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (x[2 * i] + x[2 * i + 1]) * 0.5;
  return out;
}

export function analyseSamples(samples: Float32Array, sampleRate: number): ListenResult | undefined {
  return sampleRate > 30000 ? analyseAudio(half(samples), sampleRate / 2) : analyseAudio(samples, sampleRate);
}

/** A recording file: up to 25 s from its body (intros are often free rhythm). */
export async function analyseFile(ctx: BaseAudioContext, file: Blob): Promise<{ result?: ListenResult; seconds: number }> {
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  const sr = buf.sampleRate;
  const start = Math.min(Math.floor(buf.duration * 0.25), 20) * sr;
  const len = Math.max(0, Math.min(buf.length - start, 25 * sr));
  const mono = new Float32Array(len);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[start + i] / buf.numberOfChannels;
  }
  return { result: analyseSamples(mono, sr), seconds: Math.round(len / sr) };
}
