// 生成扩展图标：蓝色圆角底 + 白色相机图形。用法：node tools/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pixel(x, y, s) {
  // 归一化到 0..1
  const u = (x + 0.5) / s, v = (y + 0.5) / s;
  const r = 0.18;
  const dx = Math.max(r - u, 0, u - (1 - r)), dy = Math.max(r - v, 0, v - (1 - r));
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
  const blue = [37, 99, 235, 255], white = [255, 255, 255, 255];
  const inBody = u > 0.18 && u < 0.82 && v > 0.32 && v < 0.76;
  const inTop = u > 0.36 && u < 0.58 && v > 0.24 && v <= 0.32;
  const d = Math.hypot(u - 0.5, v - 0.54);
  if (inBody || inTop) return d < 0.13 ? blue : white;
  return blue;
}

function png(s) {
  const raw = Buffer.alloc((s * 4 + 1) * s);
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      const p = pixel(x, y, s);
      // 镜头中间再画一个白点
      const u = (x + 0.5) / s, v = (y + 0.5) / s;
      const q = Math.hypot(u - 0.5, v - 0.54) < 0.06 ? [255, 255, 255, 255] : p;
      q.forEach((c, i) => { raw[y * (s * 4 + 1) + 1 + x * 4 + i] = c; });
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(out, `icon${s}.png`), png(s));
console.log('icons written');
