// Renders the app icon (same design as public/icon.svg) to PNG sizes
// without any image library: per-pixel coverage with 4×4 supersampling.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [14, 16, 20];
const TRACK = [42, 47, 58];
const ACCENT = [245, 165, 36];
const BODY = [28, 32, 41];

/** Colour at a point of the 512×512 design (undefined = transparent). */
function shade(x, y) {
  const r = 112;
  const qx = Math.max(Math.abs(x - 256) - (256 - r), 0);
  const qy = Math.max(Math.abs(y - 256) - (256 - r), 0);
  if (Math.hypot(qx, qy) > r) return undefined;
  const d = Math.hypot(x - 256, y - 256);
  if (Math.hypot(x - 256, y - 186) <= 16) return ACCENT;
  if (d <= 96) return BODY;
  if (Math.abs(d - 150) <= 17) {
    // Arc from 225° to 135° clockwise through the top (gap at the bottom).
    const a = (Math.atan2(x - 256, -(y - 256)) * 180) / Math.PI;
    return Math.abs(a) <= 135 ? ACCENT : TRACK;
  }
  // Round caps of the arc.
  for (const deg of [135, -135]) {
    const rad = (deg * Math.PI) / 180;
    if (Math.hypot(x - (256 + 150 * Math.sin(rad)), y - (256 - 150 * Math.cos(rad))) <= 17) return ACCENT;
  }
  return BG;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, full) {
  const S = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 512;
          const y = ((py + (sy + 0.5) / S) / size) * 512;
          const c = full ? shade(x, y) ?? BG : shade(x, y);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a) {
        raw[o] = r / a; raw[o + 1] = g / a; raw[o + 2] = b / a;
      }
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// iOS draws its own rounded corners: the touch icon is filled to the edge.
writeFileSync(join(OUT, 'icon-180.png'), png(180, true));
writeFileSync(join(OUT, 'icon-192.png'), png(192, false));
writeFileSync(join(OUT, 'icon-512.png'), png(512, true));
console.log('icons written');
