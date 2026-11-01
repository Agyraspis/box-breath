// Writes public/icons/icon-192.png and icon-512.png: a simple square outline in the
// accent color on the app's dark background. Node built-ins only (no dependencies).
// The square stays inside the central 80 % circle, so the icons also work as maskable.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BACKGROUND = [0x0d, 0x0f, 0x12];
const ACCENT = [0x8c, 0xc7, 0xb9];
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Opaque 8-bit RGB PNG. */
function encodePng(size, rgb) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Square outline, side 50 % of the icon, 5.5 % stroke, 4×4 supersampled edges. */
function draw(size) {
  const center = size / 2;
  const half = size * 0.25;
  const stroke = size * 0.055;
  const outer = half + stroke / 2;
  const inner = half - stroke / 2;
  const samples = 4;
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const dx = Math.abs(x + (sx + 0.5) / samples - center);
          const dy = Math.abs(y + (sy + 0.5) / samples - center);
          const d = Math.max(dx, dy);
          if (d <= outer && d >= inner) hits++;
        }
      }
      const a = hits / (samples * samples);
      const i = (y * size + x) * 3;
      for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(BACKGROUND[k] + (ACCENT[k] - BACKGROUND[k]) * a);
    }
  }
  return rgb;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, draw(size)));
  console.log(`wrote ${file}`);
}
