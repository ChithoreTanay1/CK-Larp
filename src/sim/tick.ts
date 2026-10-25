import { World, NONE, DAYS_PER_MONTH, DAYS_PER_YEAR } from './world';
import { armiesDaily, seaPeoplesMonthly } from './systems/military';
import { updateWarScores, warMonthly } from './systems/war';
import { charMonthly, rebuildMarriagePools, yearlyAging } from './systems/characters';
import { economyMonthly, economyYearly } from './systems/economy';
import { pressureMonthly, pressureYearly, revoltsMonthly } from './systems/pressure';
import { computeLevies } from './systems/realms';
import { vassalsMonthly, hostagesYearly } from './systems/diplomacy';
import { plotsMonthly } from './systems/plots';
import { strategicAi, proposeMarriageToPlayer } from './ai/strategic';
import { monthlyEventRoll, yearlyEventRoll } from './events/runner';

export interface TickStats {
  days: number;
  lastDayMs: number;
  avgDayMs: number;
  maxDayMs: number;
  lastMonthMs: number;
  maxMonthMs: number;
  lastYearMs: number;
}

export function newStats(): TickStats {
  return { days: 0, lastDayMs: 0, avgDayMs: 0, maxDayMs: 0, lastMonthMs: 0, maxMonthMs: 0, lastYearMs: 0 };
}

/**
 * Advance one day. Tick tiers: daily (movement, battles), monthly (economy, pressure,
 * diplomacy) and yearly (aging, climate). AI and characters are staggered so each day
 * runs ~1/30 of them, spreading the cost evenly.
 */
export function stepDay(w: World, stats?: TickStats): void {
  const t0 = performance.now();
  w.day++;
  const d = w.day;
  // Headroom so births inside this tick never reallocate arrays mid-loop.
  w.ensureCharCapacity(256);
  const isMonth = d % DAYS_PER_MONTH === 0;
  const isYear = d % DAYS_PER_YEAR === 0;

  if (isMonth) {
    w.rebuildAlive();
    rebuildMarriagePools(w);
    economyMonthly(w);
    pressureMonthly(w);
    computeLevies(w);
    vassalsMonthly(w);
    warMonthly(w);
    plotsMonthly(w);
    revoltsMonthly(w);
    seaPeoplesMonthly(w);
    proposeMarriageToPlayer(w);
    promoteDetail(w);
  }
  if (isYear) {
    yearlyAging(w);
    economyYearly(w);
    pressureYearly(w);
    hostagesYearly(w);
    yearlyEventRoll(w);
  }

  // Daily tier.
  armiesDaily(w);
  updateWarScores(w);

  // Staggered monthly work: realms and characters whose slot is today.
  const slot = d % DAYS_PER_MONTH;
  const month = Math.floor(d / DAYS_PER_MONTH);
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r] || w.realmLandless[r] || w.realmAiOffset[r] % DAYS_PER_MONTH !== slot) continue;
    const full = w.isFullDetail(r);
    // LOD: far-away realms think quarterly.
    if (full || month % 3 === r % 3) strategicAi(w, r);
    if (full) monthlyEventRoll(w, r);
  }
  for (let i = slot; i < w.aliveCount; i += DAYS_PER_MONTH) charMonthly(w, w.aliveChars[i]);

  if (stats) {
    const ms = performance.now() - t0;
    stats.days++;
    stats.lastDayMs = ms;
    stats.avgDayMs += (ms - stats.avgDayMs) * 0.02;
    if (ms > stats.maxDayMs) stats.maxDayMs = ms;
    if (isMonth) {
      stats.lastMonthMs = ms;
      if (ms > stats.maxMonthMs) stats.maxMonthMs = ms;
    }
    if (isYear) stats.lastYearMs = ms;
  }
}

/** LOD promotion: regions the player owns land in or borders run at full detail. */
export function promoteDetail(w: World): void {
  if (w.player === NONE) return;
  const me = w.top(w.player);
  const m = w.map;
  for (let p = 0; p < w.P; p++) {
    if (w.provOwner[p] < 0 || w.top(w.provOwner[p]) !== me) continue;
    w.regionDetail[w.provRegion[p]] = 1;
    for (let e = m.adjOffset[p]; e < m.adjOffset[p + 1]; e++) {
      if (!m.adjSea[e]) w.regionDetail[w.provRegion[m.adj[e]]] = 1;
    }
  }
}
