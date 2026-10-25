import { World, NONE, WarKind, DAYS_PER_YEAR, WAR_CAP } from '../world';
import { aiAxis } from './characters';
import { strength, strengthWithAllies } from './realms';
import { atWar, declareWar, joinWar } from './war';
import { AXIS_HONOR, AXIS_AGGRESSION, AXIS_GREED } from '../content';

/**
 * Relations between realms beyond war: trade pacts, grudges, reputation (infamy),
 * remembered slights, betrayals and the reactions they provoke, and coalitions
 * against realms that have made themselves feared.
 */

export const enum Betrayal {
  /** Declared war while a truce held. */
  Truce = 0,
  /** Raided an ally. */
  RaidAlly = 1,
  /** Raided a realm we had a truce with. */
  RaidTruce = 2,
  /** Raided a trade partner. */
  RaidTrade = 3,
  /** Tore up a trade pact. */
  TradeCancel = 4,
  /** Went to war with a trade partner. */
  TradeWar = 5,
  /** Broke an alliance in peacetime. */
  AllianceBreak = 6,
  /** Refused to defend an ally. */
  Abandon = 7,
}

const MEMORY_YEARS = 12;
/** Capitals further apart than this (days) are too far for caravans. */
export const TRADE_RANGE = 70;
/** Realms this close to an offender's capital hear of its crimes. */
const NEWS_RANGE = 45;
export const COALITION_INFAMY = 45;
export const COALITION_WAR_INFAMY = 65;

export const INFAMY_LEVELS = [
  { min: 0, name: 'Trusted', desc: 'Our word is good. Others deal with us freely.' },
  { min: 10, name: 'Wary', desc: 'Neighbors keep an eye on us.' },
  { min: 30, name: 'Distrusted', desc: 'Few will sign pacts with us; our neighbors talk of banding together.' },
  { min: COALITION_INFAMY, name: 'Infamous', desc: 'Our neighbors are forming a coalition against us.' },
  { min: COALITION_WAR_INFAMY, name: 'Pariah', desc: 'Every realm around us fears us. A coalition may march against us at any time.' },
];

export function infamyLevel(v: number): { name: string; desc: string } {
  let l = INFAMY_LEVELS[0];
  for (const x of INFAMY_LEVELS) if (v >= x.min) l = x;
  return l;
}

const honorOf = (w: World, r: number) => aiAxis(w, w.realmRuler[r], AXIS_HONOR);

export function addInfamy(w: World, r: number, v: number): void {
  if (r < 0 || w.realmLandless[r]) return;
  w.realmInfamy[r] = Math.min(100, w.realmInfamy[r] + v);
}

export function addGrudge(w: World, a: number, b: number, v: number): void {
  const i = a * w.R + b;
  w.grudge[i] = Math.max(0, Math.min(100, w.grudge[i] + v));
}

export function getGrudge(w: World, a: number, b: number): number {
  return w.grudge[a * w.R + b];
}

export function hasTradePact(w: World, a: number, b: number): boolean {
  return w.tradePact[a * w.R + b] === 1;
}

export function setTradePact(w: World, a: number, b: number, v: boolean): void {
  w.tradePact[a * w.R + b] = w.tradePact[b * w.R + a] = v ? 1 : 0;
}

/** Realm a changes its opinion of b, and remembers why if the player is involved. */
export function remember(w: World, a: number, b: number, value: number, text: string): void {
  if (a === b || a < 0 || b < 0) return;
  w.addOpinion(a, b, value);
  if (w.player === NONE || (a !== w.player && b !== w.player)) return;
  w.memories.push({ a, b, day: w.day, value, text });
  if (w.memories.length > 400) w.memories.splice(0, w.memories.length - 400);
}

/** Trade goods a month each partner earns from a pact with `other`. */
export function pactIncome(w: World, other: number): number {
  return Math.min(2.5, 0.4 + 0.2 * Math.max(0, w.realmIncome[other]));
}

function capitalDays(w: World, a: number, b: number): number {
  const ca = w.realmCapital[a], cb = w.realmCapital[b];
  if (ca < 0 || cb < 0) return 0xffff;
  return w.map.hopDays[ca * w.P + cb];
}

export function inTradeRange(w: World, a: number, b: number): boolean {
  return capitalDays(w, a, b) <= TRADE_RANGE;
}

/** Everyone near the offender hears of the deed and thinks less of them; the honorable most of all. */
function outrage(w: World, offender: number, victim: number, base: number, text: string): void {
  for (let o = 0; o < w.R; o++) {
    if (!w.realmAlive[o] || o === offender || o === victim || w.realmLandless[o] || w.top(o) === w.top(offender)) continue;
    if (Math.min(capitalDays(w, o, offender), capitalDays(w, o, victim)) > NEWS_RANGE) continue;
    const v = Math.round(base * Math.max(0.3, 1 + 0.35 * honorOf(w, o)));
    if (v > 0) remember(w, o, offender, -v, text);
  }
}

/** The deed told from the offender's side: "${who} broke a sworn truce with Hatti". */
const DEED: ((v: string, our: string) => string)[] = [
  (v) => `broke a sworn truce with ${v}`,
  (v, our) => `raided ${v}, ${our} ally`,
  (v) => `raided ${v} during a truce`,
  (v, our) => `raided ${v}, ${our} trade partner`,
  (v, our) => `tore up ${our} trade pact with ${v}`,
  (v, our) => `went to war with ${v}, ${our} trade partner`,
  (v, our) => `broke ${our} alliance with ${v}`,
  (v, our) => `abandoned ${v}, ${our} ally, when it called for help`,
];
const BETRAYAL_TEXT = ['broke a sworn truce', 'raided us while we were allies', 'raided us during a truce', 'raided us while we traded in peace', 'tore up our trade pact', 'made war on us while our caravans still traded', 'broke our alliance', 'abandoned us when we called for help'];

/**
 * Offender wronged victim. Applies opinion, grudge, infamy and prestige, tells everyone,
 * then lets the victim react: an AI swears vengeance, the player is asked.
 */
export function betray(w: World, offender: number, victim: number, kind: Betrayal): void {
  offender = w.top(offender);
  victim = w.top(victim);
  if (offender === victim || !w.realmAlive[offender] || !w.realmAlive[victim]) return;
  const R = w.R;
  const what = BETRAYAL_TEXT[kind];
  // A wrong done to a realm that already wronged us counts for less.
  const justified = getGrudge(w, offender, victim) >= 40;
  let op = 0, grudge = 0, infamy = 0, prestige = 0, news = 0;
  switch (kind) {
    case Betrayal.Truce:
      op = 50; grudge = 60; infamy = 30; prestige = 25; news = 15;
      w.realmStability[offender] = Math.max(0, w.realmStability[offender] - 10);
      break;
    case Betrayal.RaidAlly:
      op = 60; grudge = 70; infamy = 20; prestige = 10; news = 10;
      w.setAllied(offender, victim, false);
      setTradePact(w, offender, victim, false);
      break;
    case Betrayal.RaidTruce:
      op = 30; grudge = 35; infamy = 10; news = 5;
      // The truce is void: the victim may now strike back freely.
      w.truceUntil[offender * R + victim] = w.truceUntil[victim * R + offender] = 0;
      break;
    case Betrayal.RaidTrade:
      op = 25; grudge = 25; infamy = 3;
      setTradePact(w, offender, victim, false);
      break;
    case Betrayal.TradeCancel:
      op = 25; grudge = 20; infamy = 4;
      setTradePact(w, offender, victim, false);
      break;
    case Betrayal.TradeWar:
      op = 10; grudge = 15;
      setTradePact(w, offender, victim, false);
      break;
    case Betrayal.AllianceBreak:
      op = 30; grudge = 25; infamy = atWar(w, victim) ? 12 : 6; news = 3;
      w.setAllied(offender, victim, false);
      break;
    case Betrayal.Abandon:
      op = 40; grudge = 40; infamy = 5; prestige = 15; news = 6;
      w.setAllied(offender, victim, false);
      break;
  }
  if (justified) {
    infamy *= 0.4;
    news *= 0.3;
  }
  remember(w, victim, offender, -op, `They ${what}`);
  addGrudge(w, victim, offender, grudge);
  addInfamy(w, offender, infamy);
  if (prestige) w.realmPrestige[offender] = Math.max(0, w.realmPrestige[offender] - prestige);
  if (news) outrage(w, offender, victim, news, `They ${DEED[kind](w.realmName[victim], 'their')}`);

  const me = w.player !== NONE ? w.top(w.player) : NONE;
  if (offender === me) {
    w.addLog('bad', `We ${DEED[kind](w.realmName[victim], 'our')}. ${w.realmName[victim]} will not forget${infamy >= 10 ? ', and neither will our neighbors' : ''}.`);
  } else if (victim === me) {
    w.addLog('bad', `${w.realmName[offender]} ${what}!`);
  } else if (w.player !== NONE && infamy >= 10 && (w.isFullDetail(offender) || w.isFullDetail(victim))) {
    w.addLog('world', `${w.realmName[offender]} ${DEED[kind](w.realmName[victim], 'its')}.`);
  }
  react(w, victim, offender, kind);
}

/** The victim's answer to a betrayal. */
function react(w: World, victim: number, offender: number, kind: Betrayal): void {
  // A war already answers a broken truce or a war on a trade partner.
  if (kind === Betrayal.Truce || kind === Betrayal.TradeWar) return;
  if (w.isHostile(victim, offender)) return;
  const me = w.player !== NONE ? w.top(w.player) : NONE;
  const severe = kind === Betrayal.RaidAlly || kind === Betrayal.RaidTruce || kind === Betrayal.Abandon || kind === Betrayal.AllianceBreak;
  if (victim === me) {
    if (!severe) return;
    w.playerQueue.push({
      uid: w.nextUid++,
      kind: 'proposal',
      title: `Betrayed by ${w.realmName[offender]}`,
      text: `${w.realmName[offender]} ${BETRAYAL_TEXT[kind]}. The court demands an answer.`,
      options: [
        { label: 'Swear vengeance', tooltip: 'Declare war on them. No one will blame us for it.' },
        { label: 'Demand reparations', tooltip: 'They pay in trade goods if they fear us; otherwise they refuse.' },
        { label: 'Let it pass', tooltip: 'Prestige -5. The grudge fades sooner.' },
      ],
      proposal: { type: 'betrayal', from: offender, a: kind },
    });
    return;
  }
  if (victim === w.player) return; // the player is a vassal: no AI reactions on their behalf
  if (w.realmLiege[victim] !== NONE || w.realmLandless[victim] || w.realmLandless[offender]) return;
  // Cut ties.
  w.setAllied(victim, offender, false);
  if (hasTradePact(w, victim, offender)) setTradePact(w, victim, offender, false);
  // Only a raid on friends or a broken truce is worth a war; lesser slights are remembered.
  if (!severe || kind === Betrayal.AllianceBreak) {
    if (severe) seekAllyAgainst(w, victim, offender);
    return;
  }
  const aggr = aiAxis(w, w.realmRuler[victim], AXIS_AGGRESSION);
  const ratio = strengthWithAllies(w, victim) / Math.max(1, strength(w, offender));
  if (!atWar(w, victim) && ratio >= 1 && w.rng.chance(0.4 + 0.15 * aggr)) {
    if (revengeWar(w, victim, offender)) return;
  }
  // Too weak to strike now: find friends among the offender's other enemies.
  seekAllyAgainst(w, victim, offender);
}

/** Declare a war of vengeance on the offender, aimed at its land nearest us. */
export function revengeWar(w: World, r: number, offender: number): boolean {
  const target = nearestProvinceOf(w, offender, w.realmCapital[r]);
  if (target < 0) return false;
  const me = w.player !== NONE ? w.top(w.player) : NONE;
  w.truceUntil[r * w.R + offender] = w.truceUntil[offender * w.R + r] = 0;
  const war = declareWar(w, r, offender, target, WarKind.Conquest, true);
  if (war < 0) return false;
  if (offender === me) w.addLog('war', `${w.realmName[r]} swears vengeance and marches on ${w.scenario.provinces[target].name}!`, target);
  else if (w.player !== NONE && w.isFullDetail(r)) w.addLog('world', `${w.realmName[r]} takes revenge on ${w.realmName[offender]}.`, target);
  return true;
}

function nearestProvinceOf(w: World, r: number, from: number): number {
  if (from < 0) return w.realmCapital[r];
  let best = NONE, bd = 1e9;
  for (let p = 0; p < w.P; p++) {
    if (w.provOwner[p] < 0 || w.top(w.provOwner[p]) !== r) continue;
    const d = w.map.hopDays[p * w.P + from];
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function seekAllyAgainst(w: World, r: number, offender: number): void {
  let best = NONE, bestV = 0;
  for (let o = 0; o < w.R; o++) {
    if (!w.realmAlive[o] || o === r || o === offender || w.realmLiege[o] !== NONE || w.realmLandless[o] || w.isAllied(r, o) || o === w.player) continue;
    if (w.isHostile(o, r) || capitalDays(w, o, r) > 40) continue;
    const hate = getGrudge(w, o, offender) - w.getOpinion(o, offender);
    const v = hate + w.getOpinion(o, r);
    if (hate > 20 && v > bestV) {
      bestV = v;
      best = o;
    }
  }
  if (best >= 0) {
    w.setAllied(r, best, true);
    if (w.player !== NONE && w.concernsPlayer(offender)) w.addLog('bad', `${w.realmName[r]} and ${w.realmName[best]} have allied against us.`);
  }
}

/** The player answered a betrayal notice: 0 vengeance, 1 reparations, 2 let it pass. */
export function answerBetrayal(w: World, offender: number, option: number): void {
  const me = w.top(w.player);
  if (!w.realmAlive[offender]) return;
  if (option === 0) {
    if (w.realmLiege[w.player] !== NONE) {
      w.addLog('info', 'As a vassal we cannot make war of our own.');
      return;
    }
    if (w.isHostile(me, offender)) return;
    if (!revengeWar(w, me, offender)) w.addLog('info', `We could find no way to strike at ${w.realmName[offender]}.`);
    return;
  }
  if (option === 1) {
    const ratio = strengthWithAllies(w, me) / Math.max(1, strengthWithAllies(w, offender));
    const honor = honorOf(w, offender);
    if (ratio >= 1.2 || (ratio >= 0.8 && honor > 0.5)) {
      const pay = Math.min(w.realmTrade[offender], 15 + 20 * Math.min(2, ratio));
      w.realmTrade[offender] -= pay;
      w.realmTrade[me] += pay;
      addGrudge(w, me, offender, -40);
      remember(w, me, offender, 15, 'They paid reparations');
      w.addLog('good', `${w.realmName[offender]} pays ${Math.round(pay)} trade goods in reparations.`);
    } else {
      remember(w, offender, me, -10, 'We made demands they scorned');
      w.addLog('bad', `${w.realmName[offender]} laughs at our envoys and pays nothing.`);
    }
    return;
  }
  w.realmPrestige[me] = Math.max(0, w.realmPrestige[me] - 5);
  addGrudge(w, me, offender, -30);
}

/** Raider realm is sending raiders against victim: is that a betrayal? */
export function raidBetrayal(w: World, raider: number, victim: number): void {
  raider = w.top(raider);
  victim = w.top(victim);
  if (raider === victim || w.realmLandless[raider]) return;
  addInfamy(w, raider, 1.5);
  if (w.isAllied(raider, victim)) betray(w, raider, victim, Betrayal.RaidAlly);
  else if (w.hasTruce(raider, victim)) betray(w, raider, victim, Betrayal.RaidTruce);
  else if (hasTradePact(w, raider, victim)) betray(w, raider, victim, Betrayal.RaidTrade);
}

/** Helpers for the war code: a call to arms an ally answers. */
export function willAnswerCall(w: World, ally: number, leader: number, enemy: number, defensive: boolean): boolean {
  const honor = honorOf(w, ally);
  let v = w.getOpinion(ally, leader) + honor * 10 + (w.married[ally * w.R + leader] ? 15 : 0) - getGrudge(w, ally, leader);
  v -= w.getOpinion(ally, enemy) > 30 ? 20 : 0;
  v += getGrudge(w, ally, enemy) / 2;
  if (defensive) return v > -25 || honor >= 1;
  if (atWar(w, ally)) return false;
  return v >= 15;
}

/** Monthly: trade pays, ties drift, grudges and infamy fade, coalitions gather. */
export function relationsMonthly(w: World): void {
  const R = w.R;
  for (let a = 0; a < R; a++) {
    if (!w.realmAlive[a]) continue;
    const base = a * R;
    for (let b = a + 1; b < R; b++) {
      if (!w.tradePact[base + b] && !w.allied[base + b]) continue;
      if (!w.realmAlive[b]) {
        w.tradePact[base + b] = w.tradePact[b * R + a] = 0;
        continue;
      }
      if (w.tradePact[base + b]) {
        if (w.isHostile(a, b)) {
          setTradePact(w, a, b, false);
          continue;
        }
        w.realmTrade[a] += pactIncome(w, b);
        w.realmTrade[b] += pactIncome(w, a);
        if (w.opinion[base + b] < 40) w.addOpinion(a, b, 1);
        if (w.opinion[b * R + a] < 40) w.addOpinion(b, a, 1);
      }
      if (w.allied[base + b]) {
        if (w.opinion[base + b] < 50) w.addOpinion(a, b, 1);
        if (w.opinion[b * R + a] < 50) w.addOpinion(b, a, 1);
      }
      // AI realms drop ties with partners they have come to hate.
      for (const [x, y] of [[a, b], [b, a]]) {
        if (x === w.player || w.opinion[x * R + y] >= -35 || !w.rng.chance(0.25)) continue;
        if (w.allied[x * R + y]) betray(w, x, y, Betrayal.AllianceBreak);
        else if (w.tradePact[x * R + y]) betray(w, x, y, Betrayal.TradeCancel);
        break;
      }
    }
    // Grudges fade a point a month.
    for (let b = 0; b < R; b++) if (w.grudge[base + b]) w.grudge[base + b]--;
    if (w.realmInfamy[a] > 0) w.realmInfamy[a] = Math.max(0, w.realmInfamy[a] - 0.5 - 0.15 * Math.max(0, honorOf(w, a)));
  }
  const cut = w.day - MEMORY_YEARS * DAYS_PER_YEAR;
  if (w.memories.length && w.memories[0].day < cut) w.memories = w.memories.filter((m) => m.day >= cut);
  coalitionsMonthly(w);
}

/** Realms that fear an infamous neighbor band together, and may march on it. */
function coalitionsMonthly(w: World): void {
  const R = w.R;
  const me = w.player !== NONE ? w.top(w.player) : NONE;
  for (let x = 0; x < R; x++) {
    if (!w.realmAlive[x]) continue;
    const inf = w.realmInfamy[x];
    if (inf < 25) {
      // Fear fades: the coalition breaks up (its pacts remain).
      for (let o = 0; o < R; o++) if (w.realmCoalition[o] === x) w.realmCoalition[o] = NONE;
      continue;
    }
    if (inf < COALITION_INFAMY || w.realmLandless[x] || w.realmLiege[x] !== NONE) continue;
    const members: number[] = [];
    let joined = 0;
    for (let o = 0; o < R; o++) {
      if (!w.realmAlive[o] || o === x || w.realmLandless[o] || w.realmLiege[o] !== NONE || w.isAllied(o, x)) continue;
      if (capitalDays(w, o, x) > 40) continue;
      if (w.realmCoalition[o] !== x) {
        if (w.realmCoalition[o] !== NONE || o === me) continue;
        if (w.getOpinion(o, x) - getGrudge(w, o, x) > -10 - (inf - COALITION_INFAMY)) continue;
        w.realmCoalition[o] = x;
        joined++;
      }
      members.push(o);
    }
    if (members.length < 2) continue;
    if (joined) {
      // Members pledge to stand together.
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        if (!w.isHostile(members[i], members[j])) w.setAllied(members[i], members[j], true);
      }
      if (x === me) w.addLog('bad', `Fearing us, ${members.map((m) => w.realmName[m]).join(', ')} have joined a coalition against us.`);
      else if (w.player !== NONE && w.isFullDetail(x)) w.addLog('world', `A coalition forms against ${w.realmName[x]}.`);
    }
    if (inf < COALITION_WAR_INFAMY || atWar(w, x) || !w.rng.chance(0.2)) continue;
    let total = 0, leader = NONE, best = 0;
    const ready = members.filter((o) => !atWar(w, o) && !w.hasTruce(o, x));
    for (const o of ready) {
      const s = strength(w, o);
      total += s;
      if (s > best) {
        best = s;
        leader = o;
      }
    }
    if (leader < 0 || ready.length < 2 || total < 1.2 * strengthWithAllies(w, x)) continue;
    const target = nearestProvinceOf(w, x, w.realmCapital[leader]);
    if (target < 0) continue;
    const war = declareWar(w, leader, x, target, WarKind.Conquest, true);
    if (war < 0) continue;
    for (const o of ready) if (o !== leader) joinWar(w, war, o, 1);
    const names = ready.map((o) => w.realmName[o]).join(', ');
    if (x === me) w.addLog('war', `The coalition marches! ${names} have declared war on us together.`, target);
    else if (w.player !== NONE && w.isFullDetail(x)) w.addLog('world', `${names} march together against ${w.realmName[x]}.`, target);
    // Fear spent on a war: the infamy cools.
    w.realmInfamy[x] *= 0.75;
    break;
  }
}

/** AI: look for a trade partner. */
export function tryTrade(w: World, r: number): void {
  const greed = aiAxis(w, w.realmRuler[r], AXIS_GREED);
  let best = NONE, bestV = -1e9;
  for (let o = 0; o < w.R; o++) {
    if (!w.realmAlive[o] || o === r || w.realmLandless[o] || hasTradePact(w, r, o) || w.realmCapital[o] < 0) continue;
    if (w.isHostile(r, o) || !inTradeRange(w, r, o)) continue;
    const v = w.getOpinion(r, o) + w.realmIncome[o] * 4 - getGrudge(w, r, o);
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  if (best < 0 || bestV < -5 - greed * 5) return;
  if (best === w.player) {
    if (w.rng.chance(0.4)) {
      w.playerQueue.some((q) => q.proposal?.type === 'trade' && q.proposal.from === r) ||
        w.playerQueue.push({
          uid: w.nextUid++,
          kind: 'proposal',
          title: `${w.realmName[r]} proposes a trade pact`,
          text: `Merchants of ${w.realmName[r]} propose a trade pact. Caravans and ships would carry goods between us, about ${pactIncome(w, r).toFixed(1)} trade goods a month for us. Going to war with them, or raiding them, would end it.`,
          options: [{ label: 'Accept' }, { label: 'Refuse' }],
          proposal: { type: 'trade', from: r },
        });
    }
    return;
  }
  const v = evaluateTrade(w, r, best);
  if (v.ok) {
    setTradePact(w, r, best, true);
    w.addOpinionBoth(r, best, 10);
  }
}

/** Trade pacts a realm can keep: its merchants and caravans are few. */
export function maxPacts(w: World, r: number): number {
  return Math.min(5, 1 + Math.floor(w.realmProvCount[r] / 3));
}

export function pactCount(w: World, r: number): number {
  let n = 0;
  for (let o = 0; o < w.R; o++) n += w.tradePact[r * w.R + o];
  return n;
}

export function evaluateTrade(w: World, from: number, to: number): { ok: boolean; reason: string } {
  if (w.isHostile(from, to)) return { ok: false, reason: 'We are at war.' };
  if (hasTradePact(w, from, to)) return { ok: false, reason: 'We already trade.' };
  if (!inTradeRange(w, from, to)) return { ok: false, reason: 'Too far for caravans.' };
  if (pactCount(w, from) >= maxPacts(w, from)) return { ok: false, reason: `We have no caravans to spare (${maxPacts(w, from)} pacts at most; more land allows more).` };
  if (pactCount(w, to) >= maxPacts(w, to)) return { ok: false, reason: 'Their merchants are all busy with other partners.' };
  const op = w.getOpinion(to, from);
  const greed = aiAxis(w, w.realmRuler[to], AXIS_GREED);
  const v = op + 15 + greed * 5 + (w.married[to * w.R + from] ? 10 : 0) - w.realmInfamy[from] / 3 - getGrudge(w, to, from) / 2;
  return v >= 0 ? { ok: true, reason: 'Their merchants are eager.' } : { ok: false, reason: `They will not trade with us (opinion ${op}${getGrudge(w, to, from) ? ', they hold a grudge' : ''}).` };
}

/** Active wars where `r` fights, for UI and tests. */
export function warsOf(w: World, r: number): number[] {
  const out: number[] = [];
  const t = w.top(r);
  for (let war = 0; war < WAR_CAP; war++) if (w.warActive[war] && w.warSide[war * w.R + t]) out.push(war);
  return out;
}
