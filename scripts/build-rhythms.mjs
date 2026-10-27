// Builds the phone-friendly rhythm set from the original recordings:
//  - cuts each long recording to a ~3 minute seamless loop (loop end found by
//    matching the onset envelope after the loop start, refined to the sample,
//    with a short crossfade into the material just before the loop start),
//  - recordings whose tempo changes ("80-120") are kept whole,
//  - estimates the tempo when the file name has none,
//  - writes public/rhythms/<id>.mp3 and public/rhythms.json.
// Usage: node scripts/build-rhythms.mjs <sourceDir> <ffmpeg.exe> [--only <substr>]

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , SRC, FFMPEG, ...rest] = process.argv;
if (!SRC || !FFMPEG) {
  console.error('usage: build-rhythms.mjs <sourceDir> <ffmpeg>');
  process.exit(1);
}
const only = rest[0] === '--only' ? rest[1] : undefined;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'rhythms');
mkdirSync(OUT, { recursive: true });

const SR = 44100;
const HOP = 512; // envelope frame ≈ 11.6 ms
const LOOP_START = 8; // s after the first sound (skips count-ins/intros)
const LOOP_MIN = 170;
const LOOP_MAX = 200;
const XFADE = 0.025; // s
const BITRATE = '128k';

const CATEGORY = {
  '2-4': '2/4', '3-4': '3/4', '4-4': '4/4', '5-8': '5/8', '6-8': '6/8', '7-8': '7/8', '9-8': '9/8', '10-8': '10/8',
  dem: 'Dem (fon müzik)', halay: 'Halay', 'slow türkü': 'Slow türkü', 'çiftetelli': 'Çiftetelli',
};
const CATEGORY_ORDER = Object.keys(CATEGORY);
const DEFAULT_METER = { halay: '2/4', 'slow türkü': '4/4', 'çiftetelli': '4/4' };

const TR = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', İ: 'i', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
const slug = (s) =>
  s.normalize('NFC').replace(/[çğıöşüİÇĞÖŞÜ]/g, (c) => TR[c]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function title(name) {
  let t = name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/_/g, ' ')
    .replace(/\btempo\s*\d{2,3}(\s*-\s*\d{2,3})?\b/gi, '')
    .replace(/^\s*\d{1,2}-(2|4|8|16)\b/, '')
    .replace(/\b\d{1,2}\s*(dk|dakika)\b/gi, '')
    .replace(/\bhavas\b/gi, 'havası')
    .replace(/\bhzl\b/gi, 'hızlı')
    .replace(/\bslov\b/gi, 'slow')
    .replace(/\btrk\b/gi, 'Türk')
    .replace(/\b(tsm|thm)\b/gi, (m) => m.toUpperCase())
    .replace(/\britim\s*(\d)/gi, '$1')
    .replace(/\britim\b/gi, '')
    .replace(/[-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
}

function parse(folder, name) {
  const out = {};
  const r = /tempo[\s_-]*(\d{2,3})(?:\s*-\s*(\d{2,3}))?/i.exec(name);
  if (r) {
    out.bpm = Number(r[1]);
    if (r[2]) out.bpmTo = Number(r[2]);
  }
  const m = /(?:^|[/\s_])(\d{1,2})[-/](2|4|8|16)(?=$|[/\s_.])/.exec(name) ?? /^(\d{1,2})-(2|4|8|16)$/.exec(folder);
  if (m) out.meter = `${m[1]}/${m[2]}`;
  else if (/\b68\b/.test(name)) out.meter = '6/8';
  else if (DEFAULT_METER[folder]) out.meter = DEFAULT_METER[folder];
  return out;
}

function run(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.slice(-800)))));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** Decodes the first `seconds` to interleaved stereo float32. */
async function decode(file, seconds) {
  const buf = await run(['-v', 'error', '-i', file, '-t', String(seconds), '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

/** Duration from ffmpeg's "Duration: hh:mm:ss.xx" line. */
async function probeDuration(file) {
  const err = await run(['-hide_banner', '-i', file]).catch((e) => e.message);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(err));
  return m ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 10) / 10 : 0;
}

function monoOf(st) {
  const n = st.length >> 1;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = (st[2 * i] + st[2 * i + 1]) * 0.5;
  return m;
}

/** Onset strength per frame: positive change of log energy. */
function onsetEnvelope(mono) {
  const frames = Math.floor(mono.length / HOP);
  const e = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * HOP, end = i + HOP; i < end; i++) s += mono[i] * mono[i];
    const l = Math.log10(s / HOP + 1e-9);
    e[f] = Math.max(0, l - prev);
    prev = l;
  }
  return e;
}

function firstSound(mono) {
  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  const th = peak * 0.05;
  for (let i = 0; i < mono.length; i++) if (Math.abs(mono[i]) > th) return i;
  return 0;
}

function ncc(a, ao, b, bo, n) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[ao + i], y = b[bo + i];
    ab += x * y; aa += x * x; bb += y * y;
  }
  return ab / Math.sqrt(aa * bb + 1e-12);
}

/** Tempo from the envelope autocorrelation, with a mild preference for 70-140. */
function estimateBpm(env) {
  const fps = SR / HOP;
  const n = Math.min(env.length, Math.floor(fps * 60));
  const mean = env.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const x = Array.from(env.slice(0, n), (v) => v - mean);
  let best = 0, bestBpm = 0;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = (fps * 60) / bpm;
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < n; i++) s += x[i] * (x[i + l0] * (1 - fr) + x[i + l0 + 1] * fr);
    const w = Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.6) ** 2);
    if (s * w > best) {
      best = s * w;
      bestBpm = bpm;
    }
  }
  return Math.round(bestBpm);
}

function findLoop(st, isDrone) {
  const mono = monoOf(st);
  const start = firstSound(mono) + Math.round(LOOP_START * SR);
  const xf = Math.round(XFADE * SR);
  if (isDrone) {
    // Drone: no beat to match, long crossfade instead.
    return { s: start, e: start + Math.round(180 * SR), xf: Math.round(2 * SR), score: 1 };
  }
  const env = onsetEnvelope(mono);
  const sF = Math.floor(start / HOP);
  const W = Math.round((15 * SR) / HOP);
  let best = -1, bestF = 0;
  for (let f = sF + Math.round((LOOP_MIN * SR) / HOP); f <= sF + Math.round((LOOP_MAX * SR) / HOP); f++) {
    if (f + W >= env.length) break;
    const c = ncc(env, sF, env, f, W);
    if (c > best) {
      best = c;
      bestF = f;
    }
  }
  // Sample-level refinement around the coarse end.
  const coarse = bestF * HOP;
  const ref = Math.round(0.25 * SR);
  let bestS = -2, end = coarse;
  for (let d = -HOP * 2; d <= HOP * 2; d++) {
    const c = ncc(mono, start, mono, coarse + d, ref);
    if (c > bestS) {
      bestS = c;
      end = coarse + d;
    }
  }
  return { s: start, e: end, xf, score: best, fine: bestS, env };
}

/** Loop [s, e) with the tail crossfaded into the audio leading up to s. */
function renderLoop(st, { s, e, xf }) {
  const n = e - s;
  const out = new Float32Array(n * 2);
  out.set(st.subarray(s * 2, e * 2));
  for (let i = 0; i < xf; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 1)) / (xf + 1));
    const o = (n - xf + i) * 2;
    const p = (s - xf + i) * 2;
    out[o] = out[o] * (1 - w) + st[p] * w;
    out[o + 1] = out[o + 1] * (1 - w) + st[p + 1] * w;
  }
  return Buffer.from(out.buffer);
}

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.mp3$/i.test(n)) out.push(p);
  }
  return out;
}

async function processFile(file) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const folder = rel.includes('/') ? rel.split('/')[0].normalize('NFC') : '';
  const name = basename(file).normalize('NFC');
  const meta = parse(folder, name);
  const base = slug(basename(name, extname(name)));
  const id = base.startsWith(slug(folder)) ? base : slug(`${folder}-${base}`);
  const outFile = join(OUT, `${id}.mp3`);
  const isDrone = folder === 'dem';
  const entry = {
    id,
    title: title(name) || `${CATEGORY[folder] ?? ''} ritim`.trim(),
    source: rel.normalize('NFC'),
    category: folder,
    meter: meta.meter,
    bpm: meta.bpm,
    file: `rhythms/${id}.mp3`,
  };
  if (meta.bpmTo) entry.bpmTo = meta.bpmTo;

  if (meta.bpmTo) {
    // Tempo changes along the recording: keep it whole.
    await run(['-y', '-v', 'error', '-i', file, '-map', '0:a', '-map_metadata', '-1', '-c:a', 'copy', outFile]);
    entry.duration = await probeDuration(outFile);
    entry.whole = true;
  } else {
    const st = await decode(file, LOOP_START + LOOP_MAX + 30);
    const loop = findLoop(st, isDrone);
    if (!isDrone && !entry.bpm) {
      entry.bpm = estimateBpm(loop.env.subarray(Math.floor(loop.s / HOP)));
      entry.bpmEstimated = true;
    }
    if (isDrone) delete entry.bpm;
    const pcm = renderLoop(st, loop);
    await run(['-y', '-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-', '-c:a', 'libmp3lame', '-b:a', BITRATE, outFile], pcm);
    entry.duration = Math.round(((loop.e - loop.s) / SR) * 100) / 100;
    entry.loopScore = Math.round(loop.score * 100) / 100;
  }
  entry.size = statSync(outFile).size;
  return entry;
}

const files = walk(SRC).filter((f) => !only || f.includes(only));
const manifestPath = join(ROOT, 'public', 'rhythms.json');
const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).rhythms : [];
const results = new Map(prev.map((r) => [r.id, r]));
let i = 0;
async function worker() {
  while (i < files.length) {
    const f = files[i++];
    try {
      const e = await processFile(f);
      results.set(e.id, e);
      console.log(`✓ ${e.id}  ${e.duration}s  bpm=${e.bpm ?? '-'}${e.bpmEstimated ? '~' : ''}  score=${e.loopScore ?? '-'}`);
    } catch (err) {
      console.error(`✗ ${f}: ${err.message}`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

const rhythms = [...results.values()].sort(
  (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.title.localeCompare(b.title, 'tr'),
);
// Same title and tempo twice: number them so they can be told apart.
const seen = new Map();
for (const r of rhythms) {
  r.title = r.title.replace(/ \(\d+\)$/, '');
  const k = `${r.category}|${r.title}|${r.bpm}`;
  const n = (seen.get(k) ?? 0) + 1;
  seen.set(k, n);
  if (n > 1) r.title = `${r.title} (${n})`;
}
const categories = CATEGORY_ORDER.filter((c) => rhythms.some((r) => r.category === c)).map((id) => ({ id, label: CATEGORY[id] }));
writeFileSync(manifestPath, JSON.stringify({ version: 1, categories, rhythms }, null, 1));
const total = rhythms.reduce((a, r) => a + r.size, 0);
console.log(`${rhythms.length} ritim, ${(total / 1e6).toFixed(1)} MB`);
