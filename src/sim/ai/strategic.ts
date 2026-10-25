import { World, NONE, Goal, WarKind, P_FAMINE, P_RAIDER } from '../world';
import { aiAxis } from '../systems/characters';
import { AXIS_AGGRESSION, AXIS_AMBITION, AXIS_GREED, AXIS_HONOR, AXIS_PIETY, TAG_RAIDER, TAG_TEMPLE, AXIS_BOLDNESS } from '../content';
import { strength, strengthWithAllies } from '../systems/realms';
import { atWar, declareWar } from '../systems/war';
import { launchRaid } from '../systems/military';
import { evaluate, enact, queueProposal } from '../systems/diplomacy';
import { plotAi } from '../systems/plots';
import { EAT } from '../systems/economy';

// Scratch: candidate neighbor provinces (no per-tick allocation).
let seen = new Uint8Array(0);

function hostagesHeldFrom(w: World, holder: number, r: number): boolean {
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (w.charHostage[c] === holder && w.charRealm[c] === r) return true;
  }
  return false;
}

/**
 * Strategic AI: every month (staggered by realmAiOffset; quarterly for reduced-detail
 * realms) score a few goals with utility functions and act on the winner.
 */
export function strategicAi(w: World, r: number): void {
  if (r === w.player || !w.realmAlive[r] || w.realmLandless[r] || w.realmCapital[r] < 0) return;
  const ruler = w.realmRuler[r];
  if (ruler < 0) return;
  const reg = w.realmRegion(r);
  const famine = w.p(reg, P_FAMINE);
  const raiderP = w.p(reg, P_RAIDER);
  const aggression = aiAxis(w, ruler, AXIS_AGGRESSION);
  const ambition = aiAxis(w, ruler, AXIS_AMBITION);
  const greed = aiAxis(w, ruler, AXIS_GREED);
  const honor = aiAxis(w, ruler, AXIS_HONOR);
  const piety = aiAxis(w, ruler, AXIS_PIETY);
  const bold = aiAxis(w, ruler, AXIS_BOLDNESS);
  const stab = w.realmStability[r];
  const isVassal = w.realmLiege[r] >= 0;
  const warring = atWar(w, r);
  let eatNeed = 0;
  for (let p = 0; p < w.P; p++) if (w.provOwner[p] === r) eatNeed += w.provPop[p] * EAT;
  const hungry = w.realmGrain[r] < eatNeed * 2;

  // ---- Goal utilities ----
  const uRecover = famine * 2 + (hungry ? 0.8 : 0) + (stab < 30 ? 0.6 : 0);
  const uExpand = 0.6 + ambition * 0.25 + aggression * 0.2 + bold * 0.1 - famine * 1.2 - (warring ? 0.6 : 0) - (stab < 35 ? 0.5 : 0) - (isVassal ? 0.8 : 0);
  const uConsolidate = (100 - stab) / 90 + (isVassal ? 0.2 : 0);
  let threat = 0;
  const myStr = strengthWithAllies(w, r);
  for (let o = 0; o < w.R; o++) {
    if (!w.realmAlive[o] || o === r || w.realmLiege[o] !== NONE || w.realmLandless[o]) continue;
    const d = w.map.hopDays[w.realmCapital[o] * w.P + w.realmCapital[r]];
    if (d > 40 || w.realmCapital[o] < 0) continue;
    if (w.getOpinion(o, r) < 0) threat = Math.max(threat, strength(w, o) / Math.max(1, myStr) - 1);
  }
  const uDefend = Math.min(2, threat) * 0.8 - (isVassal ? 0.3 : 0);
  const scores = [uConsolidate, uExpand, uDefend, uRecover];
  let goal = 0;
  for (let g = 1; g < 4; g++) if (scores[g] + w.rng.next() * 0.25 > scores[goal]) goal = g;
  w.realmAiGoal[r] = goal;

  // ---- Raiding: cheap, risky, attractive when hungry or greedy ----
  const raiderCulture = (w.content.cultureTags[w.realmCulture[r]] & TAG_RAIDER) !== 0;
  const uRaid = 0.15 + greed * 0.15 + (raiderCulture ? 0.4 : 0) + famine * 0.9 + raiderP * 0.3 - honor * 0.1 + (hungry ? 0.4 : 0) + bold * 0.08;
  if (w.day >= w.realmRaidReady[r] && w.realmArmy[r] < 0 && w.rng.chance(Math.max(0, uRaid) * 0.35)) {
    const t = pickRaidTarget(w, r);
    if (t >= 0) {
      launchRaid(w, r, t);
      return;
    }
  }

  switch (goal) {
    case Goal.Expand:
      if (!warring && !isVassal && w.realmManpower[r] > 0.6) tryWar(w, r, ambition, honor);
      break;
    case Goal.Defend:
      tryAlliance(w, r);
      break;
    case Goal.Consolidate:
      // Endow the temples, feast the vassals.
      if (w.realmTrade[r] > 40) {
        const temple = (w.content.cultureTags[w.realmCulture[r]] & TAG_TEMPLE) !== 0 ? 1.5 : 1;
        w.realmTrade[r] -= 25;
        w.realmStability[r] = Math.min(100, w.realmStability[r] + 4 * temple + piety);
        w.realmPrestige[r] += 2;
      }
      if (w.realmGrain[r] > eatNeed * 6) {
        w.realmGrain[r] -= eatNeed * 1.5;
        for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.realmLiege[o] === r) w.realmLoyalty[o] = Math.min(100, w.realmLoyalty[o] + 6);
      }
      if (!isVassal && !warring && w.rng.chance(0.3)) trySubjugate(w, r);
      break;
    case Goal.Recover:
      break;
  }
  plotAi(w, r);
}

function pickRaidTarget(w: World, r: number): number {
  const cap = w.realmCapital[r];
  const me = w.top(r);
  const P = w.P;
  let best = NONE, bestScore = 0;
  for (let p = 0; p < P; p++) {
    const o = w.provOwner[p];
    if (o < 0) continue;
    const ot = w.top(o);
    if (ot === me || w.isAllied(me, ot) || w.realmLiege[r] === o) continue;
    const d = w.map.hopDays[p * P + cap];
    if (d > 28) continue;
    if (hostagesHeldFrom(w, ot, r) && w.rng.chance(0.8)) continue;
    const loot = w.provGrainOut[p] + w.provCattleOut[p] * 2 + w.provDevelop[p] * 2;
    const defense = w.provPop[p] * 0.5 * (0.8 + 0.08 * w.provDevelop[p]);
    let s = loot / (defense + 2) - d / 20 - (w.provRaided[p] > 0 ? 2 : 0) - w.getOpinion(me, ot) / 40;
    if (ot === w.player) s *= 0.9;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return bestScore > 0.6 ? best : NONE;
}

function tryWar(w: World, r: number, ambition: number, honor: number): void {
  const P = w.P;
  const m = w.map;
  if (seen.length !== P) seen = new Uint8Array(P);
  seen.fill(0);
  const myStr = strengthWithAllies(w, r);
  let best = NONE, bestScore = 0, bestRealm = NONE;
  for (let p = 0; p < P; p++) {
    if (w.provOwner[p] < 0 || w.top(w.provOwner[p]) !== r) continue;
    for (let e = m.adjOffset[p]; e < m.adjOffset[p + 1]; e++) {
      const q = m.adj[e];
      if (seen[q]) continue;
      seen[q] = 1;
      const o = w.provOwner[q];
      if (o < 0) continue;
      const ot = w.top(o);
      if (ot === r || w.hasTruce(r, ot) || w.isAllied(r, ot)) continue;
      if (hostagesHeldFrom(w, ot, r)) continue;
      const theirStr = strengthWithAllies(w, ot);
      const ratio = myStr / Math.max(1, theirStr);
      if (ratio < 1.25) continue;
      let s = (w.provDevelop[q] + 1) * Math.min(3, ratio - 0.8) - w.getOpinion(r, ot) / 25;
      if (w.married[r * w.R + ot]) s -= 2 + honor;
      if (m.adjSea[e]) s *= 0.6;
      s += ambition * 0.4 + w.rng.next();
      if (s > bestScore) {
        bestScore = s;
        best = q;
        bestRealm = ot;
      }
    }
  }
  if (best >= 0 && bestScore > 2.5) {
    // A much stronger realm may first demand submission instead.
    if (bestRealm === w.player && strength(w, r) > strength(w, bestRealm) * 3 && w.rng.chance(0.3)) {
      queueProposal(w, 'vassal', r, NONE, NONE, NONE, `${w.realmName[r]} demands your submission`, `Envoys of ${w.realmName[r]} arrive with a simple message: kneel, pay tribute and serve, or be destroyed.`);
      return;
    }
    declareWar(w, r, bestRealm, best, WarKind.Conquest);
  }
}

function trySubjugate(w: World, r: number): void {
  const cap = w.realmCapital[r];
  for (let o = 0; o < w.R; o++) {
    if (!w.realmAlive[o] || o === r || w.realmLiege[o] !== NONE || w.realmLandless[o] || w.realmCapital[o] < 0) continue;
    if (w.map.hopDays[w.realmCapital[o] * w.P + cap] > 25) continue;
    if (!evaluate(w, 'vassal', r, o).ok) continue;
    if (o === w.player) {
      queueProposal(w, 'vassal', r, NONE, NONE, NONE, `${w.realmName[r]} demands your submission`, `${w.realmName[r]} is far stronger than us. Their envoys demand that we become their tributary vassal.`);
    } else {
      enact(w, 'vassal', r, o);
      if (w.player !== NONE && w.isFullDetail(r)) w.addLog('world', `${w.realmName[o]} has submitted to ${w.realmName[r]}.`);
    }
    return;
  }
}

function tryAlliance(w: World, r: number): void {
  if (w.realmLiege[r] !== NONE) return;
  const cap = w.realmCapital[r];
  let best = NONE, bestOp = -1e9;
  for (let o = 0; o < w.R; o++) {
    if (!w.realmAlive[o] || o === r || w.realmLiege[o] !== NONE || w.realmLandless[o] || w.isAllied(r, o) || w.realmCapital[o] < 0) continue;
    if (w.map.hopDays[w.realmCapital[o] * w.P + cap] > 35) continue;
    const op = w.getOpinion(r, o) + w.getOpinion(o, r);
    if (op > bestOp) {
      bestOp = op;
      best = o;
    }
  }
  if (best < 0) return;
  if (best === w.player) {
    if (bestOp > 10) queueProposal(w, 'alliance', r, NONE, NONE, NONE, `${w.realmName[r]} proposes an alliance`, `Envoys from ${w.realmName[r]} propose a defensive alliance: if either of us is attacked, the other will march.`);
    return;
  }
  if (evaluate(w, 'alliance', r, best).ok) enact(w, 'alliance', r, best);
}

/** Monthly courtship between AI ruling families and the player. Rare, to keep the queue sane. */
export function proposeMarriageToPlayer(w: World): void {
  if (w.player === NONE || !w.rng.chance(0.03)) return;
  const me = w.player;
  const myRuler = w.realmRuler[me];
  // Find an unmarried adult in the player's family.
  let mine = NONE;
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (w.charRealm[c] === me && w.charDynasty[c] === w.playerDynasty && w.charSpouse[c] < 0 && w.charAge[c] >= 16 && w.charHostage[c] < 0) {
      mine = c;
      if (c === myRuler) break;
    }
  }
  if (mine < 0) return;
  for (let k = 0; k < 20; k++) {
    const o = w.rng.int(w.R);
    if (!w.realmAlive[o] || o === me || w.realmLandless[o] || w.isHostile(o, me) || w.realmCapital[o] < 0) continue;
    if (w.map.hopDays[w.realmCapital[o] * w.P + w.realmCapital[me]] > 50) continue;
    for (let i = 0; i < w.aliveCount; i++) {
      const c = w.aliveChars[i];
      if (w.charRealm[c] !== o || w.charSpouse[c] >= 0 || w.charAge[c] < 16 || w.charFemale[c] === w.charFemale[mine] || w.charDynasty[c] < 0) continue;
      queueProposal(
        w,
        'marriage',
        o,
        c,
        mine,
        NONE,
        `A marriage offer from ${w.realmName[o]}`,
        `${w.realmName[o]} offers ${w.charFullName(c)} (${w.charAge[c]}) in marriage to ${w.charFullName(mine)} (${w.charAge[mine]}). The match would bind our houses together.`,
      );
      return;
    }
  }
}
