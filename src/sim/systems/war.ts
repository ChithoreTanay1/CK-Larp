import { World, NONE, WAR_CAP, ARMY_CAP, ArmyKind, WarKind, DAYS_PER_MONTH, DAYS_PER_YEAR } from '../world';
import { transferProvince, mergeRealm } from './realms';
import { raiseArmy, disbandArmy, fieldedMen, ANNEX_DAYS } from './military';
import { fireTrigger } from '../events/runner';
import { queueProposal } from './diplomacy';
import { aiAxis } from './characters';
import { AXIS_HONOR } from '../content';
import { betray, Betrayal, addInfamy, hasTradePact, willAnswerCall, remember } from './relations';

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

/** Infamy a war of this kind earns the attacker, before any excuses. */
export function warInfamy(w: World, attacker: number, defender: number, target: number, kind: WarKind): number {
  let v = kind === WarKind.Conquest ? (w.provClaim[target] === attacker ? 1 : 6) : kind === WarKind.Subjugation ? 5 : 0;
  if (w.married[attacker * w.R + defender]) v += 4;
  return v;
}

/** Ask the player to join a war; the answer comes back through answerProposal. */
function callPlayer(w: World, war: number, leader: number, enemy: number, side: number): void {
  const defensive = side === 2;
  w.playerQueue.push({
    uid: w.nextUid++,
    kind: 'proposal',
    title: `${w.realmName[leader]} calls us to arms`,
    text: defensive
      ? `${w.realmName[enemy]} has attacked our ally ${w.realmName[leader]}. Their envoy begs us to honor the alliance and march.`
      : `Our ally ${w.realmName[leader]} goes to war against ${w.realmName[enemy]} and asks us to join them.`,
    options: [
      { label: 'Join the war', tooltip: `We fight on ${w.realmName[leader]}'s side. Prestige +5.` },
      { label: 'Refuse', tooltip: defensive ? 'The alliance ends. Prestige -15, and they will hold a grudge.' : 'They will think less of us, but the alliance holds.' },
    ],
    proposal: { type: 'call', from: leader, a: side, war },
  });
}

/** Bring realm r into a war on a side (1 attacker, 2 defender). */
export function joinWar(w: World, war: number, r: number, side: number): void {
  if (!w.warActive[war] || !w.realmAlive[r] || w.warSide[war * w.R + r]) return;
  w.warSide[war * w.R + r] = side;
  const enemy = side === 1 ? w.warDefender[war] : w.warAttacker[war];
  w.truceUntil[r * w.R + enemy] = w.truceUntil[enemy * w.R + r] = 0;
  rebuildHostility(w);
  raiseArmy(w, r);
}

/** Declare a war. Returns the war slot, or -1 if it could not start. `justified` wars (vengeance, coalitions) earn no infamy. */
export function declareWar(w: World, attacker: number, defender: number, target: number, kind: WarKind, justified = false): number {
  if (kind === WarKind.Independence) w.realmLiege[attacker] = NONE;
  else attacker = w.top(attacker);
  defender = w.top(defender);
  if (attacker === defender || !w.realmAlive[attacker] || !w.realmAlive[defender]) return NONE;
  const truceBroken = !justified && w.hasTruce(attacker, defender);
  const tradeBroken = hasTradePact(w, attacker, defender);
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
  if (!justified) {
    if (w.married[attacker * R + defender]) w.realmPrestige[attacker] = Math.max(0, w.realmPrestige[attacker] - 10);
    addInfamy(w, attacker, warInfamy(w, attacker, defender, target, kind));
  }
  if (truceBroken) betray(w, attacker, defender, Betrayal.Truce);
  if (tradeBroken) betray(w, attacker, defender, Betrayal.TradeWar);

  // Calls to arms. The defender's allies are bound to come; the attacker's may.
  const playerTop = w.player !== NONE ? w.top(w.player) : NONE;
  const abandoned: number[] = [];
  const asked: [number, number][] = [];
  if (kind !== WarKind.Revolt) {
    for (let o = 0; o < R; o++) {
      if (!w.realmAlive[o] || o === attacker || o === defender || w.realmLiege[o] !== NONE) continue;
      if (w.allied[defender * R + o] && !w.allied[attacker * R + o]) {
        if (o === playerTop) asked.push([o, 2]);
        else if (willAnswerCall(w, o, defender, attacker, true)) {
          w.warSide[war * R + o] = 2;
          w.addOpinion(o, attacker, -25);
          if (w.concernsPlayer(o) || w.concernsPlayer(defender) || w.concernsPlayer(attacker)) w.addLog('war', `${w.realmName[o]} honors the alliance and joins the war against ${w.realmName[attacker]}.`);
        } else abandoned.push(o);
      } else if (w.allied[attacker * R + o] && !w.allied[defender * R + o]) {
        if (o === playerTop) asked.push([o, 1]);
        else if (willAnswerCall(w, o, attacker, defender, false)) {
          w.warSide[war * R + o] = 1;
          w.addOpinion(defender, o, -20);
          if (w.concernsPlayer(attacker) || w.concernsPlayer(defender)) w.addLog('war', `${w.realmName[o]} answers ${w.realmName[attacker]}'s call to arms.`);
        } else {
          remember(w, attacker, o, -10, 'They refused our call to arms');
          if (attacker === playerTop) w.addLog('info', `${w.realmName[o]} refuses our call to arms.`);
        }
      }
    }
  }
  // A broken truce outrages the honorable nearby, and some take up arms for the victim.
  if (truceBroken) {
    const cap = w.realmCapital[defender];
    for (let o = 0; o < R && cap >= 0; o++) {
      if (!w.realmAlive[o] || w.warSide[war * R + o] || w.realmLiege[o] !== NONE || w.realmLandless[o] || o === playerTop || w.allied[attacker * R + o]) continue;
      const oc = w.realmCapital[o];
      if (oc < 0 || w.map.hopDays[oc * w.P + cap] > 40 || atWar(w, o)) continue;
      if (aiAxis(w, w.realmRuler[o], AXIS_HONOR) < 0.5 || w.getOpinion(o, attacker) > -20 || !w.rng.chance(0.35)) continue;
      w.warSide[war * R + o] = 2;
      if (w.concernsPlayer(attacker) || w.concernsPlayer(defender)) w.addLog('war', `Outraged by the broken truce, ${w.realmName[o]} joins the war against ${w.realmName[attacker]}.`);
    }
  }
  rebuildHostility(w);
  for (let o = 0; o < R; o++) if (w.warSide[war * R + o]) raiseArmy(w, o);
  for (const o of abandoned) betray(w, o, defender, Betrayal.Abandon);
  for (const [, side] of asked) callPlayer(w, war, side === 1 ? attacker : defender, side === 1 ? defender : attacker, side);

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
