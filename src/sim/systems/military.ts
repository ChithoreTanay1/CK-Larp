import { World, NONE, ARMY_CAP, ArmyKind, WAR_CAP, P_RAIDER, P_IRON } from '../world';
import { edgeDays } from '../mapgen';
import { DEFENSE } from './economy';
import { killChar, addTrait, T, createChar } from './characters';
import { allocRealm, newDynasty, setRuler, transferProvince } from './realms';
import { fireTrigger } from '../events/runner';
import { armyAi } from '../ai/military';
import { UNITS, UNIT_COUNT, Unit, exposure, levyMix, professionalShare, raidMix, SEA_BAND_MIX, type Mix } from '../units';

const TERRAIN_MOVE = [1, 1.15, 1.4, 1, 0.95];
const TERRAIN_SIEGE = [0, 10, 20, 0, -5];
const PLAINS = 0;

export function spawnArmy(w: World, realm: number, kind: ArmyKind, loc: number, units: ArrayLike<number>): number {
  let a = NONE;
  for (let i = 0; i < ARMY_CAP; i++) if (!w.armyActive[i]) {
    a = i;
    break;
  }
  if (a < 0) return NONE;
  w.armyActive[a] = 1;
  w.armyRealm[a] = realm;
  w.armyKind[a] = kind;
  w.armyLoc[a] = loc;
  w.armyNext[a] = NONE;
  w.armyDest[a] = loc;
  w.armyProgress[a] = 0;
  w.armyLegDays[a] = 0;
  for (let u = 0; u < UNIT_COUNT; u++) w.armyUnits[a * UNIT_COUNT + u] = Math.max(0, units[u] ?? 0);
  syncMen(w, a);
  w.armyMorale[a] = 1;
  w.armyQuality[a] = armyQuality(w, realm, w.armyMen[a]);
  w.armySiege[a] = 0;
  w.armyTargetRealm[a] = NONE;
  w.armyLootGrain[a] = w.armyLootCattle[a] = w.armyLootMetal[a] = w.armyLootTrade[a] = 0;
  w.armyHome[a] = w.realmCapital[realm];
  w.armyLeader[a] = w.realmRuler[realm];
  // The ruler leads one army at a time.
  for (let b = 0; b < ARMY_CAP; b++) if (b !== a && w.armyActive[b] && w.armyLeader[b] === w.armyLeader[a]) w.armyLeader[a] = NONE;
  w.armyManual[a] = 0;
  w.armyRaids[a] = 0;
  return a;
}

/** Recompute an army's head count from its troop types. */
export function syncMen(w: World, a: number): void {
  let n = 0;
  for (let u = 0; u < UNIT_COUNT; u++) n += w.armyUnits[a * UNIT_COUNT + u];
  w.armyMen[a] = n;
}

/** Losses spread evenly over all troop types. */
export function scaleUnits(w: World, a: number, k: number): void {
  for (let u = 0; u < UNIT_COUNT; u++) w.armyUnits[a * UNIT_COUNT + u] *= k;
  syncMen(w, a);
}

export function mixUnits(men: number, mix: Mix): Mix {
  return mix.map((f) => f * men) as Mix;
}

/** Equipment quality: bronze (or iron) per soldier. Iron reduces dependence on imported tin. */
export function armyQuality(w: World, r: number, men: number): number {
  const need = (men / 1000) * 6 + 1;
  const iron = w.realmCapital[r] >= 0 ? w.p(w.realmRegion(r), P_IRON) : 0.3;
  const q = 0.45 + 0.45 * Math.min(1, w.realmMetal[r] / need) + iron * 0.25;
  return Math.min(1.15, q);
}

/** Men in all of a realm's field armies (raids excluded). */
export function fieldedMen(w: World, r: number): number {
  let n = 0;
  for (let a = 0; a < ARMY_CAP; a++) if (w.armyActive[a] && w.armyRealm[a] === r && w.armyKind[a] === ArmyKind.Host) n += w.armyMen[a];
  return n;
}

/** Men of levy types (or professional types) in a realm's field armies. */
function fieldedOf(w: World, r: number, levy: boolean): number {
  let n = 0;
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyRealm[a] !== r || w.armyKind[a] !== ArmyKind.Host) continue;
    for (let u = 0; u < UNIT_COUNT; u++) if (UNITS[u].levy === levy) n += w.armyUnits[a * UNIT_COUNT + u];
  }
  return n;
}

/** Farmers that can still be called up: the current levy limit minus levy men already in the field. */
export function availableLevy(w: World, r: number): number {
  return Math.max(0, w.realmLevy[r] * (0.3 + 0.7 * w.realmManpower[r]) - fieldedOf(w, r, true));
}

/**
 * Paid professionals (bronze warriors, chariots) don't come from the farms; they
 * are limited by cost and by a retinue the realm can keep, a share of its levy.
 */
export function retinueCap(w: World, r: number): number {
  return w.realmLevy[r] * 0.3;
}

export function availableRetinue(w: World, r: number): number {
  return Math.max(0, retinueCap(w, r) - fieldedOf(w, r, false));
}

/** Room for n more men of type u in realm r's armies. */
export function roomFor(w: World, r: number, u: number): number {
  return UNITS[u].levy ? availableLevy(w, r) : availableRetinue(w, r);
}

/** Can realm r afford n men of type u? */
export function canAfford(w: World, r: number, u: number, n: number): boolean {
  const t = UNITS[u], k = n / 100;
  return w.realmMetal[r] >= t.costMetal * k && w.realmTrade[r] >= t.costTrade * k && w.realmCattle[r] >= t.costCattle * k;
}

export function payFor(w: World, r: number, u: number, n: number): void {
  const t = UNITS[u], k = n / 100;
  w.realmMetal[r] -= t.costMetal * k;
  w.realmTrade[r] -= t.costTrade * k;
  w.realmCattle[r] -= t.costCattle * k;
}

/**
 * Call up a new host at province loc from the available levy. With professionals,
 * the realm also pays for the bronze warriors and chariots its culture favours.
 */
export function raiseNewArmy(w: World, r: number, loc: number, professionals: boolean, limit = Infinity): number {
  if (w.realmLandless[r] || loc < 0) return NONE;
  const men = Math.min(limit, availableLevy(w, r));
  if (men < 80) return NONE;
  const tags = w.content.cultureTags[w.realmCulture[r]];
  const units = mixUnits(men, levyMix(tags));
  if (professionals) {
    const share = professionalShare(tags);
    let room = availableRetinue(w, r);
    const want: [number, number][] = [
      [Unit.Heavy, share.heavy],
      [Unit.Chariot, share.chariot],
    ];
    for (const [u, f] of want) {
      // Spend at most half the treasury on professionals.
      const t = UNITS[u];
      let n = men * f;
      if (t.costMetal) n = Math.min(n, (w.realmMetal[r] * 0.5 * 100) / t.costMetal);
      if (t.costTrade) n = Math.min(n, (w.realmTrade[r] * 0.5 * 100) / t.costTrade);
      if (t.costCattle) n = Math.min(n, (w.realmCattle[r] * 0.5 * 100) / t.costCattle);
      n = Math.floor(Math.min(n, room) / 10) * 10;
      if (n < 20) continue;
      payFor(w, r, u, n);
      units[u] += n;
      room -= n;
    }
  }
  const a = spawnArmy(w, r, ArmyKind.Host, loc, units);
  if (a >= 0 && (w.realmArmy[r] < 0 || !w.armyActive[w.realmArmy[r]])) w.realmArmy[r] = a;
  return a;
}

/** Make sure the realm has its main army in the field (AI and war call-ups). */
export function raiseArmy(w: World, r: number): number {
  const existing = w.realmArmy[r];
  if (existing >= 0 && w.armyActive[existing]) return existing;
  if (w.realmLandless[r] || w.realmCapital[r] < 0) return NONE;
  return raiseNewArmy(w, r, w.realmCapital[r], r !== w.player);
}

export function disbandArmy(w: World, a: number): void {
  w.armyActive[a] = 0;
  const r = w.armyRealm[a];
  if (r >= 0 && w.realmArmy[r] === a) {
    w.realmArmy[r] = NONE;
    // Another host of the same realm becomes the main army.
    for (let b = 0; b < ARMY_CAP; b++) {
      if (w.armyActive[b] && w.armyRealm[b] === r && w.armyKind[b] === ArmyKind.Host) {
        w.realmArmy[r] = b;
        break;
      }
    }
  }
}

/** Split men off army a into a new army in the same place. take[u] = men of each type. */
export function splitArmy(w: World, a: number, take: ArrayLike<number>): number {
  const units = new Array<number>(UNIT_COUNT).fill(0);
  for (let u = 0; u < UNIT_COUNT; u++) units[u] = Math.max(0, Math.min(take[u] ?? 0, w.armyUnits[a * UNIT_COUNT + u]));
  const b = spawnArmy(w, w.armyRealm[a], w.armyKind[a], w.armyLoc[a], units);
  if (b < 0) return NONE;
  for (let u = 0; u < UNIT_COUNT; u++) w.armyUnits[a * UNIT_COUNT + u] -= units[u];
  syncMen(w, a);
  w.armyQuality[b] = w.armyQuality[a];
  w.armyMorale[b] = w.armyMorale[a];
  w.armyHome[b] = w.armyHome[a];
  w.armyLeader[b] = NONE;
  w.armyManual[b] = w.armyManual[a];
  if (w.armyMen[a] < 1) disbandArmy(w, a);
  return b;
}

/** Fold army b into army a. */
export function mergeArmies(w: World, a: number, b: number): void {
  const na = w.armyMen[a], nb = w.armyMen[b], n = Math.max(1, na + nb);
  w.armyQuality[a] = (w.armyQuality[a] * na + w.armyQuality[b] * nb) / n;
  w.armyMorale[a] = (w.armyMorale[a] * na + w.armyMorale[b] * nb) / n;
  for (let u = 0; u < UNIT_COUNT; u++) w.armyUnits[a * UNIT_COUNT + u] += w.armyUnits[b * UNIT_COUNT + u];
  syncMen(w, a);
  const la = w.armyLeader[a], lb = w.armyLeader[b];
  if ((la < 0 || !w.charAlive[la]) && lb >= 0 && w.charAlive[lb]) w.armyLeader[a] = lb;
  else if (la >= 0 && lb >= 0 && w.charAlive[lb] && w.charMartial[lb] > w.charMartial[la]) w.armyLeader[a] = lb;
  disbandArmy(w, b);
}

export function setDest(w: World, a: number, dest: number): void {
  w.armyDest[a] = dest;
  if (w.armyNext[a] < 0 && w.armyLoc[a] !== dest) stepToward(w, a);
}

/** Travel-time multiplier: the slowest troop type with a real presence sets the pace. */
export function armyPace(w: World, a: number): number {
  const men = Math.max(1, w.armyMen[a]);
  let pace = 0.75;
  for (let u = 0; u < UNIT_COUNT; u++) if (w.armyUnits[a * UNIT_COUNT + u] / men > 0.03 && UNITS[u].pace > pace) pace = UNITS[u].pace;
  return pace;
}

function stepToward(w: World, a: number): void {
  const loc = w.armyLoc[a], dest = w.armyDest[a];
  const n = w.map.nextHop[dest * w.P + loc];
  if (n < 0 || n === loc) {
    w.armyDest[a] = loc;
    return;
  }
  w.armyNext[a] = n;
  w.armyProgress[a] = 0;
  w.armySiege[a] = 0;
  let days = edgeDays(w.map, loc, n) * TERRAIN_MOVE[w.provTerrain[n]] * armyPace(w, a);
  if (w.armyKind[a] !== ArmyKind.Host) days *= 0.7;
  w.armyLegDays[a] = days;
}

export interface CombatPower {
  power: number;
  melee: number;
  ranged: number;
  shock: number;
}

/**
 * Fighting power of army a on terrain terr. Spears and heavy infantry in the enemy
 * army screen against chariot charges; with no enemy given, assume a typical screen.
 */
export function combatPower(w: World, a: number, enemy: number, terr: number): CombatPower {
  let screen = 0.45;
  if (enemy >= 0) {
    screen = 0;
    const em = Math.max(1, w.armyMen[enemy]);
    for (let u = 0; u < UNIT_COUNT; u++) screen += (w.armyUnits[enemy * UNIT_COUNT + u] / em) * UNITS[u].screen;
  }
  let melee = 0, ranged = 0, shock = 0;
  for (let u = 0; u < UNIT_COUNT; u++) {
    const n = w.armyUnits[a * UNIT_COUNT + u];
    if (n <= 0) continue;
    const t = UNITS[u], k = t.terrain[terr];
    melee += n * t.melee * k;
    ranged += n * t.ranged * k;
    shock += n * t.shock * k;
  }
  shock *= 1 - 0.75 * Math.min(1, screen);
  ranged *= 0.7;
  const leader = w.armyLeader[a];
  const mart = leader >= 0 && w.charAlive[leader] ? w.charMartial[leader] : 4;
  let k = w.armyQuality[a] * w.armyMorale[a] * (1 + 0.04 * mart);
  if (w.armyKind[a] === ArmyKind.SeaBand) k *= 1.15;
  return { power: (melee + ranged + shock) * k, melee: melee * k, ranged: ranged * k, shock: shock * k };
}

/** Rough fighting power for planning (open ground, typical enemy). */
export function armyPower(w: World, a: number): number {
  return combatPower(w, a, NONE, PLAINS).power;
}

/** Spread losses over troop types by exposure and armor. Returns men actually lost. */
function applyLosses(w: World, a: number, loss: number, won: boolean): number {
  let total = 0;
  for (let u = 0; u < UNIT_COUNT; u++) total += w.armyUnits[a * UNIT_COUNT + u] * exposure(u, won);
  if (total <= 0) return 0;
  let lost = 0;
  for (let u = 0; u < UNIT_COUNT; u++) {
    const i = a * UNIT_COUNT + u;
    const l = Math.min(w.armyUnits[i], (loss * w.armyUnits[i] * exposure(u, won)) / total);
    w.armyUnits[i] -= l;
    lost += l;
  }
  syncMen(w, a);
  return lost;
}

/** Would armies a and b fight if they met? */
export function armiesHostile(w: World, a: number, b: number): boolean {
  const ra = w.top(w.armyRealm[a]), rb = w.top(w.armyRealm[b]);
  if (ra === rb) return false;
  if (w.armyKind[a] === ArmyKind.SeaBand || w.armyKind[b] === ArmyKind.SeaBand) return true;
  if (w.armyKind[a] === ArmyKind.Raid && w.armyTargetRealm[a] === rb) return true;
  if (w.armyKind[b] === ArmyKind.Raid && w.armyTargetRealm[b] === ra) return true;
  return w.hostile[ra * w.R + rb] === 1;
}

export function launchRaid(w: World, r: number, target: number): number {
  const cap = w.realmCapital[r];
  if (cap < 0) return NONE;
  const men = Math.max(150, w.realmLevy[r] * 0.22 * (0.3 + 0.7 * w.realmManpower[r]));
  const a = spawnArmy(w, r, ArmyKind.Raid, cap, mixUnits(men, raidMix(w.content.cultureTags[w.realmCulture[r]])));
  if (a < 0) return NONE;
  const owner = w.provOwner[target];
  w.armyTargetRealm[a] = owner >= 0 ? w.top(owner) : NONE;
  w.armyHome[a] = cap;
  w.realmRaidReady[r] = w.day + 240;
  setDest(w, a, target);
  const tname = w.scenario.provinces[target].name;
  if (owner >= 0 && w.concernsPlayer(owner)) w.addLog('bad', `Raiders from ${w.realmName[r]} are moving on ${tname}!`, target);
  return a;
}

function totalPop(w: World, r: number): number {
  let s = 0;
  for (let p = 0; p < w.P; p++) if (w.provOwner[p] === r) s += w.provPop[p];
  return s;
}

/** A raid party or sea band strikes province p. Returns true on success. */
function resolveRaid(w: World, a: number, p: number): boolean {
  const o = w.provOwner[p];
  w.armyRaids[a]++;
  if (o < 0) return false;
  const raider = w.top(w.armyRealm[a]);
  const victim = w.top(o);
  if (victim === raider) return false;
  const reg = w.provRegion[p];
  w.regionRaids[reg]++;
  const pname = w.scenario.provinces[p].name;
  const defense = w.provPop[p] * 28 * (0.8 + 0.08 * w.provDevelop[p]) * DEFENSE[w.provTerrain[p]] * (0.6 + 0.4 * (w.realmStability[o] / 100));
  const attack = combatPower(w, a, NONE, w.provTerrain[p]).power * (0.7 + 0.6 * w.rng.next());
  const success = attack > defense * (0.6 + 0.8 * w.rng.next());
  const isBand = w.armyKind[a] === ArmyKind.SeaBand;
  if (success) {
    const carry = w.armyMen[a] * 0.06;
    const share = Math.min(1, w.provPop[p] / Math.max(1, totalPop(w, o)));
    const g = Math.min(carry, w.realmGrain[o] * share * 1.5 + w.provGrainOut[p] * 2);
    const c = Math.min(carry, w.realmCattle[o] * share * 1.5 + w.provCattleOut[p] * 3);
    const m = Math.min(carry * 0.2, w.realmMetal[o] * share);
    const t = Math.min(carry * 0.5, w.realmTrade[o] * share);
    w.realmGrain[o] = Math.max(0, w.realmGrain[o] - g);
    w.realmCattle[o] = Math.max(0, w.realmCattle[o] - c);
    w.realmMetal[o] = Math.max(0, w.realmMetal[o] - m);
    w.realmTrade[o] = Math.max(0, w.realmTrade[o] - t);
    w.armyLootGrain[a] += g;
    w.armyLootCattle[a] += c;
    w.armyLootMetal[a] += m;
    w.armyLootTrade[a] += t;
    w.provRaided[p] = 6;
    w.provPop[p] *= 0.97;
    w.provUnrest[p] = Math.min(100, w.provUnrest[p] + 10);
    w.markProv(p);
    w.addOpinion(victim, raider, -25);
    scaleUnits(w, a, 0.95);
    w.realmPrestige[victim] = Math.max(0, w.realmPrestige[victim] - 2);
    if (w.concernsPlayer(o)) {
      w.addLog('bad', `${isBand ? 'Sea raiders' : w.realmName[raider] + ' raiders'} have sacked ${pname}!`, p);
      if (w.top(w.player) === victim) fireTrigger(w, 'on_raided', w.player, raider, NONE, p);
    } else if (w.concernsPlayer(raider)) {
      w.addLog('good', `Our raiders have sacked ${pname} and are bringing the loot home.`, p);
      fireTrigger(w, 'on_raid_success', w.player, victim, NONE, p);
    } else if (isBand && w.player !== NONE && w.isFullDetail(o)) {
      w.addLog('world', `The ${w.realmName[raider]} have sacked ${pname}.`, p);
    } else if (w.isFullDetail(o) && w.rng.chance(0.3)) {
      fireTrigger(w, 'on_raided', victim, raider, NONE, p);
    }
  } else {
    scaleUnits(w, a, 0.55 + 0.15 * w.rng.next());
    w.realmPrestige[raider] = Math.max(0, w.realmPrestige[raider] - 3);
    w.realmPrestige[victim] += 2;
    if (w.concernsPlayer(o)) w.addLog('good', `The people of ${pname} drove off the ${isBand ? 'sea raiders' : 'raiders of ' + w.realmName[raider]}.`, p);
    else if (w.concernsPlayer(raider)) w.addLog('bad', `Our raid on ${pname} was beaten back.`, p);
  }
  return success;
}

/** A sea band that won may put down roots and found a new kingdom. */
function trySettle(w: World, a: number, p: number): boolean {
  const band = w.armyRealm[a];
  const o = w.provOwner[p];
  if (o < 0) return false;
  const rp = w.p(w.provRegion[p], P_RAIDER);
  const isCapital = w.realmCapital[o] === p;
  const chance = isCapital ? 0.03 : 0.1 + rp * 0.25;
  if (!w.rng.chance(chance)) return false;
  const pname = w.scenario.provinces[p].name;
  const oldName = w.realmName[w.top(o)];
  transferProvince(w, p, band);
  w.realmCapital[band] = p;
  w.realmLandless[band] = 0;
  w.realmGrain[band] = 30 + w.armyLootGrain[a];
  w.realmCattle[band] = 10 + w.armyLootCattle[a];
  w.realmMetal[band] = 5 + w.armyLootMetal[a];
  w.realmTrade[band] = 5 + w.armyLootTrade[a];
  w.realmStability[band] = 40;
  w.realmManpower[band] = 0.5;
  w.provPop[p] *= 0.9;
  w.setP(w.provRegion[p], P_RAIDER, rp - 0.04);
  disbandArmy(w, a);
  w.addLog(w.concernsPlayer(o) ? 'bad' : 'world', `The ${w.realmName[band]} have seized ${pname} from ${oldName} and settled there.`, p);
  return true;
}

function bandNext(w: World, a: number): void {
  if (w.armyRaids[a] >= 3 || w.armyMen[a] < 200) {
    disbandArmy(w, a);
    return;
  }
  const loc = w.armyLoc[a];
  const m = w.map;
  let best = NONE, bestScore = -1;
  for (let e = m.adjOffset[loc]; e < m.adjOffset[loc + 1]; e++) {
    const q = m.adj[e];
    if (!m.coastal[q] || w.provOwner[q] < 0 || w.top(w.provOwner[q]) === w.armyRealm[a]) continue;
    const s = w.provDevelop[q] + w.rng.next() * 3 - (w.provRaided[q] > 0 ? 3 : 0);
    if (s > bestScore) {
      bestScore = s;
      best = q;
    }
  }
  if (best < 0) disbandArmy(w, a);
  else setDest(w, a, best);
}

function arrived(w: World, a: number): void {
  const loc = w.armyLoc[a];
  const kind = w.armyKind[a];
  if (kind === ArmyKind.Raid) {
    if (w.armyRaids[a] === 0 && loc === w.armyDest[a]) {
      resolveRaid(w, a, loc);
      const home = w.realmCapital[w.armyRealm[a]];
      if (home < 0) disbandArmy(w, a);
      else {
        w.armyHome[a] = home;
        setDest(w, a, home);
      }
    } else if (w.armyRaids[a] > 0 && loc === w.armyHome[a]) {
      const r = w.armyRealm[a];
      w.realmGrain[r] += w.armyLootGrain[a];
      w.realmCattle[r] += w.armyLootCattle[a];
      w.realmMetal[r] += w.armyLootMetal[a];
      w.realmTrade[r] += w.armyLootTrade[a];
      if (w.armyLootGrain[a] + w.armyLootCattle[a] > 5) w.realmPrestige[r] += 3;
      if (r === w.player) {
        w.addLog('good', `The raiders are home with ${Math.round(w.armyLootGrain[a])} grain, ${Math.round(w.armyLootCattle[a])} cattle, ${Math.round(w.armyLootMetal[a])} metal and ${Math.round(w.armyLootTrade[a])} goods.`);
      }
      disbandArmy(w, a);
    }
  } else if (kind === ArmyKind.SeaBand) {
    if (loc === w.armyDest[a]) {
      const ok = resolveRaid(w, a, loc);
      if (!(ok && trySettle(w, a, loc)) && w.armyActive[a]) bandNext(w, a);
    }
  } else {
    // Host army: liberate our own occupied land.
    const o = w.provOwner[loc];
    if (o >= 0 && w.top(o) === w.top(w.armyRealm[a]) && w.provOccupier[loc] >= 0) {
      w.provOccupier[loc] = NONE;
      w.markProv(loc);
    }
  }
}

function battle(w: World, a: number, b: number): void {
  const loc = w.armyLoc[a];
  const terr = w.provTerrain[loc];
  const ca = combatPower(w, a, b, terr), cb = combatPower(w, b, a, terr);
  let pa = ca.power, pb = cb.power;
  const owner = w.provOwner[loc];
  const ownerTop = owner >= 0 ? w.top(owner) : NONE;
  const def = DEFENSE[w.provTerrain[loc]];
  if (ownerTop === w.top(w.armyRealm[a])) pa *= def;
  if (ownerTop === w.top(w.armyRealm[b])) pb *= def;
  const ra = pa * (0.75 + 0.5 * w.rng.next());
  const rb = pb * (0.75 + 0.5 * w.rng.next());
  const win = ra >= rb ? a : b, lose = win === a ? b : a;
  const ratio = Math.min(ra, rb) / Math.max(ra, rb, 1);
  const lossL = applyLosses(w, lose, w.armyMen[lose] * (0.3 + 0.35 * (1 - ratio) * w.rng.next()), false);
  const lossW = applyLosses(w, win, w.armyMen[win] * (0.05 + 0.15 * ratio * w.rng.next()), true);
  w.armyMorale[win] = Math.min(1, w.armyMorale[win] + 0.1);
  w.armyMorale[lose] = Math.max(0.2, w.armyMorale[lose] - 0.3);
  const rw = w.top(w.armyRealm[win]), rl = w.top(w.armyRealm[lose]);
  if (w.armyKind[win] === ArmyKind.Host && w.realmLevy[rw] > 0) w.realmManpower[rw] = Math.max(0, w.realmManpower[rw] - lossW / w.realmLevy[rw]);
  if (w.armyKind[lose] === ArmyKind.Host && w.realmLevy[rl] > 0) w.realmManpower[rl] = Math.max(0, w.realmManpower[rl] - lossL / w.realmLevy[rl]);
  w.provPop[loc] *= 0.99;
  w.realmPrestige[rw] += 3;
  w.realmPrestige[rl] = Math.max(0, w.realmPrestige[rl] - 3);

  // Commanders can fall.
  const lead = w.armyLeader[lose];
  if (lead >= 0 && w.charAlive[lead]) {
    const roll = w.rng.next();
    if (roll < 0.04) killChar(w, lead, 'battle');
    else if (roll < 0.12) addTrait(w, lead, T.wounded);
  }

  for (let war = 0; war < WAR_CAP; war++) {
    if (!w.warActive[war]) continue;
    const sw = w.warSide[war * w.R + rw], sl = w.warSide[war * w.R + rl];
    if (!sw || !sl || sw === sl) continue;
    const delta = 6 + (30 * lossL) / (lossL + w.armyMen[lose] + 1);
    const nb = w.warBattle[war] + (sw === 1 ? delta : -delta);
    w.warBattle[war] = nb > 60 ? 60 : nb < -60 ? -60 : nb;
  }

  const pname = w.scenario.provinces[loc].name;
  const playerTop = w.player !== NONE ? w.top(w.player) : NONE;
  if (rw === playerTop || rl === playerTop) {
    const won = rw === playerTop;
    const cw = win === a ? ca : cb;
    const how = cw.shock > cw.power * 0.3 ? ' The chariots broke the line.' : cw.ranged > cw.power * 0.35 ? ' The archers decided the day.' : '';
    w.addLog(won ? 'good' : 'bad', `Battle of ${pname}: ${won ? 'victory' : 'defeat'} against ${w.realmName[won ? rl : rw]}. We lost ${Math.round(won ? lossW : lossL)} men, they lost ${Math.round(won ? lossL : lossW)}.${how}`, loc);
    fireTrigger(w, won ? 'on_battle_won' : 'on_battle_lost', w.player, won ? rl : rw, NONE, loc);
  } else if (w.player !== NONE && w.isFullDetail(rw) && lossL + lossW > 800) {
    w.addLog('war', `${w.realmName[rw]} defeats ${w.realmName[rl]} at ${pname}.`, loc);
  }

  // The loser falls back or breaks.
  if (w.armyMen[lose] < 60 || w.armyKind[lose] !== ArmyKind.Host) {
    if (w.armyKind[lose] !== ArmyKind.Host || w.armyMen[lose] < 60) disbandArmy(w, lose);
  } else {
    let home = w.realmCapital[rl];
    if (home < 0 || home === loc) home = w.armyHome[lose];
    w.armyManual[lose] = 0;
    if (home >= 0 && home !== loc) setDest(w, lose, home);
    else {
      // Cornered at home: retreat to any friendly neighbor.
      const m = w.map;
      for (let e = m.adjOffset[loc]; e < m.adjOffset[loc + 1]; e++) {
        const q = m.adj[e];
        if (w.provOwner[q] >= 0 && w.top(w.provOwner[q]) === rl) {
          setDest(w, lose, q);
          break;
        }
      }
    }
  }
}

/** Siege progress needed to take province p. */
export function siegeNeed(w: World, p: number): number {
  const o = w.provOwner[p];
  return 20 + w.provDevelop[p] * 8 + TERRAIN_SIEGE[w.provTerrain[p]] + (o >= 0 && w.realmCapital[o] === p ? 15 : 0);
}

function siegeDaily(w: World, a: number): void {
  const loc = w.armyLoc[a];
  const o = w.provOwner[loc];
  if (o < 0) return;
  const mine = w.top(w.armyRealm[a]);
  const ot = w.top(o);
  if (ot === mine || w.hostile[mine * w.R + ot] !== 1) return;
  const occ = w.provOccupier[loc];
  if (occ >= 0 && (occ === mine || w.hostile[mine * w.R + occ] !== 1)) return;
  if (w.armyMen[a] < 250) return;
  // Can't besiege with an enemy army in the field here.
  for (let b = 0; b < ARMY_CAP; b++) {
    if (b !== a && w.armyActive[b] && w.armyLoc[b] === loc && w.armyNext[b] < 0 && armiesHostile(w, a, b)) return;
  }
  const need = siegeNeed(w, loc);
  let work = 0;
  for (let u = 0; u < UNIT_COUNT; u++) work += w.armyUnits[a * UNIT_COUNT + u] * UNITS[u].siege;
  // A typical levy (mostly spears, some bows and slings) does ~0.87 work per man.
  w.armySiege[a] += Math.min(2, work / 1300);
  if (w.armySiege[a] >= need) {
    w.armySiege[a] = 0;
    w.provOccupier[loc] = mine;
    w.provRaided[loc] = Math.max(w.provRaided[loc], 3);
    w.markProv(loc);
    const pname = w.scenario.provinces[loc].name;
    if (w.concernsPlayer(mine)) w.addLog('good', `${pname} has fallen to our siege.`, loc);
    else if (w.concernsPlayer(o)) w.addLog('bad', `${pname} has fallen to the army of ${w.realmName[mine]}.`, loc);
  }
}

/** Daily: move armies, resolve battles and sieges, and let idle armies think. */
export function armiesDaily(w: World): void {
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a]) continue;
    if (w.armyNext[a] >= 0) {
      w.armyProgress[a] += 1;
      if (w.armyProgress[a] >= w.armyLegDays[a]) {
        w.armyLoc[a] = w.armyNext[a];
        w.armyNext[a] = NONE;
        w.armyProgress[a] = 0;
        arrived(w, a);
        if (!w.armyActive[a]) continue;
      }
    }
    if (w.armyNext[a] < 0 && w.armyLoc[a] !== w.armyDest[a]) stepToward(w, a);
  }
  // Battles between stationary hostile armies in the same province.
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyNext[a] >= 0) continue;
    for (let b = a + 1; b < ARMY_CAP; b++) {
      if (!w.armyActive[b] || w.armyNext[b] >= 0 || w.armyLoc[b] !== w.armyLoc[a]) continue;
      if (armiesHostile(w, a, b)) {
        battle(w, a, b);
        if (!w.armyActive[a] || w.armyNext[a] >= 0) break;
      }
    }
  }
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a]) continue;
    if (w.armyKind[a] === ArmyKind.Host) {
      if (w.armyNext[a] < 0) siegeDaily(w, a);
      if ((a + w.day) % 7 === 0 || (w.armyNext[a] < 0 && w.armyLoc[a] === w.armyDest[a] && w.armySiege[a] === 0)) armyAi(w, a);
    }
  }
}

/** Monthly: the Sea Peoples come where raider pressure is high. */
export function seaPeoplesMonthly(w: World): void {
  for (let reg = 0; reg < w.regionCount; reg++) {
    if (w.regionDetail[reg] !== 1) continue;
    const rp = w.p(reg, P_RAIDER);
    if (!w.rng.chance(Math.max(0, rp - 0.35) * 0.15)) continue;
    // Pick a coastal target in the region.
    let target = NONE, best = -1;
    for (let k = 0; k < 12; k++) {
      const p = w.rng.int(w.P);
      if (w.provRegion[p] !== reg || !w.map.coastal[p] || w.provOwner[p] < 0) continue;
      const s = w.provDevelop[p] + w.map.coastal[p] + w.rng.next() * 2;
      if (s > best) {
        best = s;
        target = p;
      }
    }
    if (target >= 0) spawnSeaBandAt(w, target);
  }
}

/** Land a sea-raider band at province p; it raids on arrival. */
export function spawnSeaBandAt(w: World, target: number): number {
  const band = bandRealm(w);
  if (band < 0) return NONE;
  const rp = w.p(w.provRegion[target], P_RAIDER);
  const men = 450 + rp * 1300 + w.rng.next() * 300;
  const a = spawnArmy(w, band, ArmyKind.SeaBand, target, mixUnits(men, SEA_BAND_MIX));
  if (a < 0) return NONE;
  w.armyQuality[a] = 0.85;
  w.armyHome[a] = NONE;
  if (w.player !== NONE && w.provOwner[target] >= 0 && w.concernsPlayer(w.provOwner[target])) {
    w.addLog('bad', `Ships on the horizon! The ${w.realmName[band]} have landed at ${w.scenario.provinces[target].name}.`, target);
  }
  arrived(w, a);
  return a;
}

/** A landless sea-raider realm without a band at sea, creating one if needed. */
function bandRealm(w: World): number {
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r] || !w.realmLandless[r]) continue;
    let busy = false;
    for (let a = 0; a < ARMY_CAP; a++) if (w.armyActive[a] && w.armyRealm[a] === r) busy = true;
    if (!busy) return r;
  }
  let landless = 0;
  for (let r = 0; r < w.R; r++) if (w.realmAlive[r] && w.realmLandless[r]) landless++;
  if (landless >= 3) return NONE;
  const names = w.scenario.raiders;
  const pick = names[w.rng.int(names.length)];
  const culture = w.content.cultureIdx.get(pick.culture) ?? 0;
  let name = pick.name;
  for (let r = 0; r < w.R; r++) if (w.realmAlive[r] && w.realmName[r] === name) name = `${pick.name} of the ${w.rng.pick(['Isles', 'West', 'Black Ships', 'North Wind', 'Horned Helm'])}`;
  const r = allocRealm(w, name, culture, w.content.cultureLaw[culture]);
  w.realmLandless[r] = 1;
  w.realmGrain[r] = 0;
  const leader = createChar(w, { culture, female: false, age: 25 + w.rng.int(15), dynasty: NONE, realm: r });
  w.charDynasty[leader] = newDynasty(w, culture);
  setRuler(w, r, leader);
  return r;
}
