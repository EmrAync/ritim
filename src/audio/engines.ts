// Two ways to play a looping rhythm at another tempo without changing pitch:
//  - StretchEngine: the loop is decoded once and played by Signalsmith
//    Stretch (WASM AudioWorklet). Tempo changes are instant and smooth and
//    the loop wraps sample-accurately; positions are exact (metronome lock).
//  - ElementEngine: <audio> with preservesPitch; fallback for devices
//    without AudioWorklet/WASM and for very long recordings.

import type { Rhythm } from '../data/rhythms';
import { Timeline } from './timeline';

export interface RhythmEngine {
  readonly kind: 'stretch' | 'element';
  /** Prepares the rhythm (decode / attach); playback stays stopped. */
  load(r: Rhythm, blob: Blob, decoded?: AudioBuffer): Promise<void>;
  loadedId(): string | undefined;
  /** Starts from the loop start; returns the audio time it is heard. */
  start(rate: number): Promise<number>;
  stop(): void;
  setRate(rate: number): void;
  /** Loop position heard at audio time t (undefined when stopped). */
  posAt(t: number): number | undefined;
  rateAt(t: number): number;
  /** Time of the next scheduled tempo change after t. */
  nextChange(t: number): number | undefined;
  loopLen(): number;
}

interface StretchNode extends AudioWorkletNode {
  addBuffers(buffers: Float32Array[], transfer?: Transferable[]): Promise<number>;
  dropBuffers(): Promise<unknown>;
  schedule(obj: Record<string, number | boolean>): Promise<unknown>;
  latency(): Promise<number>;
  configure(obj: Record<string, unknown>): Promise<unknown>;
}

type CreateStretch = (ctx: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<StretchNode>;

/** Audio before/after the loop, so the stretcher's analysis window never sees silence at the wrap. */
const PAD = 1;
/** Tempo changes are heard this far ahead (s), past the metronome's lookahead. */
const CHANGE_AHEAD = 0.14;

export const stretchSupported = (): boolean =>
  typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly === 'object' && typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);
}

/** Exactly `len` frames of the loop: drops MP3 encoder priming if the decoder kept it. */
function loopFrames(buf: AudioBuffer, expectedSec: number): { start: number; len: number } {
  const want = Math.round(expectedSec * buf.sampleRate);
  if (!expectedSec || buf.length <= want) return { start: 0, len: buf.length };
  const extra = buf.length - want;
  const priming = Math.round((1105 / 44100) * buf.sampleRate);
  return { start: extra > priming * 0.8 ? Math.min(priming, extra) : 0, len: want };
}

export class StretchEngine implements RhythmEngine {
  readonly kind = 'stretch' as const;
  private node?: StretchNode;
  private lat = 0.15;
  private id?: string;
  private len = 0;
  private playing = false;
  private readonly tl = new Timeline();

  private constructor(private readonly ctx: AudioContext) {}

  static async create(ctx: AudioContext, dest: AudioNode): Promise<StretchEngine> {
    const url = new URL('vendor/SignalsmithStretch.mjs', document.baseURI).href;
    const mod = (await withTimeout(import(/* @vite-ignore */ url), 15000, 'Tempo motoru yüklenemedi')) as { default: CreateStretch };
    const e = new StretchEngine(ctx);
    e.node = await withTimeout(mod.default(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }), 15000, 'Tempo motoru başlatılamadı');
    e.node.connect(dest);
    e.lat = Math.min(0.4, Math.max(0.02, (await e.node.latency()) || 0.15));
    return e;
  }

  loadedId(): string | undefined {
    return this.id;
  }

  async load(r: Rhythm, blob: Blob, decoded?: AudioBuffer): Promise<void> {
    if (this.id === r.id) return;
    this.stop();
    const buf = decoded ?? (await this.ctx.decodeAudioData(await blob.arrayBuffer()));
    const { start, len } = loopFrames(buf, r.duration);
    const pad = Math.min(Math.round(PAD * buf.sampleRate), len);
    const chans = [0, Math.min(1, buf.numberOfChannels - 1)].map((c) => {
      const src = buf.getChannelData(c).subarray(start, start + len);
      const out = new Float32Array(len + 2 * pad);
      out.set(src.subarray(len - pad), 0);
      out.set(src, pad);
      out.set(src.subarray(0, pad), pad + len);
      return out;
    });
    const node = this.node!;
    await node.dropBuffers();
    await node.addBuffers(chans, chans.map((c) => c.buffer));
    this.padSec = pad / buf.sampleRate;
    this.len = len / buf.sampleRate;
    this.id = r.id;
  }

  private padSec = PAD;

  async start(rate: number): Promise<number> {
    const t = this.ctx.currentTime + this.lat + 0.03;
    await this.node!.schedule({
      active: true,
      input: this.padSec,
      output: t,
      outputTime: this.ctx.currentTime,
      rate,
      loopStart: this.padSec,
      loopEnd: this.padSec + this.len,
    });
    this.tl.reset(t, 0, rate, this.len);
    this.playing = true;
    return t;
  }

  stop(): void {
    if (!this.node || !this.playing) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    void this.node.schedule({ active: false, output: now, outputTime: now });
  }

  setRate(rate: number): void {
    if (!this.node || !this.playing) return;
    // Heard after the clicks the metronome has already scheduled (it looks 120 ms ahead).
    const t = Math.max(this.ctx.currentTime + Math.max(this.lat, CHANGE_AHEAD), this.tl.lastT + 0.001);
    void this.node.schedule({ output: t, outputTime: t, rate });
    this.tl.change(t, rate);
  }

  posAt(t: number): number | undefined {
    if (!this.playing) return undefined;
    const s = this.tl.segmentAt(t);
    if (s && t < s.t) return 0;
    return this.tl.posAt(t);
  }

  rateAt(t: number): number {
    return this.tl.rateAt(t);
  }

  nextChange(t: number): number | undefined {
    return this.tl.nextChange(t);
  }

  loopLen(): number {
    return this.len;
  }
}

export class ElementEngine implements RhythmEngine {
  readonly kind = 'element' as const;
  private readonly audio = new Audio();
  private url?: string;
  private id?: string;
  private playing = false;

  constructor(private readonly ctx: AudioContext, dest: AudioNode) {
    const a = this.audio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    a.loop = true;
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.preservesPitch = true;
    a.mozPreservesPitch = true;
    a.webkitPreservesPitch = true;
    ctx.createMediaElementSource(a).connect(dest);
  }

  loadedId(): string | undefined {
    return this.id;
  }

  /** Plays silence once inside a tap so iOS lets this element play later. */
  prime(silence: string): void {
    if (this.primed) return;
    this.primed = true;
    if (!this.audio.src) {
      this.audio.src = silence;
      void this.audio.play().catch(() => undefined);
    }
  }

  private primed = false;

  async load(r: Rhythm, blob: Blob): Promise<void> {
    if (this.id === r.id) return;
    this.stop();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    this.id = r.id;
  }

  async start(rate: number): Promise<number> {
    this.audio.currentTime = 0;
    this.audio.playbackRate = rate;
    await this.audio.play();
    this.playing = true;
    return this.ctx.currentTime;
  }

  stop(): void {
    this.playing = false;
    this.audio.pause();
  }

  setRate(rate: number): void {
    // Many small changes make some phones drop the sound: only apply real changes.
    if (Math.abs(this.audio.playbackRate - rate) > 0.004) this.audio.playbackRate = rate;
  }

  posAt(t: number): number | undefined {
    if (!this.playing) return undefined;
    const L = this.loopLen();
    const p = this.audio.currentTime + (t - this.ctx.currentTime) * this.audio.playbackRate;
    return L ? ((p % L) + L) % L : p;
  }

  rateAt(): number {
    return this.audio.playbackRate;
  }

  nextChange(): number | undefined {
    return undefined;
  }

  loopLen(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }
}
