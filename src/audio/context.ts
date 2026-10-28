// One shared AudioContext for the rhythm player and the metronome. It must be
// created/resumed inside a tap on iOS, so unlockAudio() is called from every
// START handler before any await.

let ctx: AudioContext | undefined;
let master: GainNode | undefined;

export function audioContext(): AudioContext {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // A larger output buffer: weaker phones keep up with the tempo engine without dropouts.
    ctx = new C({ latencyHint: 'playback' });
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return ctx;
}

export function masterOut(): GainNode {
  audioContext();
  return master!;
}

/** Call synchronously from a user gesture. */
export function unlockAudio(): AudioContext {
  const c = audioContext();
  if (c.state !== 'running') void c.resume();
  return c;
}

// iOS suspends the context when the page is hidden; resume when back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') void ctx.resume();
  });
}
