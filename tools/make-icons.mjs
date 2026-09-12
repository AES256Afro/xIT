#!/usr/bin/env node
/*
 * Generates src/icons/icon-*.png with no dependencies.
 *
 * Chrome will not accept SVG in the manifest, so the glyph is drawn here with
 * 4x4 supersampled coverage tests and written through a minimal PNG encoder.
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'src', 'icons');
const SIZES = [16, 32, 48, 128, 512];

const BG = [29, 155, 240, 255];   // X blue
const FG = [255, 255, 255, 255];

/* ---- geometry helpers, all in a 24x24 design space ---- */

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function inRoundedRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  if (px >= x && px <= x + w && py >= y + r && py <= y + h - r) return true;
  if (py >= y && py <= y + h && px >= x + r && px <= x + w - r) return true;
  return Math.hypot(px - cx, py - cy) <= r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = d(px, py, ax, ay, bx, by);
  const d2 = d(px, py, bx, by, cx, cy);
  const d3 = d(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** The redirect glyph: up out of the corner, turn right, arrowhead. */
function inGlyph(x, y) {
  const t = 1.75;                       // half stroke width
  if (distToSegment(x, y, 6.6, 19.4, 6.6, 11.4) <= t) return true;   // riser
  if (distToSegment(x, y, 6.6, 11.4, 14.2, 11.4) <= t) return true;  // run
  if (inTriangle(x, y, 13.2, 5.6, 21.2, 11.6, 13.2, 17.6)) return true;
  return false;
}

/* ---- raster ---- */

function render(size) {
  const SS = 4;                          // supersampling factor
  const scale = size / 24;
  const px = Buffer.alloc(size * size * 4);
  const pad = size >= 32 ? 0.6 : 0.3;    // tiny inset so the square is not flush
  const radius = size >= 32 ? 5.4 : 5.0; // in design units

  for (let py2 = 0; py2 < size; py2++) {
    for (let px2 = 0; px2 < size; px2++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = (px2 + (sx + 0.5) / SS) / scale;
          const dy = (py2 + (sy + 0.5) / SS) / scale;
          if (inRoundedRect(dx, dy, pad, pad, 24 - pad * 2, 24 - pad * 2, radius)) bgHits++;
          if (inGlyph(dx, dy)) fgHits++;
        }
      }
      const total = SS * SS;
      const bgA = bgHits / total;
      const fgA = Math.min(fgHits / total, bgA); // clip the glyph to the tile
      const i = (py2 * size + px2) * 4;

      // fg over bg over transparent
      const outA = bgA;
      if (outA <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const bgC = BG[c] * (bgA - fgA);
        const fgC = FG[c] * fgA;
        px[i + c] = Math.round((bgC + fgC) / outA);
      }
      px[i + 3] = Math.round(outA * 255);
    }
  }
  return px;
}

/* ---- PNG encoder ---- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolour with alpha
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `icon-${size}.png`);
  await writeFile(file, encodePng(size, render(size)));
  console.log(`wrote src/icons/icon-${size}.png`);
}
