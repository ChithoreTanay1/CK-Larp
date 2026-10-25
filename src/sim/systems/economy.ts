import { World, NONE, P_DROUGHT, P_TRADE, P_IRON, ARMY_CAP, ArmyKind } from '../world';
import { UNITS, UNIT_COUNT } from '../units';
import { fireTrigger } from '../events/runner';

// Terrain order matches TERRAINS: plains, hills, mountains, river, steppe.
export const FERTILITY = [1.1, 0.9, 0.75, 1.3, 0.8];
export const PASTURE = [0.3, 0.4, 0.3, 0.15, 0.7];
export const BASE_POP = [8, 5, 3, 12, 4];
export const DEFENSE = [1.0, 1.25, 1.5, 1.1, 0.9];
/** Monthly grain eaten per thousand people. */
export const EAT = 0.75;

// Per-realm accumulators, reused every month.
let accGrain = new Float32Array(0), accCattle = new Float32Array(0), accMetal = new Float32Array(0), accTrade = new Float32Array(0), accEat = new Float32Array(0);
let upkeepG = new Float32Array(0), upkeepM = new Float32Array(0);

function ensure(R: number): void {
  if (accGrain.length === R) return;
  accGrain = new Float32Array(R);
  accCattle = new Float32Array(R);
  accMetal = new Float32Array(R);
  accTrade = new Float32Array(R);
  accEat = new Float32Array(R);
  upkeepG = new Float32Array(R);
  upkeepM = new Float32Array(R);
}

/**
 * Monthly economy. Full-detail regions every month; reduced-detail regions every
 * third month with triple the step (coarse LOD economy).
 */
export function economyMonthly(w: World): void {
  ensure(w.R);
  accGrain.fill(0);
  accCattle.fill(0);
  accMetal.fill(0);
  accTrade.fill(0);
  accEat.fill(0);
  // Army upkeep per realm, by troop type.
  upkeepG.fill(0);
  upkeepM.fill(0);
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyKind[a] !== ArmyKind.Host) continue;
    const r = w.armyRealm[a];
    for (let u = 0; u < UNIT_COUNT; u++) {
      const n = w.armyUnits[a * UNIT_COUNT + u] / 1000;
      upkeepG[r] += n * UNITS[u].upkeepGrain;
      upkeepM[r] += n * UNITS[u].upkeepMetal;
    }
  }
  // Men-at-arms in the barracks eat and wear out gear too.
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r]) continue;
    for (let u = 0; u < UNIT_COUNT; u++) {
      const n = w.realmMaaMen[r * UNIT_COUNT + u] / 1000;
      if (!n) continue;
      upkeepG[r] += n * UNITS[u].upkeepGrain;
      upkeepM[r] += n * UNITS[u].upkeepMetal;
    }
  }
  const quarter = w.month % 3 === 0;

  for (let p = 0; p < w.P; p++) {
    const o = w.provOwner[p];
    if (o < 0) continue;
    const reg = w.provRegion[p];
    const full = w.regionDetail[reg] === 1;
    if (!full && !quarter) continue;
    const step = full ? 1 : 3;
    const ter = w.provTerrain[p];
    const drought = w.p(reg, P_DROUGHT);
    const trade = w.p(reg, P_TRADE);
    const iron = w.p(reg, P_IRON);
    const dev = 0.85 + w.provDevelop[p] * 0.06;
    let mod = 1;
    if (w.provRaided[p] > 0) mod *= 0.5;
    if (w.provOccupier[p] >= 0) mod *= 0.3;
    const pop = w.provPop[p];
    const grain = pop * FERTILITY[ter] * (1.15 - 0.6 * drought) * dev * mod;
    const cattle = pop * PASTURE[ter] * 0.25 * (1.1 - 0.4 * drought) * mod;
    const metal = w.provOre[p] * (0.5 + 0.6 * trade + 1.0 * iron) * dev * 0.8 * mod;
    const goods = (w.provTrade[p] * (0.4 + 1.2 * trade) * (w.map.coastal[p] ? 1.2 : 1) + w.provDevelop[p] * 0.15) * mod;
    w.provGrainOut[p] = grain;
    w.provCattleOut[p] = cattle;
    accGrain[o] += grain * step;
    accCattle[o] += cattle * step;
    accMetal[o] += metal * step;
    accTrade[o] += goods * step;
    accEat[o] += pop * EAT * step;

    // Population: grows slowly toward carrying capacity, devastation decays.
    const cap = BASE_POP[ter] * (0.7 + w.provDevelop[p] * 0.15) * 1.3;
    if (pop < cap) w.provPop[p] = pop + pop * 0.0015 * step;
    if (w.provRaided[p] > 0) w.provRaided[p] = Math.max(0, w.provRaided[p] - step);
    if (w.provUnrest[p] > 0) w.provUnrest[p] = Math.max(0, w.provUnrest[p] - 0.5 * step);
  }

  // Tribute: vassals send a share of their surplus up the chain.
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r]) continue;
    const l = w.realmLiege[r];
    if (l < 0) continue;
    const k = w.realmLoyalty[r] < 25 ? 0 : 0.15 * (w.realmLoyalty[r] / 100 + 0.5);
    const tg = accTrade[r] * k, tm = accMetal[r] * k, tc = accCattle[r] * k;
    accTrade[r] -= tg;
    accMetal[r] -= tm;
    accCattle[r] -= tc;
    accTrade[l] += tg;
    accMetal[l] += tm;
    accCattle[l] += tc;
  }

  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r] || w.realmLandless[r]) continue;
    if (accEat[r] === 0 && accGrain[r] === 0) continue;
    // Army upkeep.
    const upkeepGrain = upkeepG[r], upkeepMetal = upkeepM[r];
    w.realmIncome[r] = accTrade[r];
    let grain = w.realmGrain[r] + accGrain[r] - accEat[r] - upkeepGrain;
    w.realmCattle[r] += accCattle[r];
    if (grain < 0) {
      // Slaughter the herds before people starve.
      const need = -grain / 3;
      const eat = Math.min(need, w.realmCattle[r] * 0.5);
      w.realmCattle[r] -= eat;
      grain += eat * 3;
    }
    if (grain < 0) {
      famine(w, r, -grain / Math.max(1, accEat[r]));
      grain = 0;
    }
    const granary = accEat[r] * 10 + 40;
    if (grain > granary) {
      w.realmTrade[r] += (grain - granary) * 0.1; // surplus sold abroad
      grain = granary;
    }
    w.realmGrain[r] = grain;
    // Herds are capped by pasture.
    const herdCap = accCattle[r] * 40 + 30;
    if (w.realmCattle[r] > herdCap) w.realmCattle[r] = herdCap;
    w.realmMetal[r] = Math.max(0, w.realmMetal[r] + accMetal[r] - upkeepMetal);
    w.realmTrade[r] += accTrade[r];
    if (w.realmMetal[r] <= 0 && upkeepMetal > 0) {
      for (let a = 0; a < ARMY_CAP; a++) if (w.armyActive[a] && w.armyRealm[a] === r) w.armyMorale[a] = Math.max(0.2, w.armyMorale[a] - 0.08);
      w.realmStability[r] = Math.max(0, w.realmStability[r] - 1);
      if (r === w.player) w.addLog('bad', 'There is no bronze to pay the soldiers. They grumble in the camps.');
    }
    // Prestige: land brings renown, renown fades.
    w.realmPrestige[r] = w.realmPrestige[r] * 0.995 + Math.sqrt(w.realmProvCount[r]) * 0.12;
    // Stability drifts toward a level set by prestige and legitimacy.
    const target = 45 + Math.min(25, w.realmPrestige[r] / 8);
    w.realmStability[r] += (target - w.realmStability[r]) * 0.03;
    if (w.realmManpower[r] < 1) w.realmManpower[r] = Math.min(1, w.realmManpower[r] + 0.025);
  }
}

function famine(w: World, r: number, severity: number): void {
  const s = Math.min(1, severity);
  for (let p = 0; p < w.P; p++) {
    if (w.provOwner[p] !== r) continue;
    w.provPop[p] *= 1 - 0.02 * s;
    w.provUnrest[p] = Math.min(100, w.provUnrest[p] + 6 * s);
  }
  w.realmStability[r] = Math.max(0, w.realmStability[r] - 3 * s);
  for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.realmLiege[o] === r) w.realmLoyalty[o] = Math.max(0, w.realmLoyalty[o] - 2 * s);
  if (r === w.player && (w.month % 3 === 0 || s > 0.3)) {
    w.addLog('bad', 'The granaries are empty. People are starving.');
    fireTrigger(w, 'on_famine', r, NONE, NONE);
  } else if (r !== w.player && w.isFullDetail(r) && w.rng.chance(0.15)) fireTrigger(w, 'on_famine', r, NONE, NONE);
}

/** Yearly: development rises in peaceful, well-fed provinces and falls in ravaged ones. */
export function economyYearly(w: World): void {
  for (let p = 0; p < w.P; p++) {
    const o = w.provOwner[p];
    if (o < 0) continue;
    if (w.provRaided[p] > 0 || w.provUnrest[p] > 50) {
      if (w.provDevelop[p] > 1 && w.rng.chance(0.25)) {
        w.provDevelop[p]--;
        w.markProv(p);
      }
    } else if (w.provDevelop[p] < 5 && w.realmStability[o] > 55 && w.realmGrain[o] > 30 && w.rng.chance(0.04 + w.p(w.provRegion[p], P_TRADE) * 0.05)) {
      w.provDevelop[p]++;
      w.markProv(p);
    }
  }
}
