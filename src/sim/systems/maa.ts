import { World, ARMY_CAP, ArmyKind } from '../world';
import { UNITS, UNIT_COUNT } from '../units';
import { syncMen, armyQuality } from './military';

/**
 * Men-at-arms: standing regiments of 100 paid soldiers per troop type, kept by the realm
 * in peace and war. They wait in the barracks, march out with the levy, fight harder
 * than farmers and slowly refill after losses. A realm can keep only so many regiments;
 * building more barracks raises the limit.
 */
export const REGIMENT = 100;
/** Regiments one barracks expansion adds. */
export const MAA_EXPAND = 2;
/** Share of a regiment that drills back into shape each month. */
const REINFORCE = 0.2;

export function maaCap(w: World, r: number): number {
  return 3 + Math.floor(w.realmLevy[r] / 1500) + MAA_EXPAND * w.realmMaaExtra[r];
}

export function maaRegiments(w: World, r: number): number {
  let n = 0;
  for (let u = 0; u < UNIT_COUNT; u++) n += w.realmMaa[r * UNIT_COUNT + u];
  return n;
}

/** Men-at-arms of type u in realm r's armies. */
export function maaFielded(w: World, r: number, u: number): number {
  let n = 0;
  for (let a = 0; a < ARMY_CAP; a++) if (w.armyActive[a] && w.armyRealm[a] === r && w.armyKind[a] === ArmyKind.Host) n += w.armyMaa[a * UNIT_COUNT + u];
  return n;
}

/** One-off cost of raising a regiment: arms and training on top of the men themselves. */
export function maaHireCost(u: number): { metal: number; trade: number; cattle: number } {
  const t = UNITS[u];
  return { metal: Math.round(Math.max(2, t.costMetal * 1.5)), trade: Math.round(t.costTrade * 1.5 + 6), cattle: Math.round(t.costCattle * 1.5) };
}

/** Monthly pay per regiment, in trade goods, whether in the barracks or the field. */
export function maaPay(u: number): number {
  return UNITS[u].levy ? 0.4 : 0.8;
}

export function maaExpandCost(w: World, r: number): { trade: number; prestige: number } {
  const k = w.realmMaaExtra[r] + 1;
  return { trade: 50 * k, prestige: 15 * k };
}

export function hireRegiment(w: World, r: number, u: number): string {
  if (maaRegiments(w, r) >= maaCap(w, r)) return 'All our barracks are full. Build more to keep more regiments.';
  const c = maaHireCost(u);
  if (w.realmMetal[r] < c.metal || w.realmTrade[r] < c.trade || w.realmCattle[r] < c.cattle) {
    return `A regiment of ${UNITS[u].name.toLowerCase()} needs ${[c.metal && `${c.metal} metal`, c.trade && `${c.trade} trade goods`, c.cattle && `${c.cattle} cattle`].filter(Boolean).join(', ')}.`;
  }
  w.realmMetal[r] -= c.metal;
  w.realmTrade[r] -= c.trade;
  w.realmCattle[r] -= c.cattle;
  w.realmMaa[r * UNIT_COUNT + u]++;
  w.realmMaaMen[r * UNIT_COUNT + u] += REGIMENT;
  return '';
}

export function dismissRegiment(w: World, r: number, u: number): string {
  const i = r * UNIT_COUNT + u;
  if (!w.realmMaa[i]) return 'We keep no such regiment.';
  w.realmMaa[i]--;
  w.realmMaaMen[i] = Math.max(0, Math.min(w.realmMaaMen[i] - REGIMENT, w.realmMaa[i] * REGIMENT - maaFielded(w, r, u)));
  return '';
}

export function expandBarracks(w: World, r: number): string {
  const c = maaExpandCost(w, r);
  if (w.realmTrade[r] < c.trade || w.realmPrestige[r] < c.prestige) return `New barracks need ${c.trade} trade goods and ${c.prestige} prestige.`;
  w.realmTrade[r] -= c.trade;
  w.realmPrestige[r] -= c.prestige;
  w.realmMaaExtra[r]++;
  return '';
}

/** Send up to `men` ready men-at-arms of type u from the barracks into army a. Returns men sent. */
export function deployMaa(w: World, a: number, u: number, men: number): number {
  const r = w.armyRealm[a];
  const i = r * UNIT_COUNT + u;
  const n = Math.floor(Math.min(men, w.realmMaaMen[i]));
  if (n <= 0) return 0;
  w.realmMaaMen[i] -= n;
  const before = w.armyMen[a];
  w.armyUnits[a * UNIT_COUNT + u] += n;
  w.armyMaa[a * UNIT_COUNT + u] += n;
  syncMen(w, a);
  // Drilled, well-armed men lift the army's standard.
  const q = Math.min(1.25, armyQuality(w, r, n) + 0.1);
  w.armyQuality[a] = (w.armyQuality[a] * before + q * n) / w.armyMen[a];
  w.armyMorale[a] = (w.armyMorale[a] * before + n) / w.armyMen[a];
  return n;
}

/** All ready men-at-arms march out with army a (used when the player raises an army). */
export function deployAllMaa(w: World, a: number): number {
  let n = 0;
  for (let u = 0; u < UNIT_COUNT; u++) n += deployMaa(w, a, u, Infinity);
  return n;
}

/** Monthly: pay the regiments, and let depleted ones take in and drill new men. */
export function maaMonthly(w: World): void {
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r]) continue;
    for (let u = 0; u < UNIT_COUNT; u++) {
      const i = r * UNIT_COUNT + u;
      const regs = w.realmMaa[i];
      if (!regs) continue;
      w.realmTrade[r] = Math.max(0, w.realmTrade[r] - regs * maaPay(u));
      const missing = regs * REGIMENT - w.realmMaaMen[i] - maaFielded(w, r, u);
      if (missing <= 0) continue;
      const add = Math.min(missing, regs * REGIMENT * REINFORCE);
      const metal = (add / 100) * Math.max(0.5, UNITS[u].costMetal);
      if (w.realmMetal[r] < metal) continue;
      w.realmMetal[r] -= metal;
      w.realmMaaMen[i] += add;
    }
  }
}
