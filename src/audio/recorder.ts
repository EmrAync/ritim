// Records the microphone for the meter finder: mono samples plus a live
// level for the meter on screen. On iPhone the audio session switches to
// recording while it runs and back to playback afterwards.

import { createStore } from '../lib/store';
import { audioContext, recordingSession, unlockAudio } from './context';

export interface RecorderState {
  recording: boolean;
  /** Seconds recorded so far. */
  seconds: number;
  /** 0–1, for the level bar. */
  level: number;
  error?: string;
}

export const recorder = createStore<RecorderState>({ recording: false, seconds: 0, level: 0 });

let stream: MediaStream | undefined;
let source: MediaStreamAudioSourceNode | undefined;
let proc: ScriptProcessorNode | undefined;
let sink: GainNode | undefined;
let chunks: Float32Array[] = [];
let resolveDone: ((r: { samples: Float32Array; sampleRate: number } | undefined) => void) | undefined;
let maxSeconds = 18;

function cleanup(): void {
  proc?.disconnect();
  source?.disconnect();
  sink?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  proc = undefined;
  source = undefined;
  sink = undefined;
  stream = undefined;
  recordingSession(false);
}

function finish(): void {
  const sr = audioContext().sampleRate;
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const samples = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    samples.set(c, o);
    o += c.length;
  }
  chunks = [];
  cleanup();
  recorder.set((s) => ({ ...s, recording: false, level: 0 }));
  resolveDone?.(n ? { samples, sampleRate: sr } : undefined);
  resolveDone = undefined;
}

/**
 * Records up to `seconds` (call from a tap). Resolves with the samples when
 * the time is up or stopRecording() is called; undefined on error.
 */
export async function record(seconds = 18): Promise<{ samples: Float32Array; sampleRate: number } | undefined> {
  if (recorder.get().recording) return undefined;
  maxSeconds = seconds;
  recordingSession(true);
  const ctx = unlockAudio();
  recorder.set({ recording: true, seconds: 0, level: 0 });
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const error =
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Mikrofon izni verilmedi. Tarayıcı ayarlarından bu siteye mikrofon izni verin, sonra tekrar deneyin.'
        : name === 'NotFoundError'
          ? 'Mikrofon bulunamadı.'
          : 'Mikrofon açılamadı; tarayıcınız desteklemiyor olabilir. “Kayıttan” ile bir ses dosyası seçebilirsiniz.';
    cleanup();
    recorder.set({ recording: false, seconds: 0, level: 0, error });
    return undefined;
  }
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
  source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor: old but available on every phone browser; enough for a few seconds of capture.
  proc = ctx.createScriptProcessor(4096, 1, 1);
  sink = ctx.createGain();
  sink.gain.value = 0;
  chunks = [];
  const limit = Math.round(seconds * ctx.sampleRate);
  let got = 0;
  proc.onaudioprocess = (ev) => {
    const d = ev.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    got += d.length;
    let sum = 0;
    for (let i = 0; i < d.length; i += 8) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / (d.length / 8));
    recorder.set((s) => ({ ...s, seconds: got / ctx.sampleRate, level: Math.min(1, rms * 6) }));
    if (got >= limit) finish();
  };
  source.connect(proc);
  proc.connect(sink).connect(ctx.destination);
  return new Promise((resolve) => {
    resolveDone = resolve;
  });
}

/** Stops early (the result uses what was recorded so far). */
export function stopRecording(): void {
  if (recorder.get().recording && proc) finish();
}

/** Cancels without a result (leaving the screen). */
export function cancelRecording(): void {
  if (!recorder.get().recording) return;
  chunks = [];
  finish();
}

export const recordLimit = (): number => maxSeconds;
