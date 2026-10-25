/** Dev tool: render the generated province map to a PNG for eyeballing. Usage: tsx scripts/map-preview.ts out.png */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import scenario from '../src/data/scenarios/west.json';
import { generateMap, SEA, WASTE } from '../src/sim/mapgen';
import type { ScenarioData } from '../src/sim/types';

const s = scenario as ScenarioData;
const t0 = performance.now();
const m = generateMap(s);
console.log(`generated in ${(performance.now() - t0).toFixed(0)} ms`);

const W = m.width, H = m.height;
const rgb = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const id = m.ids[i];
  let r = 40, g = 70, b = 110;
  if (id === WASTE) [r, g, b] = [200, 180, 130];
  else if (id !== SEA && id < m.provinceCount) {
    const h = (id * 2654435761) >>> 0;
    r = 80 + (h & 127); g = 80 + ((h >> 8) & 127); b = 60 + ((h >> 16) & 100);
    const x = i % W;
    if ((x < W - 1 && m.ids[i + 1] !== id) || (i + W < W * H && m.ids[i + W] !== id)) [r, g, b] = [20, 20, 20];
  } else if (id !== SEA) [r, g, b] = [150, 150, 120];
  rgb.set([r, g, b], i * 3);
}
for (let p = 0; p < m.provinceCount; p++) {
  const x = m.anchorX[p], y = m.anchorY[p];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) rgb.set([255, 255, 255], ((y + dy) * W + x + dx) * 3);
  for (let e = m.adjOffset[p]; e < m.adjOffset[p + 1]; e++) {
    if (!m.adjSea[e]) continue;
    const q = m.adj[e];
    for (let t = 0; t <= 1; t += 0.01) {
      const lx = Math.round(x + (m.anchorX[q] - x) * t), ly = Math.round(y + (m.anchorY[q] - y) * t);
      if (m.ids[ly * W + lx] === SEA) rgb.set([120, 200, 255], (ly * W + lx) * 3);
    }
  }
}

function png(w: number, h: number, data: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(data.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(process.argv[2] ?? 'map-preview.png', png(W, H, rgb));
const small = Array.from(m.pixelCount).map((c, i) => [s.provinces[i].name, c] as const).filter(([, c]) => c < 300);
console.log('small provinces:', small);
const unreachable = [];
for (let p = 1; p < m.provinceCount; p++) if (m.nextHop[p * m.provinceCount] < 0) unreachable.push(s.provinces[p].name);
console.log('unreachable from 0:', unreachable);
