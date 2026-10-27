// Adds the beat grid of every loop to public/rhythms.json, so the metronome
// can click exactly on the recording:
//   gridBpm – precise quarter-note tempo of the loop (search around the label),
//   phase   – seconds from the loop start to a downbeat (bar start guess).
// Usage: node scripts/analyze-beats.mjs <ffmpeg.exe>

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FFMPEG = process.argv[2];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'public', 'rhythms.json');
const SR = 22050;
const HOP = 128;
const FPS = SR / HOP;

// Same groupings the metronome picks for a rhythm meter (src/audio/usuls.ts).
const GROUPING = { '5/8': [2, 3], '6/8': [3, 3], '7/8': [3, 2, 2], '9/8': [2, 2, 2, 3], '10/8': [3, 2, 2, 3] };

function decode(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-']);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('close', (code) => {
      if (code) return reject(new Error(`ffmpeg ${code}`));
      const b = Buffer.concat(chunks);
      resolve(new Float32Array(b.buffer, b.byteOffset, b.length >> 2));
    });
  });
}

function envelope(x) {
  const n = Math.floor(x.length / HOP);
  const e = new Float32Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) s += x[i] * x[i];
    const l = Math.log10(s / HOP + 1e-9);
    e[f] = Math.max(0, l - prev);
    prev = l;
  }
  return e;
}

const at = (e, frame) => {
  const i = Math.floor(frame);
  const f = frame - i;
  return i + 1 < e.length ? e[i] * (1 - f) + e[i + 1] * f : 0;
};

/** Best pulse grid (period, phase in frames) near the labelled tempo. */
function bestGrid(e, pulseSec, spread) {
  let best = { score: -1, period: 0, phase: 0 };
  for (let d = -spread; d <= spread + 1e-9; d += 0.0005) {
    const period = (pulseSec / (1 + d)) * FPS;
    const count = Math.floor((e.length - period) / period);
    for (let ph = 0; ph < period; ph += 1) {
      let s = 0;
      for (let k = 0; k < count; k++) s += at(e, ph + k * period);
      s /= count;
      if (s > best.score) best = { score: s, period, phase: ph };
    }
  }
  return best;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const r of manifest.rhythms) {
  delete r.gridBpm;
  delete r.phase;
  if (!r.bpm || r.whole || !r.meter) continue;
  const [beats, unit] = r.meter.split('/').map(Number);
  const factor = unit === 8 ? 2 : 1;
  const e = envelope(await decode(join(ROOT, 'public', r.file)));
  let g = bestGrid(e, 60 / (r.bpm * factor), r.bpmEstimated ? 0.03 : 0.015);
  // Weak beat evidence: trust the tempo in the file name, only find the phase.
  if (!r.bpmEstimated && g.score < 0.3) g = bestGrid(e, 60 / (r.bpm * factor), 0);
  // Bar start: rotation whose pulse profile best matches the accents (bar start, group starts).
  const grouping = GROUPING[r.meter] ?? Array.from({ length: beats }, () => 1);
  const starts = new Set();
  grouping.reduce((acc, x) => (starts.add(acc), acc + x), 0);
  const template = Array.from({ length: beats }, (_, j) => (j === 0 ? 1.5 : starts.has(j) && grouping.some((x) => x > 1) ? 1 : 0.4));
  const profile = new Array(beats).fill(0);
  const count = Math.floor((e.length - g.phase) / g.period);
  for (let k = 0; k < count; k++) profile[k % beats] += at(e, g.phase + k * g.period);
  let rot = 0, bestRot = -1;
  for (let rr = 0; rr < beats; rr++) {
    let s = 0;
    for (let j = 0; j < beats; j++) s += profile[(j + rr) % beats] * template[j];
    if (s > bestRot) {
      bestRot = s;
      rot = rr;
    }
  }
  const barFrames = beats * g.period;
  r.gridBpm = Math.round(((60 * FPS) / g.period / factor) * 100) / 100;
  r.phase = Math.round((((g.phase + rot * g.period) % barFrames) / FPS) * 1000) / 1000;
  console.log(`${r.id.padEnd(48)} label=${r.bpm} grid=${r.gridBpm} phase=${r.phase}s score=${g.score.toFixed(3)}`);
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log('rhythms.json updated');
