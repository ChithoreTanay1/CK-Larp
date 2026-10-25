import type { RealmInfo } from '../sim/snapshot';
import type { Palette } from './mapRenderer';

export type PaletteMode = 'political' | 'realms' | 'famine' | 'drought' | 'raiderPressure' | 'tradeHealth' | 'ironAdoption' | 'culture' | 'terrain';

const PRESSURE_INDEX: Partial<Record<PaletteMode, number>> = { drought: 0, famine: 1, raiderPressure: 2, tradeHealth: 3, ironAdoption: 4 };
/** For these the good end is high, so the ramp is flipped. */
const HIGH_IS_GOOD = new Set<PaletteMode>(['tradeHealth']);

export function hsl(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

/** Green -> amber -> red ramp for 0..1. */
export function ramp(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return hsl(120 - 120 * t, 0.62, 0.42 + 0.06 * Math.sin(t * Math.PI));
}

export interface PaletteInput {
  mode: PaletteMode;
  owner: Int32Array;
  occupier: Int32Array;
  region: Uint8Array;
  realms: Map<number, RealmInfo>;
  cultureHue: number[];
  pressure: number[] | null;
  top: (r: number) => number;
}

export function buildPalette(inp: PaletteInput): Palette {
  const P = inp.owner.length;
  const pal: Palette = { color: new Uint32Array(P), alpha: new Uint8Array(P), group: new Int32Array(P), stripe: new Int32Array(P).fill(-1) };
  const pi = PRESSURE_INDEX[inp.mode];
  for (let p = 0; p < P; p++) {
    const o = inp.owner[p];
    const t = o >= 0 ? inp.top(o) : -1;
    const realm = inp.realms.get(inp.mode === 'realms' ? o : t);
    pal.group[p] = inp.mode === 'realms' ? o : t;
    switch (inp.mode) {
      case 'political':
      case 'realms':
        pal.color[p] = realm?.color ?? 0x777777;
        pal.alpha[p] = 168;
        break;
      case 'culture': {
        const c = inp.realms.get(o)?.culture ?? -1;
        pal.color[p] = c >= 0 ? hsl(inp.cultureHue[c], 0.45, 0.5) : 0x777777;
        pal.alpha[p] = 178;
        pal.group[p] = c;
        break;
      }
      case 'terrain':
        pal.color[p] = 0;
        pal.alpha[p] = 0;
        pal.group[p] = t;
        break;
      default: {
        const v = inp.pressure ? inp.pressure[inp.region[p] * 6 + (pi ?? 0)] : 0;
        pal.color[p] = ramp(HIGH_IS_GOOD.has(inp.mode) ? 1 - v : v);
        pal.alpha[p] = 190;
        pal.group[p] = inp.region[p];
      }
    }
    const occ = inp.occupier[p];
    if (occ >= 0 && (inp.mode === 'political' || inp.mode === 'realms')) pal.stripe[p] = inp.realms.get(inp.top(occ))?.color ?? 0x222222;
  }
  return pal;
}
