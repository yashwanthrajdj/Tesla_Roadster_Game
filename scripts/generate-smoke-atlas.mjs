import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createSmokeAtlasData } from '../src/smoke-atlas.js';

// Minimal RGBA PNG writer: no native tools or network assets required.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}
const { data, width, height } = createSmokeAtlasData(192);
const header = Buffer.alloc(13);
header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
header[8] = 8; header[9] = 6;
const rows = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
await mkdir('public/textures', { recursive: true });
await writeFile('public/textures/smoke-atlas.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`Baked smoke atlas: ${width} × ${height}, four shaded density clouds.`);
