import type { LonLat, ScenarioData } from './types';
import { Rng } from './rng';
import { fbm } from './noise';

/** Special pixel ids in the province bitmap. Real provinces use 0..P-1. */
export const SEA = 0xffff;
export const WASTE = 0xfffe;
export const UNCLAIMED = 0xfffd;

/** Pixels per day for armies on land and at sea. 50 px is roughly one degree. */
const LAND_SPEED = 8;
const SEA_SPEED = 12;
const SEA_EMBARK_DAYS = 4;
/** Max sea distance (px) bridged by a sea lane between two coastal provinces. */
const SEA_LINK_MAX = 120;

export interface MapData {
  width: number;
  height: number;
  /** Province id per pixel, or SEA / WASTE / UNCLAIMED. */
  ids: Uint16Array;
  provinceCount: number;
  anchorX: Float32Array;
  anchorY: Float32Array;
  pixelCount: Int32Array;
  coastal: Uint8Array;
  /** CSR adjacency: neighbors of p are adj[adjOffset[p] .. adjOffset[p+1]). */
  adjOffset: Int32Array;
  adj: Int32Array;
  adjSea: Uint8Array;
  adjDays: Uint16Array;
  /** nextHop[target * P + from] = next province on the fastest route, or -1. */
  nextHop: Int16Array;
  /** hopDays[target * P + from] = total travel days. */
  hopDays: Uint16Array;
}

export function project(s: ScenarioData, lon: number, lat: number): [number, number] {
  const m = s.map;
  return [((lon - m.lonMin) / (m.lonMax - m.lonMin)) * m.width, ((m.latMax - lat) / (m.latMax - m.latMin)) * m.height];
}

/** Turn a lon/lat polygon into a jagged pixel-space polygon using midpoint displacement. */
function roughen(s: ScenarioData, poly: LonLat[], rng: Rng, rough: number): number[] {
  const W = s.map.width, H = s.map.height;
  const out: number[] = [];
  const onEdge = (ax: number, ay: number, bx: number, by: number) =>
    (Math.abs(ax - bx) < 1e-6 && (ax <= 0.01 || ax >= W - 0.01)) || (Math.abs(ay - by) < 1e-6 && (ay <= 0.01 || ay >= H - 0.01));
  const sub = (ax: number, ay: number, bx: number, by: number, depth: number): void => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 3 || depth > 7) return;
    const off = (rng.next() - 0.5) * len * rough;
    const mx = (ax + bx) / 2 - (dy / len) * off;
    const my = (ay + by) / 2 + (dx / len) * off;
    sub(ax, ay, mx, my, depth + 1);
    out.push(mx, my);
    sub(mx, my, bx, by, depth + 1);
  };
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = project(s, poly[i][0], poly[i][1]);
    const [bx, by] = project(s, poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1]);
    out.push(ax, ay);
    if (!onEdge(ax, ay, bx, by)) sub(ax, ay, bx, by, 0);
  }
  return out;
}

/** Even-odd scanline fill of a pixel-space polygon. */
function fillPolygon(xy: number[], mask: Uint8Array, W: number, H: number, value: number): void {
  const n = xy.length / 2;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, xy[i * 2 + 1]);
    maxY = Math.max(maxY, xy[i * 2 + 1]);
  }
  const xs: number[] = [];
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = xy[i * 2], ay = xy[i * 2 + 1], bx = xy[j * 2], by = xy[j * 2 + 1];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * W + x] = value;
    }
  }
}

export function generateMap(s: ScenarioData): MapData {
  const W = s.map.width, H = s.map.height, N = W * H;
  const P = s.provinces.length;
  const rng = new Rng(s.mapSeed);

  // 1. Land / sea / wasteland masks.
  const land = new Uint8Array(N);
  for (const poly of s.land) fillPolygon(roughen(s, poly, rng, 0.32), land, W, H, 1);
  for (const poly of s.seas) fillPolygon(roughen(s, poly, rng, 0.25), land, W, H, 0);
  const waste = new Uint8Array(N);
  for (const poly of s.wastes) fillPolygon(roughen(s, poly, rng, 0.3), waste, W, H, 1);

  const ids = new Uint16Array(N);
  for (let i = 0; i < N; i++) ids[i] = land[i] ? (waste[i] ? WASTE : UNCLAIMED) : SEA;

  // 2. Seeds: each province starts at its city, nudged onto claimable land if the coast moved.
  const anchorX = new Float32Array(P), anchorY = new Float32Array(P);
  const dist = new Int32Array(N).fill(0x7fffffff);
  const buckets: number[][] = [[], [], [], [], []];
  for (let p = 0; p < P; p++) {
    const [fx, fy] = project(s, s.provinces[p].lon, s.provinces[p].lat);
    let sx = Math.min(W - 1, Math.max(0, Math.round(fx)));
    let sy = Math.min(H - 1, Math.max(0, Math.round(fy)));
    if (ids[sy * W + sx] !== UNCLAIMED) {
      let found = false;
      for (let r = 1; r < 60 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = sx + dx, y = sy + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            if (ids[y * W + x] === UNCLAIMED) {
              sx = x;
              sy = y;
              found = true;
            }
          }
        }
      }
      if (!found) throw new Error(`Province ${s.provinces[p].name} has no land near its seed`);
    }
    const i = sy * W + sx;
    ids[i] = p;
    dist[i] = 0;
    buckets[0].push(i);
    anchorX[p] = sx;
    anchorY[p] = sy;
  }

  // 3. Grow provinces with a noisy multi-source shortest path (Dial's algorithm).
  //    Noise in the step cost gives organic, contiguous borders.
  const cost = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (ids[i] === SEA || ids[i] === WASTE) continue;
      cost[i] = 1 + Math.min(3, Math.floor(fbm(x / 38, y / 38, s.mapSeed, 3) * 4));
    }
  }
  const claimable = (i: number) => ids[i] !== SEA && ids[i] !== WASTE;
  let queued = P;
  for (let d = 0; queued > 0; d++) {
    const b = buckets[d % 5];
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      queued--;
      if (dist[i] !== d) continue;
      const x = i % W, y = (i / W) | 0;
      const owner = ids[i];
      for (let n = 0; n < 4; n++) {
        const q = n === 0 ? (x > 0 ? i - 1 : -1) : n === 1 ? (x < W - 1 ? i + 1 : -1) : n === 2 ? (y > 0 ? i - W : -1) : y < H - 1 ? i + W : -1;
        if (q < 0 || !claimable(q)) continue;
        const nd = d + cost[q];
        if (nd < dist[q]) {
          dist[q] = nd;
          ids[q] = owner;
          buckets[nd % 5].push(q);
          queued++;
        }
      }
    }
    b.length = 0;
  }

  // 4. Pixel stats, land adjacency and coast detection.
  const pixelCount = new Int32Array(P);
  const shared = new Int32Array(P * P);
  const coastPx = new Int32Array(P);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = ids[i];
      if (a >= P) continue;
      pixelCount[a]++;
      if (x < W - 1) {
        const b = ids[i + 1];
        if (b < P && b !== a) shared[Math.min(a, b) * P + Math.max(a, b)]++;
        else if (b === SEA) coastPx[a]++;
      }
      if (y < H - 1) {
        const b = ids[i + W];
        if (b < P && b !== a) shared[Math.min(a, b) * P + Math.max(a, b)]++;
        else if (b === SEA) coastPx[a]++;
      }
      if ((x > 0 && ids[i - 1] === SEA) || (y > 0 && ids[i - W] === SEA)) coastPx[a]++;
    }
  }
  const coastal = new Uint8Array(P);
  for (let p = 0; p < P; p++) coastal[p] = coastPx[p] >= 3 ? 1 : 0;

  // 5. Sea lanes: grow labels out from each coast over the water; where two labels meet
  //    close enough, those provinces are linked by sea.
  const seaLabel = new Int16Array(N).fill(-1);
  const seaDist = new Uint16Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) {
    if (ids[i] !== SEA) continue;
    const x = i % W, y = (i / W) | 0;
    let lbl = -1;
    if (x > 0 && ids[i - 1] < P) lbl = ids[i - 1];
    else if (x < W - 1 && ids[i + 1] < P) lbl = ids[i + 1];
    else if (y > 0 && ids[i - W] < P) lbl = ids[i - W];
    else if (y < H - 1 && ids[i + W] < P) lbl = ids[i + W];
    if (lbl >= 0 && coastal[lbl]) {
      seaLabel[i] = lbl;
      seaDist[i] = 1;
      queue[qt++] = i;
    }
  }
  const seaBest = new Int32Array(P * P).fill(0x7fffffff);
  const half = SEA_LINK_MAX / 2 + 2;
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % W, y = (i / W) | 0;
    const li = seaLabel[i];
    for (let n = 0; n < 4; n++) {
      const q = n === 0 ? (x > 0 ? i - 1 : -1) : n === 1 ? (x < W - 1 ? i + 1 : -1) : n === 2 ? (y > 0 ? i - W : -1) : y < H - 1 ? i + W : -1;
      if (q < 0 || ids[q] !== SEA) continue;
      const lq = seaLabel[q];
      if (lq < 0) {
        if (seaDist[i] + 1 <= half) {
          seaLabel[q] = li;
          seaDist[q] = seaDist[i] + 1;
          queue[qt++] = q;
        }
      } else if (lq !== li) {
        const k = Math.min(li, lq) * P + Math.max(li, lq);
        const d = seaDist[i] + seaDist[q];
        if (d < seaBest[k]) seaBest[k] = d;
      }
    }
  }

  // 6. Build CSR adjacency with travel times.
  const nb: { to: number; sea: boolean; days: number }[][] = Array.from({ length: P }, () => []);
  for (let a = 0; a < P; a++) {
    for (let b = a + 1; b < P; b++) {
      const k = a * P + b;
      const d = Math.hypot(anchorX[a] - anchorX[b], anchorY[a] - anchorY[b]);
      if (shared[k] >= 3) {
        const days = Math.max(2, Math.round(d / LAND_SPEED));
        nb[a].push({ to: b, sea: false, days });
        nb[b].push({ to: a, sea: false, days });
      } else if (seaBest[k] <= SEA_LINK_MAX) {
        const days = Math.max(3, Math.round(d / SEA_SPEED) + SEA_EMBARK_DAYS);
        nb[a].push({ to: b, sea: true, days });
        nb[b].push({ to: a, sea: true, days });
      }
    }
  }
  const adjOffset = new Int32Array(P + 1);
  for (let p = 0; p < P; p++) adjOffset[p + 1] = adjOffset[p] + nb[p].length;
  const E = adjOffset[P];
  const adj = new Int32Array(E), adjSea = new Uint8Array(E), adjDays = new Uint16Array(E);
  for (let p = 0; p < P; p++) {
    nb[p].forEach((e, j) => {
      adj[adjOffset[p] + j] = e.to;
      adjSea[adjOffset[p] + j] = e.sea ? 1 : 0;
      adjDays[adjOffset[p] + j] = e.days;
    });
  }

  // 7. All-pairs next hop (static graph, so this is computed once).
  const nextHop = new Int16Array(P * P).fill(-1);
  const hopDays = new Uint16Array(P * P).fill(0xffff);
  const dd = new Int32Array(P), done = new Uint8Array(P);
  for (let t = 0; t < P; t++) {
    dd.fill(0x7fffffff);
    done.fill(0);
    dd[t] = 0;
    for (let it = 0; it < P; it++) {
      let u = -1;
      for (let v = 0; v < P; v++) if (!done[v] && dd[v] < 0x7fffffff && (u < 0 || dd[v] < dd[u])) u = v;
      if (u < 0) break;
      done[u] = 1;
      for (let e = adjOffset[u]; e < adjOffset[u + 1]; e++) {
        const v = adj[e];
        const nd = dd[u] + adjDays[e];
        if (nd < dd[v]) dd[v] = nd;
      }
    }
    for (let f = 0; f < P; f++) {
      if (dd[f] === 0x7fffffff) continue;
      hopDays[t * P + f] = Math.min(0xfffe, dd[f]);
      if (f === t) {
        nextHop[t * P + f] = t;
        continue;
      }
      let best = -1, bestD = 0x7fffffff;
      for (let e = adjOffset[f]; e < adjOffset[f + 1]; e++) {
        const v = adj[e];
        if (dd[v] === 0x7fffffff) continue;
        const d = adjDays[e] + dd[v];
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      nextHop[t * P + f] = best;
    }
  }

  return { width: W, height: H, ids, provinceCount: P, anchorX, anchorY, pixelCount, coastal, adjOffset, adj, adjSea, adjDays, nextHop, hopDays };
}

export function edgeDays(m: MapData, a: number, b: number): number {
  for (let e = m.adjOffset[a]; e < m.adjOffset[a + 1]; e++) if (m.adj[e] === b) return m.adjDays[e];
  return 0;
}

export function isAdjacent(m: MapData, a: number, b: number): boolean {
  for (let e = m.adjOffset[a]; e < m.adjOffset[a + 1]; e++) if (m.adj[e] === b) return true;
  return false;
}
