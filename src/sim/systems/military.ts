import { World, NONE, ARMY_CAP, BATTLE_CAP, ArmyKind, WAR_CAP, P_RAIDER, P_IRON } from '../world';
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
/** Siege work each fort level adds. */
const FORT_SIEGE = 45;
/** Days a beaten army falls back without being caught. */
const ROUT_DAYS = 15;
/** Most war score battles alone can give: short of the 40 that wins a war against a broken enemy. */
const BATTLE_SCORE_CAP = 35;

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
  w.armyBattle[a] = NONE;
  w.armyRout[a] = 0;
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
  if (a >= 0 && r === w.player) w.armyManual[a] = 1;
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
  const defense = w.provPop[p] * 28 * (0.8 + 0.08 * w.provDevelop[p]) * DEFENSE[w.provTerrain[p]] * (0.6 + 0.4 * (w.realmStability[o] / 100)) * (1 + 0.4 * w.provFort[p]);
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

/** A beaten army falling back: it slips past enemies until it has regrouped. */
export function routed(w: World, a: number): boolean {
  return w.day < w.armyRout[a];
}

/** Is there an army hostile to a standing (or fighting) in province p? */
function hostileAt(w: World, a: number, p: number): boolean {
  if (routed(w, a)) return false;
  for (let b = 0; b < ARMY_CAP; b++) {
    if (b === a || !w.armyActive[b] || w.armyLoc[b] !== p || w.armyNext[b] >= 0 || routed(w, b)) continue;
    if (armiesHostile(w, a, b)) return true;
  }
  return false;
}

/** Fighting strength in a battle at loc, including home ground and walls. */
function battlePower(w: World, a: number, enemy: number, loc: number): CombatPower {
  const c = combatPower(w, a, enemy, w.provTerrain[loc]);
  const owner = w.provOwner[loc];
  if (owner >= 0 && w.top(owner) === w.top(w.armyRealm[a])) {
    const k = DEFENSE[w.provTerrain[loc]] * (1 + 0.1 * w.provFort[loc]);
    c.power *= k;
    c.melee *= k;
    c.ranged *= k;
    c.shock *= k;
  }
  return c;
}

/** Two hostile armies in one province join battle. a is the side that came on. */
export function startBattle(w: World, a: number, b: number): number {
  let bt = NONE;
  for (let i = 0; i < BATTLE_CAP; i++) if (!w.battleActive[i]) {
    bt = i;
    break;
  }
  if (bt < 0) return NONE;
  // An army defending its own land is the defender.
  const loc = w.armyLoc[a];
  const owner = w.provOwner[loc];
  if (owner >= 0 && w.top(owner) === w.top(w.armyRealm[a]) && w.top(owner) !== w.top(w.armyRealm[b])) [a, b] = [b, a];
  w.battleActive[bt] = 1;
  w.battleLoc[bt] = loc;
  w.battleAtt[bt] = a;
  w.battleDef[bt] = b;
  w.battleDay[bt] = 0;
  w.battleAttStart[bt] = w.armyMen[a];
  w.battleDefStart[bt] = w.armyMen[b];
  w.battleAttLoss[bt] = 0;
  w.battleDefLoss[bt] = 0;
  w.battleShare[bt] = 0.5;
  w.battleLuckAtt[bt] = 0.7 + 0.6 * w.rng.next();
  w.battleLuckDef[bt] = 0.7 + 0.6 * w.rng.next();
  w.armyBattle[a] = bt;
  w.armyBattle[b] = bt;
  w.armySiege[a] = 0;
  w.armySiege[b] = 0;
  const playerTop = w.player !== NONE ? w.top(w.player) : NONE;
  const ra = w.top(w.armyRealm[a]), rb = w.top(w.armyRealm[b]);
  if (ra === playerTop || rb === playerTop) {
    const enemy = ra === playerTop ? b : a;
    const name = w.armyKind[enemy] === ArmyKind.Host ? w.realmName[w.top(w.armyRealm[enemy])] : w.armyKind[enemy] === ArmyKind.Raid ? `raiders of ${w.realmName[w.armyRealm[enemy]]}` : `the ${w.realmName[w.armyRealm[enemy]]}`;
    w.addLog('war', `Battle of ${w.scenario.provinces[loc].name}! Our ${Math.round(w.armyMen[enemy === a ? b : a])} men have met ${Math.round(w.armyMen[enemy])} of ${name}.`, loc);
  }
  return bt;
}

/** One day of fighting: both sides bleed men and morale until one breaks. */
function battleDaily(w: World, bt: number): void {
  const a = w.battleAtt[bt], b = w.battleDef[bt];
  const aAlive = w.armyActive[a] === 1 && w.armyBattle[a] === bt;
  const bAlive = w.armyActive[b] === 1 && w.armyBattle[b] === bt;
  if (!aAlive || !bAlive || !armiesHostile(w, a, b)) {
    // An army vanished (disbanded, or peace was made): the fight just stops.
    closeBattle(w, bt);
    return;
  }
  const loc = w.battleLoc[bt];
  const pa = battlePower(w, a, b, loc).power, pb = battlePower(w, b, a, loc).power;
  const ra = pa * w.battleLuckAtt[bt] * (0.85 + 0.3 * w.rng.next());
  const rb = pb * w.battleLuckDef[bt] * (0.85 + 0.3 * w.rng.next());
  const share = ra / Math.max(1, ra + rb);
  w.battleShare[bt] = share;
  const fracA = 0.08 * (1 - share) * (1 - share);
  const fracB = 0.08 * share * share;
  const la = applyLosses(w, a, w.armyMen[a] * fracA, share >= 0.5);
  const lb = applyLosses(w, b, w.armyMen[b] * fracB, share < 0.5);
  w.battleAttLoss[bt] += la;
  w.battleDefLoss[bt] += lb;
  drainManpower(w, a, la);
  drainManpower(w, b, lb);
  w.armyMorale[a] = Math.max(0, w.armyMorale[a] - fracA * 2 - (share < 0.45 ? 0.03 : 0));
  w.armyMorale[b] = Math.max(0, w.armyMorale[b] - fracB * 2 - (share > 0.55 ? 0.03 : 0));
  w.battleDay[bt]++;
  const aBroken = w.armyMorale[a] <= 0.3 || w.armyMen[a] < w.battleAttStart[bt] * 0.25;
  const bBroken = w.armyMorale[b] <= 0.3 || w.armyMen[b] < w.battleDefStart[bt] * 0.25;
  if (aBroken || bBroken || w.battleDay[bt] >= 14) {
    const aWins = aBroken !== bBroken ? bBroken : share >= 0.5;
    endBattle(w, bt, aWins ? a : b, false);
  }
}

function drainManpower(w: World, a: number, lost: number): void {
  if (w.armyKind[a] !== ArmyKind.Host) return;
  const r = w.top(w.armyRealm[a]);
  if (w.realmLevy[r] > 0) w.realmManpower[r] = Math.max(0, w.realmManpower[r] - lost / w.realmLevy[r]);
}

function closeBattle(w: World, bt: number): void {
  const a = w.battleAtt[bt], b = w.battleDef[bt];
  if (w.armyBattle[a] === bt) w.armyBattle[a] = NONE;
  if (w.armyBattle[b] === bt) w.armyBattle[b] = NONE;
  w.battleActive[bt] = 0;
}

/** Order army a (in battle) to fall back. The enemy wins, but the pursuit is lighter. */
export function retreatFromBattle(w: World, a: number): boolean {
  const bt = w.armyBattle[a];
  if (bt < 0 || !w.battleActive[bt]) return false;
  const other = w.battleAtt[bt] === a ? w.battleDef[bt] : w.battleAtt[bt];
  endBattle(w, bt, other, true);
  return true;
}

/** The loser breaks: pursuit (chariots ride the fleeing down), renown, commanders, war score, retreat. */
function endBattle(w: World, bt: number, win: number, retreated: boolean): void {
  const lose = w.battleAtt[bt] === win ? w.battleDef[bt] : w.battleAtt[bt];
  const loc = w.battleLoc[bt];
  const cw = battlePower(w, win, lose, loc);
  const shockShare = cw.shock / Math.max(1, cw.power);
  const pursuit = applyLosses(w, lose, w.armyMen[lose] * (0.06 + 0.25 * shockShare) * (retreated ? 0.5 : 1) * (0.7 + 0.6 * w.rng.next()), false);
  drainManpower(w, lose, pursuit);
  const winIsAtt = w.battleAtt[bt] === win;
  const lossW = winIsAtt ? w.battleAttLoss[bt] : w.battleDefLoss[bt];
  const lossL = (winIsAtt ? w.battleDefLoss[bt] : w.battleAttLoss[bt]) + pursuit;
  const days = w.battleDay[bt];
  closeBattle(w, bt);

  w.armyMorale[win] = Math.min(1, w.armyMorale[win] + 0.15);
  w.armyMorale[lose] = Math.max(0.2, w.armyMorale[lose]);
  w.armyRout[lose] = w.day + ROUT_DAYS;
  w.armyRout[win] = 0;
  const rw = w.top(w.armyRealm[win]), rl = w.top(w.armyRealm[lose]);
  w.provPop[loc] *= 0.99;
  w.realmPrestige[rw] += 3;
  w.realmPrestige[rl] = Math.max(0, w.realmPrestige[rl] - 3);

  // Commanders can fall.
  const lead = w.armyLeader[lose];
  if (lead >= 0 && w.charAlive[lead]) {
    const roll = w.rng.next();
    if (roll < (retreated ? 0.02 : 0.05)) killChar(w, lead, 'battle');
    else if (roll < 0.14) addTrait(w, lead, T.wounded);
  }

  for (let war = 0; war < WAR_CAP; war++) {
    if (!w.warActive[war]) continue;
    const sw = w.warSide[war * w.R + rw], sl = w.warSide[war * w.R + rl];
    if (!sw || !sl || sw === sl) continue;
    // Battles weaken the enemy, but land wins wars: battles alone can carry the score only so far.
    const delta = 4 + (22 * lossL) / (lossL + w.armyMen[lose] + 1);
    const nb = w.warBattle[war] + (sw === 1 ? delta : -delta);
    w.warBattle[war] = nb > BATTLE_SCORE_CAP ? BATTLE_SCORE_CAP : nb < -BATTLE_SCORE_CAP ? -BATTLE_SCORE_CAP : nb;
  }

  const pname = w.scenario.provinces[loc].name;
  const playerTop = w.player !== NONE ? w.top(w.player) : NONE;
  if (rw === playerTop || rl === playerTop) {
    const won = rw === playerTop;
    const how = retreated ? (won ? ' The enemy fled the field.' : ' We fell back in good order.') : shockShare > 0.3 ? ' The chariots broke the line.' : cw.ranged > cw.power * 0.35 ? ' The archers decided the day.' : '';
    const text = `Battle of ${pname}: ${won ? 'victory' : 'defeat'} against ${w.realmName[won ? rl : rw]} after ${days} day${days === 1 ? '' : 's'}. We lost ${Math.round(won ? lossW : lossL)} men, they lost ${Math.round(won ? lossL : lossW)}.${how}`;
    w.addLog(won ? 'good' : 'bad', text, loc);
    w.battleReports.push({ loc, won, text, day: w.day });
    fireTrigger(w, won ? 'on_battle_won' : 'on_battle_lost', w.player, won ? rl : rw, NONE, loc);
  } else if (w.player !== NONE && w.isFullDetail(rw) && lossL + lossW > 800) {
    w.addLog('war', `${w.realmName[rw]} defeats ${w.realmName[rl]} at ${pname}.`, loc);
  }

  // The loser falls back or breaks.
  if (w.armyMen[lose] < 60 || w.armyKind[lose] !== ArmyKind.Host) {
    disbandArmy(w, lose);
  } else {
    let home = w.realmCapital[rl];
    if (home < 0 || home === loc) home = w.armyHome[lose];
    // AI armies regroup on their own; the player's army retreats but stays under the player's command.
    if (w.armyRealm[lose] !== w.player) w.armyManual[lose] = 0;
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
  // Raiders that won finish the job they came for.
  if (w.armyActive[win] && w.armyKind[win] !== ArmyKind.Host && w.armyNext[win] < 0) arrived(w, win);
}

/** The province an army is in for the purpose of meeting enemies: on a road, whichever end is nearer. */
function positionOf(w: World, a: number): number {
  if (w.armyNext[a] < 0) return w.armyLoc[a];
  return w.armyProgress[a] >= w.armyLegDays[a] * 0.5 ? w.armyNext[a] : w.armyLoc[a];
}

/**
 * Hostile armies in the same place meet, whether standing, setting out, arriving or
 * passing on the road: both are pulled into that province and the battle pass begins.
 */
function meetings(w: World): void {
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyBattle[a] >= 0 || routed(w, a)) continue;
    const pa = positionOf(w, a);
    for (let b = a + 1; b < ARMY_CAP; b++) {
      if (!w.armyActive[b] || w.armyBattle[b] >= 0 || routed(w, b)) continue;
      if (w.armyNext[a] < 0 && w.armyNext[b] < 0) continue; // standing armies: the battle pass handles them
      let place = positionOf(w, b) === pa ? pa : NONE;
      // Head-on on the same road: they meet where they cross, even if both just passed halfway.
      if (place < 0 && w.armyNext[a] >= 0 && w.armyNext[b] >= 0 && w.armyLoc[a] === w.armyNext[b] && w.armyNext[a] === w.armyLoc[b]) {
        const fa = w.armyProgress[a] / Math.max(1, w.armyLegDays[a]);
        const fb = w.armyProgress[b] / Math.max(1, w.armyLegDays[b]);
        if (fa + fb >= 1) place = fa >= fb ? w.armyNext[a] : w.armyLoc[a];
      }
      if (place < 0 || !armiesHostile(w, a, b)) continue;
      for (const x of [a, b]) {
        w.armyLoc[x] = place;
        w.armyNext[x] = NONE;
        w.armyProgress[x] = 0;
      }
      break;
    }
  }
}

/** Siege progress needed to take province p. Every fort level adds a long stretch. */
export function siegeNeed(w: World, p: number): number {
  const o = w.provOwner[p];
  return 20 + w.provDevelop[p] * 8 + TERRAIN_SIEGE[w.provTerrain[p]] + (o >= 0 && w.realmCapital[o] === p ? 15 : 0) + w.provFort[p] * FORT_SIEGE;
}

/** Men needed to invest a place: a palisade needs a raid party, a citadel a real host. */
export function siegeMinMen(w: World, p: number): number {
  return 250 + w.provFort[p] * 600;
}

/** Daily siege work an army does here. Walls slow every day of it. */
export function siegeRate(w: World, a: number, p: number): number {
  let work = 0;
  for (let u = 0; u < UNIT_COUNT; u++) work += w.armyUnits[a * UNIT_COUNT + u] * UNITS[u].siege;
  // A typical levy (mostly spears, some bows and slings) does ~0.87 work per man.
  return Math.min(2, work / 1300) / (1 + 0.35 * w.provFort[p]);
}

/** Strength of the defenders behind the walls of p. */
export function garrison(w: World, p: number): number {
  const o = w.provOwner[p];
  const stab = o >= 0 ? 0.6 + 0.4 * (w.realmStability[o] / 100) : 1;
  return (120 + w.provPop[p] * 18 + w.provDevelop[p] * 40) * (1 + w.provFort[p]) * DEFENSE[w.provTerrain[p]] * stab;
}

/** Strength an army throws at the walls: melee does the work, archers cover, chariots can't climb. */
export function assaultPower(w: World, a: number): number {
  let p = 0;
  for (let u = 0; u < UNIT_COUNT; u++) {
    const t = UNITS[u];
    p += w.armyUnits[a * UNIT_COUNT + u] * (t.melee + t.ranged * 0.35) * (u === Unit.Chariot ? 0.1 : 1);
  }
  const leader = w.armyLeader[a];
  const mart = leader >= 0 && w.charAlive[leader] ? w.charMartial[leader] : 4;
  return p * w.armyQuality[a] * w.armyMorale[a] * (1 + 0.04 * mart);
}

/** Why army a cannot make siege progress here, or '' if it can. */
export function siegeBlocked(w: World, a: number): string {
  const loc = w.armyLoc[a];
  const o = w.provOwner[loc];
  if (o < 0 || w.armyNext[a] >= 0) return 'not besieging';
  const mine = w.top(w.armyRealm[a]);
  const ot = w.top(o);
  if (ot === mine || w.hostile[mine * w.R + ot] !== 1) return 'not at war with the owner';
  const occ = w.provOccupier[loc];
  if (occ >= 0 && (occ === mine || w.hostile[mine * w.R + occ] !== 1)) return 'already taken';
  if (w.armyMen[a] < siegeMinMen(w, loc)) return `too few men to invest the walls (need ${siegeMinMen(w, loc)})`;
  for (let b = 0; b < ARMY_CAP; b++) {
    if (b !== a && w.armyActive[b] && w.armyLoc[b] === loc && w.armyNext[b] < 0 && !routed(w, b) && armiesHostile(w, a, b)) return 'an enemy army holds the field';
  }
  return '';
}

/** Province p falls to realm `mine`. */
function capture(w: World, a: number, p: number, how: 'siege' | 'storm'): void {
  const o = w.provOwner[p];
  const mine = w.top(w.armyRealm[a]);
  w.armySiege[a] = 0;
  w.provOccupier[p] = mine;
  w.provRaided[p] = Math.max(w.provRaided[p], how === 'storm' ? 6 : 3);
  // Storming tears the walls down a level; a starved-out town keeps them.
  if (how === 'storm' && w.provFort[p] > 0) w.provFort[p]--;
  if (how === 'storm') w.provPop[p] *= 0.93;
  w.markProv(p);
  const pname = w.scenario.provinces[p].name;
  if (w.concernsPlayer(mine)) w.addLog('good', how === 'storm' ? `Our men have stormed the walls of ${pname}!` : `${pname} has fallen to our siege.`, p);
  else if (w.concernsPlayer(o)) w.addLog('bad', how === 'storm' ? `${pname} has been stormed by ${w.realmName[mine]}.` : `${pname} has fallen to the army of ${w.realmName[mine]}.`, p);
}

/**
 * Throw the army at the walls. The further the siege has gone (breaches, hunger), the
 * weaker the defence. Win or lose, storming is bloody. Returns true if the place falls.
 */
export function assault(w: World, a: number): boolean {
  const loc = w.armyLoc[a];
  const progress = Math.min(1, w.armySiege[a] / Math.max(1, siegeNeed(w, loc)));
  const def = garrison(w, loc) * (1.6 - progress);
  const att = assaultPower(w, a) * (0.6 + 0.8 * w.rng.next());
  const won = att > def;
  const fort = w.provFort[loc];
  const lossFrac = (won ? 0.06 : 0.14) + 0.05 * fort * (1 - progress) + 0.06 * w.rng.next();
  const lost = applyLosses(w, a, w.armyMen[a] * lossFrac, won);
  const r = w.top(w.armyRealm[a]);
  if (w.realmLevy[r] > 0) w.realmManpower[r] = Math.max(0, w.realmManpower[r] - lost / w.realmLevy[r]);
  w.armyMorale[a] = Math.max(0.2, Math.min(1, w.armyMorale[a] + (won ? 0.05 : -0.2)));
  if (won) capture(w, a, loc, 'storm');
  else {
    w.armySiege[a] *= 0.8;
    if (w.concernsPlayer(w.armyRealm[a])) w.addLog('bad', `The assault on ${w.scenario.provinces[loc].name} failed. ${Math.round(lost)} men fell at the walls.`, loc);
  }
  if (w.armyMen[a] < 60) disbandArmy(w, a);
  return won;
}

function siegeDaily(w: World, a: number): void {
  if (siegeBlocked(w, a)) return;
  const loc = w.armyLoc[a];
  const fort = w.provFort[loc];
  w.armySiege[a] += siegeRate(w, a, loc);
  // Disease in the camps and sallies from the walls.
  if (fort > 0) scaleUnits(w, a, 1 - 0.0003 - 0.0004 * fort);
  if (w.armySiege[a] >= siegeNeed(w, loc)) {
    capture(w, a, loc, 'siege');
    return;
  }
  // AI commanders (and the player's generals) storm when the odds look good.
  if (fort > 0 && !w.armyManual[a] && (a + w.day) % 10 === 0) {
    const progress = w.armySiege[a] / siegeNeed(w, loc);
    if (progress > 0.35 && assaultPower(w, a) > garrison(w, loc) * (1.6 - progress) * 1.3) assault(w, a);
  }
}

/** Monthly: walls under construction rise; rich AI realms fortify their capitals. */
export function fortsMonthly(w: World): void {
  for (let p = 0; p < w.P; p++) {
    if (!w.provFortBuild[p]) continue;
    w.provFortBuild[p]--;
    if (w.provFortBuild[p] === 0 && w.provFort[p] < 3) {
      w.provFort[p]++;
      w.markProv(p);
      const o = w.provOwner[p];
      if (o >= 0 && w.concernsPlayer(o)) w.addLog('good', `The new walls of ${w.scenario.provinces[p].name} are finished (fort level ${w.provFort[p]}).`, p);
    }
  }
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r] || r === w.player || w.realmLandless[r]) continue;
    if ((r + w.month) % 12 !== 0) continue;
    const cap = w.realmCapital[r];
    if (cap < 0 || w.provFortBuild[cap] || w.provFort[cap] >= 2) continue;
    const cost = fortCost(w.provFort[cap]);
    if (w.realmTrade[r] > cost.trade * 2.5 && w.realmMetal[r] > cost.metal * 2) startFort(w, r, cap);
  }
}

export function fortCost(level: number): { trade: number; metal: number; months: number } {
  return { trade: 40 * (level + 1), metal: 10 * (level + 1), months: 6 * (level + 1) };
}

export function startFort(w: World, r: number, p: number): void {
  const c = fortCost(w.provFort[p]);
  w.realmTrade[r] -= c.trade;
  w.realmMetal[r] -= c.metal;
  w.provFortBuild[p] = c.months;
  w.markProv(p);
}

/** Daily: move armies, stop them where enemies stand, fight battles and sieges, and let idle armies think. */
export function armiesDaily(w: World): void {
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyBattle[a] >= 0) continue;
    if (w.armyNext[a] >= 0) {
      w.armyProgress[a] += 1;
      if (w.armyProgress[a] >= w.armyLegDays[a]) {
        w.armyLoc[a] = w.armyNext[a];
        w.armyNext[a] = NONE;
        w.armyProgress[a] = 0;
        // An enemy army in the way: halt and fight before anything else.
        if (hostileAt(w, a, w.armyLoc[a])) continue;
        arrived(w, a);
        if (!w.armyActive[a]) continue;
      }
    }
    if (w.armyNext[a] < 0 && w.armyLoc[a] !== w.armyDest[a] && !hostileAt(w, a, w.armyLoc[a])) stepToward(w, a);
  }
  meetings(w);
  // Hostile armies standing in the same province join battle.
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyNext[a] >= 0 || w.armyBattle[a] >= 0 || routed(w, a)) continue;
    for (let b = 0; b < ARMY_CAP; b++) {
      if (b === a || !w.armyActive[b] || w.armyNext[b] >= 0 || w.armyBattle[b] >= 0 || routed(w, b) || w.armyLoc[b] !== w.armyLoc[a]) continue;
      if (armiesHostile(w, a, b)) {
        startBattle(w, a, b);
        break;
      }
    }
  }
  for (let bt = 0; bt < BATTLE_CAP; bt++) if (w.battleActive[bt]) battleDaily(w, bt);
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyBattle[a] >= 0) continue;
    // Morale returns with rest, faster on home ground.
    if (w.armyMorale[a] < 1) {
      const o = w.provOwner[w.armyLoc[a]];
      const home = o >= 0 && w.top(o) === w.top(w.armyRealm[a]);
      w.armyMorale[a] = Math.min(1, w.armyMorale[a] + (home ? 0.012 : 0.005));
    }
    if (w.armyKind[a] === ArmyKind.Host) {
      if (w.armyNext[a] < 0) siegeDaily(w, a);
      if (!w.armyActive[a]) continue;
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
