// Generates build/icon.png (512x512): a dark rounded square with a tall bright
// vertical slab. Dependency-free: rasterises with 4x4 supersampling and writes
// the PNG with zlib. `node scripts/make-icon.mjs --tray` prints the 32 px
// version as a base64 data URL (embedded in src/main/tray.ts).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  const bg = [22, 24, 29];
  const slab = [236, 242, 250];
  const s = size;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = (x + (sx + 0.5) / ss) / s;
          const fy = (y + (sy + 0.5) / ss) / s;
          let c = null;
          if (insideRoundRect(fx, fy, 0.38, 0.14, 0.62, 0.86, 0.035)) c = slab;
          else if (insideRoundRect(fx, fy, 0.02, 0.02, 0.98, 0.98, 0.2)) c = bg;
          if (c) { a++; r += c[0]; g += c[1]; b += c[2]; }
        }
      }
      const i = (y * s + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
      px[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(size) {
  const px = render(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv.includes('--tray')) {
  console.log(`data:image/png;base64,${png(32).toString('base64')}`);
} else {
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png(512));
  console.log(`wrote ${out}`);
}
