import { World, NONE, WarKind, DAYS_PER_YEAR, PendingChoice } from '../world';
import { marry, aiAxis } from './characters';
import { strength, strengthWithAllies } from './realms';
import { declareWar, endWar, atWar, joinWar } from './war';
import { evaluateTrade, setTradePact, getGrudge, addGrudge, answerBetrayal, betray, Betrayal, remember } from './relations';
import { AXIS_HONOR, AXIS_AMBITION, AXIS_GREED } from '../content';

export type ProposalType = NonNullable<PendingChoice['proposal']>['type'];

export interface Verdict {
  ok: boolean;
  reason: string;
}

/** Would realm `to` accept a proposal from realm `from`? Shared by player actions and AI. */
export function evaluate(w: World, type: ProposalType, from: number, to: number, a = NONE, b = NONE): Verdict {
  const R = w.R;
  const op = w.opinion[to * R + from];
  const ruler = w.realmRuler[to];
  const sFrom = strengthWithAllies(w, from), sTo = strengthWithAllies(w, to);
  // Treachery and old wrongs weigh on every deal.
  const distrust = w.realmInfamy[from] / 3 + getGrudge(w, to, from) / 2;
  switch (type) {
    case 'trade':
      return evaluateTrade(w, from, to);
    case 'call':
    case 'betrayal':
      return { ok: true, reason: '' };
    case 'alliance': {
      if (w.isHostile(from, to)) return { ok: false, reason: 'We are at war.' };
      if (w.realmLiege[to] !== NONE || w.realmLiege[from] !== NONE) return { ok: false, reason: 'Vassals cannot make alliances.' };
      const v = op + (w.married[to * R + from] ? 20 : 0) + (sFrom > sTo ? 10 : 0) - 25 + aiAxis(w, ruler, AXIS_HONOR) * 3 - distrust;
      return v >= 0 ? { ok: true, reason: 'They agree to stand with us.' } : { ok: false, reason: `They do not trust us enough (opinion ${op}${distrust >= 5 ? ', and they fear our treachery' : ''}).` };
    }
    case 'marriage': {
      if (a < 0 || b < 0) return { ok: false, reason: 'Choose two people to marry.' };
      if (!w.charAlive[a] || !w.charAlive[b] || w.charSpouse[a] >= 0 || w.charSpouse[b] >= 0) return { ok: false, reason: 'Both must be alive and unmarried.' };
      if (w.charFemale[a] === w.charFemale[b]) return { ok: false, reason: 'The match must be between a man and a woman.' };
      if (w.charAge[a] < 16 || w.charAge[b] < 16) return { ok: false, reason: 'Both must be of age (16).' };
      if (w.charDynasty[a] >= 0 && w.charDynasty[a] === w.charDynasty[b]) return { ok: false, reason: 'They are of the same house.' };
      if (w.isHostile(from, to)) return { ok: false, reason: 'We are at war.' };
      const prestigeGap = (w.realmPrestige[from] - w.realmPrestige[to]) / 6;
      const isTheirRuler = w.realmRuler[to] === b;
      const v = op + prestigeGap + 15 - (isTheirRuler ? 15 : 0) + (sFrom > sTo ? 8 : -4) - distrust / 2;
      return v >= 0 ? { ok: true, reason: 'The match is accepted.' } : { ok: false, reason: `They think the match beneath them (opinion ${op}).` };
    }
    case 'vassal': {
      if (w.realmLiege[to] !== NONE) return { ok: false, reason: 'They already serve a liege.' };
      if (w.isHostile(from, to)) return { ok: false, reason: 'We are at war.' };
      const ratio = sFrom / Math.max(1, sTo);
      const pride = aiAxis(w, ruler, AXIS_AMBITION) * 0.4;
      if (ratio >= 4 + pride || (ratio >= 2.5 + pride && op >= -10)) return { ok: true, reason: 'They bow, rather than burn.' };
      return { ok: false, reason: `They will not submit (we are ${ratio.toFixed(1)}x their strength).` };
    }
    case 'hostage': {
      if (w.isHostile(from, to)) return { ok: false, reason: 'We are at war.' };
      const ratio = sFrom / Math.max(1, sTo);
      if (ratio >= 1.5 && op >= -30) return { ok: true, reason: 'They send a child to our court as a pledge.' };
      return { ok: false, reason: `They refuse to give hostages (we are ${ratio.toFixed(1)}x their strength).` };
    }
    case 'peace':
      return { ok: true, reason: '' };
  }
}

/** The youngest child of the ruler who is not the obvious heir, else any family member. */
function pickHostage(w: World, r: number): number {
  const ruler = w.realmRuler[r];
  let best = NONE, bestAge = 1e9;
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (!w.charAlive[c] || c === ruler || w.charHostage[c] >= 0 || w.charRealm[c] !== r) continue;
    if (w.charFather[c] !== ruler && w.charMother[c] !== ruler) continue;
    if (w.charAge[c] < bestAge && w.charAge[c] >= 3) {
      best = c;
      bestAge = w.charAge[c];
    }
  }
  return best;
}

/** Apply an accepted proposal. */
export function enact(w: World, type: ProposalType, from: number, to: number, a = NONE, b = NONE): void {
  switch (type) {
    case 'alliance':
      w.setAllied(from, to, true);
      w.addOpinionBoth(from, to, 15);
      break;
    case 'marriage':
      marry(w, a, b);
      w.addOpinionBoth(from, to, 10);
      break;
    case 'vassal':
      w.realmLiege[to] = from;
      w.realmLoyalty[to] = 50;
      w.setAllied(from, to, false);
      w.realmPrestige[from] += 10;
      w.realmsDirty = true;
      break;
    case 'hostage': {
      const h = pickHostage(w, to);
      if (h >= 0) {
        w.charHostage[h] = from;
        w.realmPrestige[from] += 5;
        w.addOpinion(to, from, -5);
        w.setTruce(from, to, 10 * DAYS_PER_YEAR);
      }
      break;
    }
    case 'trade':
      setTradePact(w, from, to, true);
      w.addOpinionBoth(from, to, 10);
      break;
    case 'peace':
    case 'call':
    case 'betrayal':
      break;
  }
}

/** Queue a proposal from an AI realm to the player. */
export function queueProposal(w: World, type: ProposalType, from: number, a: number, b: number, war: number, title: string, text: string): void {
  if (w.playerQueue.some((q) => q.kind === 'proposal' && q.proposal?.type === type && q.proposal.from === from)) return;
  w.playerQueue.push({
    uid: w.nextUid++,
    kind: 'proposal',
    title,
    text,
    options: [{ label: 'Accept' }, { label: 'Refuse' }],
    proposal: { type, from, a, b, war },
  });
}

/** The player answered an AI proposal. */
export function answerProposal(w: World, q: PendingChoice, option: number): void {
  const pr = q.proposal!;
  const me = w.player;
  const accept = option === 0;
  if (pr.type === 'betrayal') {
    answerBetrayal(w, pr.from, option);
    return;
  }
  if (pr.type === 'call') {
    const war = pr.war ?? NONE;
    const side = pr.a ?? 2;
    if (war < 0 || !w.warActive[war]) {
      if (accept) w.addLog('info', 'That war is already over.');
      return;
    }
    const leader = side === 1 ? w.warAttacker[war] : w.warDefender[war];
    const top = w.top(me);
    if (accept) {
      if (w.warSide[war * w.R + top]) return;
      joinWar(w, war, top, side);
      w.realmPrestige[top] += 5;
      remember(w, leader, top, 15, 'They answered our call to arms');
      w.addLog('war', `We march to war beside ${w.realmName[leader]}. Our levy is gathering: select it and right-click where it should go.`);
    } else if (side === 2) betray(w, top, leader, Betrayal.Abandon);
    else remember(w, leader, top, -10, 'They refused our call to arms');
    return;
  }
  if (pr.type === 'peace') {
    const war = pr.war ?? NONE;
    if (war < 0 || !w.warActive[war]) return;
    if (accept) endWar(w, war, w.warAttacker[war] === w.top(me) ? 'defender' : 'attacker');
    return;
  }
  if (!w.realmAlive[pr.from]) return;
  if (!accept) {
    w.addOpinion(pr.from, me, -10);
    if (pr.type === 'vassal' && w.rng.chance(0.6) && !w.hasTruce(pr.from, me) && !atWar(w, pr.from)) {
      declareWar(w, pr.from, me, w.realmCapital[me], WarKind.Subjugation);
    }
    return;
  }
  if (pr.type === 'vassal') enact(w, 'vassal', pr.from, me);
  else if (pr.type === 'hostage') enact(w, 'hostage', pr.from, me);
  else if (pr.type === 'marriage') {
    if (evaluate(w, 'marriage', pr.from, me, pr.a, pr.b).ok || (w.charAlive[pr.a!] && w.charAlive[pr.b!])) enact(w, 'marriage', pr.from, me, pr.a, pr.b);
  } else enact(w, pr.type, pr.from, me);
  w.addLog('info', `You accepted: ${q.title}.`);
}

/** Monthly vassal loyalty drift and independence bids. */
export function vassalsMonthly(w: World): void {
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r]) continue;
    const l = w.realmLiege[r];
    if (l < 0) continue;
    const ruler = w.realmRuler[r];
    let target = 45 + (w.realmPrestige[l] - w.realmPrestige[r]) / 8 + w.realmStability[l] / 5 - 10;
    target += w.opinion[r * w.R + l] / 5;
    if (w.married[r * w.R + l]) target += 8;
    target -= aiAxis(w, ruler, AXIS_AMBITION) * 5;
    target += aiAxis(w, ruler, AXIS_HONOR) * 3;
    // Holding a hostage from the vassal keeps them in line.
    for (let i = 0; i < w.aliveCount; i++) {
      const c = w.aliveChars[i];
      if (w.charHostage[c] === l && w.charRealm[c] === r) {
        target += 15;
        break;
      }
    }
    if (atWar(w, l)) target -= 5;
    w.realmLoyalty[r] += (Math.max(0, Math.min(100, target)) - w.realmLoyalty[r]) * 0.05;

    // Rebellion: a disloyal vassal that thinks it can win.
    if (r !== w.player && w.realmLoyalty[r] < 22 && !atWar(w, r)) {
      const top = w.top(l);
      if (strength(w, r) * 1.6 > strength(w, top) * (w.realmLoyalty[r] / 30) && w.rng.chance(0.2)) {
        if (w.concernsPlayer(top) || w.isFullDetail(r)) w.addLog(w.concernsPlayer(top) ? 'bad' : 'world', `${w.realmName[r]} rises in rebellion against ${w.realmName[l]}!`);
        declareWar(w, r, l, w.realmCapital[r], WarKind.Independence);
      }
    }
  }
}

/** Monthly: hostages grow up and go home after a while. */
export function hostagesYearly(w: World): void {
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (w.charHostage[c] >= 0 && (w.charAge[c] >= 20 || !w.realmAlive[w.charHostage[c]]) && w.rng.chance(0.5)) w.charHostage[c] = NONE;
  }
}

export function gift(w: World, from: number, to: number, amount: number): void {
  w.realmTrade[from] -= amount;
  w.realmTrade[to] += amount;
  const greed = aiAxis(w, w.realmRuler[to], AXIS_GREED);
  w.addOpinion(to, from, Math.round(amount * (0.5 + 0.1 * greed)));
  addGrudge(w, to, from, -5);
}
