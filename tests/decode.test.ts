import { describe, expect, it } from 'vitest';
import { decodeOne } from '../src/audio/engines';

/** Fake context: records when decodes start/end; each takes `ms`. */
function fakeCtx(ms: number) {
  const log: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const ctx = {
    decodeAudioData: async (b: ArrayBuffer) => {
      const name = new TextDecoder().decode(b);
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      log.push(`end ${name}`);
      return { name } as unknown as AudioBuffer;
    },
  } as unknown as BaseAudioContext;
  return { ctx, log, max: () => maxRunning };
}

const blob = (name: string) => new Blob([name]);

describe('decode queue', () => {
  it('decodes one rhythm at a time and skips the ones no longer wanted', async () => {
    const { ctx, log, max } = fakeCtx(30);
    let wanted = 'a';
    const results = ['a', 'b', 'c', 'd'].map((n) => {
      wanted = n; // the user taps a, b, c, d quickly: only the last stays wanted
      return decodeOne(ctx, blob(n), () => wanted === n || n === 'a');
    });
    const out = await Promise.all(results);
    expect(max()).toBe(1);
    // "a" was already running; b and c were skipped while queued; d decoded.
    expect(log).toEqual(['start a', 'end a', 'start d', 'end d']);
    expect(out.map((x) => (x as unknown as { name: string } | undefined)?.name)).toEqual(['a', undefined, undefined, 'd']);
  });

  it('keeps working after a failed decode', async () => {
    const ctx = {
      decodeAudioData: async (b: ArrayBuffer) => {
        if (new TextDecoder().decode(b) === 'bad') throw new Error('corrupt');
        return {} as AudioBuffer;
      },
    } as unknown as BaseAudioContext;
    await expect(decodeOne(ctx, blob('bad'), () => true)).rejects.toThrow('corrupt');
    await expect(decodeOne(ctx, blob('good'), () => true)).resolves.toBeDefined();
  });
});
