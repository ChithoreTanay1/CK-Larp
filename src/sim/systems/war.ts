import { World, NONE, WAR_CAP, ARMY_CAP, ArmyKind, WarKind, DAYS_PER_MONTH, DAYS_PER_YEAR } from '../world';
import { transferProvince, mergeRealm } from './realms';
import { raiseArmy, disbandArmy, fieldedMen, ANNEX_DAYS } from './military';
import { fireTrigger } from '../events/runner';
import { queueProposal } from './diplomacy';

const TRUCE_DAYS = 5 * DAYS_PER_YEAR;

export function warName(w: World, war: number): string {
  const a = w.realmName[w.warAttacker[war]], d = w.realmName[w.warDefender[war]];
  switch (w.warKind[war]) {
    case WarKind.Conquest:
      return `${a}'s war for ${w.scenario.provinces[w.warTarget[war]].name}`;
    case WarKind.Subjugation:
      return `${a}'s subjugation of ${d}`;
    case WarKind.Independence:
      return `${a}'s war of independence`;
    default:
      return `The ${a}`;
  }
}

/** Which side (1 attacker, 2 defender, 0 none) a realm's top liege is on. */
export function sideOf(w: World, war: number, r: number): number {
  return w.warSide[war * w.R + w.top(r)];
}

export function atWar(w: World, r: number): boolean {
  const t = w.top(r);
  for (let war = 0; war < WAR_CAP; war++) if (w.warActive[war] && w.warSide[war * w.R + t]) return true;
  return false;
}

export function rebuildHostility(w: World): void {
  w.hostile.fill(0);
  const R = w.R;
  for (let war = 0; war < WAR_CAP; war++) {
    if (!w.warActive[war]) continue;
    const base = war * R;
    for (let a = 0; a < R; a++) {
      if (w.warSide[base + a] !== 1) continue;
      for (let b = 0; b < R; b++) {
        if (w.warSide[base + b] !== 2) continue;
        w.hostile[a * R + b] = 1;
        w.hostile[b * R + a] = 1;
      }
    }
  }
}

/** Declare a war. Returns the war slot, or -1 if it could not start. */
export function declareWar(w: World, attacker: number, defender: number, target: number, kind: WarKind): number {
  if (kind === WarKind.Independence) w.realmLiege[attacker] = NONE;
  else attacker = w.top(attacker);
  defender = w.top(defender);
  if (attacker === defender || !w.realmAlive[attacker] || !w.realmAlive[defender]) return NONE;
  let war = NONE;
  for (let i = 0; i < WAR_CAP; i++) if (!w.warActive[i]) {
    war = i;
    break;
  }
  if (war < 0) return NONE;
  const R = w.R;
  w.warSide.fill(0, war * R, war * R + R);
  w.warActive[war] = 1;
  w.warAttacker[war] = attacker;
  w.warDefender[war] = defender;
  w.warTarget[war] = target;
  w.warKind[war] = kind;
  w.warScore[war] = 0;
  w.warBattle[war] = 0;
  w.warStart[war] = w.day;
  w.warSide[war * R + attacker] = 1;
  w.warSide[war * R + defender] = 2;
  w.setAllied(attacker, defender, false);
  w.truceUntil[attacker * R + defender] = w.truceUntil[defender * R + attacker] = 0;
  w.addOpinionBoth(attacker, defender, -40);
  if (kind === WarKind.Independence) w.realmsDirty = true;

  // Defensive alliances: the defender's allies are called in.
  for (let o = 0; o < R; o++) {
    if (!w.realmAlive[o] || o === attacker || o === defender || w.realmLiege[o] !== NONE) continue;
    if (w.allied[defender * R + o] && !w.allied[attacker * R + o]) {
      w.warSide[war * R + o] = 2;
      w.addOpinion(o, attacker, -25);
      if (w.concernsPlayer(o) || w.concernsPlayer(defender)) w.addLog('war', `${w.realmName[o]} honors the alliance and joins the war against ${w.realmName[attacker]}.`);
    }
  }
  rebuildHostility(w);
  for (let o = 0; o < R; o++) if (w.warSide[war * R + o]) raiseArmy(w, o);

  const name = warName(w, war);
  const involvesPlayer = w.player !== NONE && w.warSide[war * R + w.top(w.player)] !== 0;
  if (involvesPlayer) {
    w.addLog('war', `War! ${name} has begun.`, target);
    if (w.top(w.player) !== attacker) fireTrigger(w, 'on_war_declared', w.player, attacker, NONE);
  } else if (w.player !== NONE && (w.isFullDetail(attacker) || w.isFullDetail(defender))) {
    w.addLog('world', `${name} has begun.`, target);
  }
  if (attacker !== w.player && w.isFullDetail(defender) && defender !== w.player && w.rng.chance(0.3)) fireTrigger(w, 'on_war_declared', defender, attacker, NONE);
  return war;
}

/** Daily: recompute war scores from battles plus occupation. */
export function updateWarScores(w: World): void {
  const R = w.R;
  for (let war = 0; war < WAR_CAP; war++) {
    if (!w.warActive[war]) continue;
    let defTotal = 0, attTotal = 0, occAtt = 0, occDef = 0;
    const target = w.warTarget[war];
    let targetHeld = false;
    for (let p = 0; p < w.P; p++) {
      const o = w.provOwner[p];
      if (o < 0) continue;
      const side = w.warSide[war * R + w.top(o)];
      if (!side) continue;
      const v = w.provDevelop[p] + 1;
      const occ = w.provOccupier[p];
      const occSide = occ >= 0 ? w.warSide[war * R + occ] : 0;
      if (side === 2) {
        defTotal += v;
        if (occSide === 1) {
          occAtt += v;
          if (p === target) targetHeld = true;
        }
      } else {
        attTotal += v;
        if (occSide === 2) occDef += v;
      }
    }
    let s = w.warBattle[war];
    if (defTotal > 0) s += (70 * occAtt) / defTotal;
    if (attTotal > 0) s -= (70 * occDef) / attTotal;
    if (targetHeld) s += 25;
    // A war that drags on with nothing to show slowly favors the defender.
    const months = (w.day - w.warStart[war]) / DAYS_PER_MONTH;
    if (months > 12 && !targetHeld) s -= Math.min(30, (months - 12) * 0.8);
    w.warScore[war] = s > 100 ? 100 : s < -100 ? -100 : s;
  }
}

/** Monthly: decide whether wars end. */
export function warMonthly(w: World): void {
  for (let war = 0; war < WAR_CAP; war++) {
    if (!w.warActive[war]) continue;
    const att = w.warAttacker[war], def = w.warDefender[war];
    const s = w.warScore[war];
    const months = (w.day - w.warStart[war]) / DAYS_PER_MONTH;
    const playerTop = w.player !== NONE ? w.top(w.player) : NONE;
    if (s >= 100) {
      endWar(w, war, 'attacker');
      continue;
    }
    if (s <= -100) {
      endWar(w, war, 'defender');
      continue;
    }
    if (months > 60) {
      endWar(w, war, 'white');
      continue;
    }
    const defBroken = fieldedMen(w, def) < 200;
    if (def !== playerTop) {
      if ((s >= 70 || (s >= 40 && defBroken)) && w.rng.chance(0.5)) {
        endWar(w, war, 'attacker');
        continue;
      }
    } else if (s >= 50 && w.rng.chance(0.15)) {
      queueProposal(w, 'peace', att, NONE, NONE, war, `${w.realmName[att]} demands your surrender`, `The war goes badly. ${w.realmName[att]}'s envoys offer peace, if you accept their terms.`);
    }
    if (att !== playerTop) {
      if (s <= -60 && w.rng.chance(0.5)) {
        endWar(w, war, 'defender');
        continue;
      }
      if (months > 30 && s < 15 && s > -60 && w.rng.chance(0.25)) {
        endWar(w, war, 'white');
        continue;
      }
    } else if (s <= -50 && w.rng.chance(0.15)) {
      queueProposal(w, 'peace', def, NONE, NONE, war, `${w.realmName[def]} demands you withdraw`, `Your war has failed. ${w.realmName[def]} will accept your surrender.`);
    }
  }
}

/**
 * Daily: land held long enough changes hands. An occupier that keeps a province for
 * ANNEX_DAYS annexes it, and a conquest war fought for that province is won.
 */
export function occupationDaily(w: World): void {
  for (let p = 0; p < w.P; p++) {
    const occ = w.provOccupier[p];
    if (occ < 0) {
      w.provOccDays[p] = 0;
      continue;
    }
    if (++w.provOccDays[p] < ANNEX_DAYS) continue;
    w.provOccDays[p] = 0;
    const o = w.provOwner[p];
    if (o < 0 || !w.realmAlive[occ]) {
      w.provOccupier[p] = NONE;
      w.markProv(p);
      continue;
    }
    const from = w.top(o);
    const pname = w.scenario.provinces[p].name;
    const playerTop = w.player !== NONE ? w.top(w.player) : NONE;
    transferProvince(w, p, occ);
    if (occ === playerTop) w.addLog('good', `${pname} is ours. After ${ANNEX_DAYS} days under our banner, its people now answer to us.`, p);
    else if (from === playerTop) w.addLog('bad', `We have lost ${pname}: ${w.realmName[occ]} has held it for ${ANNEX_DAYS} days and taken it for good.`, p);
    for (let war = 0; war < WAR_CAP; war++) {
      if (w.warActive[war] && w.warKind[war] === WarKind.Conquest && w.warTarget[war] === p && w.warAttacker[war] === occ) endWar(w, war, 'attacker');
    }
  }
}

export function endWar(w: World, war: number, outcome: 'attacker' | 'defender' | 'white'): void {
  if (!w.warActive[war]) return;
  w.warActive[war] = 0;
  const R = w.R;
  const att = w.warAttacker[war], def = w.warDefender[war];
  const kind = w.warKind[war];
  const name = warName(w, war);
  const involvesPlayer = w.player !== NONE && w.warSide[war * R + w.top(w.player)] !== 0;

  // Clear occupations between the two sides, remembering what the attacker held.
  const heldByAtt: number[] = [];
  for (let p = 0; p < w.P; p++) {
    const occ = w.provOccupier[p];
    if (occ < 0) continue;
    const o = w.provOwner[p];
    const os = o >= 0 ? w.warSide[war * R + w.top(o)] : 0;
    const cs = w.warSide[war * R + occ];
    if (os && cs && os !== cs) {
      if (cs === 1 && os === 2 && w.top(o) === def) heldByAtt.push(p);
      w.provOccupier[p] = NONE;
      w.markProv(p);
    }
  }

  let text = '';
  if (outcome === 'attacker') {
    w.realmPrestige[att] += 15;
    w.realmPrestige[def] = Math.max(0, w.realmPrestige[def] - 15);
    w.realmStability[def] = Math.max(0, w.realmStability[def] - 8);
    if (kind === WarKind.Conquest) {
      const t = w.warTarget[war];
      if (w.realmAlive[att] && w.provOwner[t] >= 0 && w.top(w.provOwner[t]) === def) transferProvince(w, t, att);
      let extra = 0;
      for (const p of heldByAtt) if (p !== t && extra < 2 && w.realmAlive[att] && w.provOwner[p] >= 0 && w.top(w.provOwner[p]) === def) {
        transferProvince(w, p, att);
        extra++;
      }
      text = `${w.realmName[att]} wins ${name}.`;
    } else if (kind === WarKind.Subjugation) {
      if (w.realmAlive[def] && w.realmAlive[att]) {
        w.realmLiege[def] = att;
        w.realmLoyalty[def] = 35;
        w.realmsDirty = true;
      }
      text = `${w.realmName[def]} bends the knee to ${w.realmName[att]}.`;
    } else {
      let extra = 0;
      for (const p of heldByAtt) if (extra < 2 && w.realmAlive[att] && w.provOwner[p] >= 0 && w.top(w.provOwner[p]) === def) {
        transferProvince(w, p, att);
        extra++;
      }
      text = `${w.realmName[att]} has won its freedom from ${w.realmName[def]}.`;
    }
  } else if (outcome === 'defender') {
    w.realmPrestige[def] += 10;
    w.realmPrestige[att] = Math.max(0, w.realmPrestige[att] - 10);
    if (kind === WarKind.Revolt) {
      text = `The revolt of ${w.realmName[att]} has been crushed.`;
      if (w.realmAlive[att] && w.realmAlive[def]) mergeRealm(w, att, def);
    } else if (kind === WarKind.Independence) {
      if (w.realmAlive[att] && w.realmAlive[def]) {
        w.realmLiege[att] = def;
        w.realmLoyalty[att] = 25;
        w.realmsDirty = true;
      }
      text = `${w.realmName[att]}'s bid for independence has failed.`;
    } else {
      const k = 0.3;
      w.realmGrain[def] += w.realmGrain[att] * k;
      w.realmMetal[def] += w.realmMetal[att] * k;
      w.realmTrade[def] += w.realmTrade[att] * k;
      w.realmGrain[att] *= 1 - k;
      w.realmMetal[att] *= 1 - k;
      w.realmTrade[att] *= 1 - k;
      text = `${w.realmName[def]} has beaten off ${w.realmName[att]} and taken reparations.`;
    }
  } else {
    if (kind === WarKind.Independence && w.realmAlive[att] && w.realmAlive[def]) {
      w.realmLiege[att] = def;
      w.realmLoyalty[att] = 30;
      w.realmsDirty = true;
    }
    text = `${name} ends in an exhausted peace.`;
  }

  if (w.realmAlive[att] && w.realmAlive[def]) w.setTruce(att, def, TRUCE_DAYS);
  w.warSide.fill(0, war * R, war * R + R);
  rebuildHostility(w);
  // Stand down armies of realms no longer at war.
  // The player's armies stay until the player sends them home.
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyKind[a] !== ArmyKind.Host) continue;
    const r = w.armyRealm[a];
    if (r !== w.player && !atWar(w, r)) disbandArmy(w, a);
  }
  if (involvesPlayer) w.addLog(outcome === 'white' ? 'war' : 'war', text);
  else if (w.player !== NONE && (w.isFullDetail(att) || w.isFullDetail(def))) w.addLog('world', text);
}
