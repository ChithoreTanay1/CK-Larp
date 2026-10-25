import { World, NONE, PLOT_CAP, PlotKind } from '../world';
import { killChar, aiAxis, T } from './characters';
import { mergeRealm, setRuler } from './realms';
import { AXIS_SCHEMING, AXIS_AMBITION, AXIS_HONOR } from '../content';
import { addGrudge, addInfamy, getGrudge, remember } from './relations';

/** Name, bribe cost (trade goods) and speed of each kind of scheme. */
export const PLOTS = [
  { name: 'Murder', cost: 20, speed: 1, desc: 'Poison or a knife in the dark. If discovered, their realm will hate us for a generation.' },
  { name: 'Usurp the throne', cost: 20, speed: 1, desc: 'Seize the throne of our own liege.' },
  { name: 'Sway', cost: 15, speed: 1.6, desc: 'Gifts and flattery: their ruler comes to like us (opinion +30) and old grudges soften.' },
  { name: 'Incite unrest', cost: 20, speed: 1.2, desc: 'Agitators stir up their people: stability -20 and unrest in their richest lands.' },
  { name: 'Fabricate claim', cost: 25, speed: 0.9, desc: 'Forge old tablets that prove a province is ours. A war for a claimed province earns almost no infamy.' },
  { name: 'Steal treasure', cost: 10, speed: 1.3, desc: 'Bribed servants empty part of their treasury into ours.' },
];

export function plotName(k: number): string {
  return PLOTS[k]?.name ?? 'Plot';
}

export function startPlot(w: World, owner: number, target: number, kind: PlotKind, prov = NONE): number {
  for (let p = 0; p < PLOT_CAP; p++) {
    if (w.plotActive[p] && w.plotOwner[p] === owner) return NONE; // one plot at a time
  }
  for (let p = 0; p < PLOT_CAP; p++) {
    if (w.plotActive[p]) continue;
    w.plotActive[p] = 1;
    w.plotOwner[p] = owner;
    w.plotTarget[p] = target;
    w.plotKind[p] = kind;
    w.plotProgress[p] = 0;
    w.plotSecrecy[p] = 1;
    w.plotProv[p] = prov;
    return p;
  }
  return NONE;
}

/** Monthly progress, secrecy decay and the discovery roll. */
export function plotsMonthly(w: World): void {
  for (let p = 0; p < PLOT_CAP; p++) {
    if (!w.plotActive[p]) continue;
    const o = w.plotOwner[p], t = w.plotTarget[p];
    if (!w.charAlive[o] || !w.charAlive[t]) {
      w.plotActive[p] = 0;
      continue;
    }
    w.plotProgress[p] += (0.04 + w.charIntrigue[o] / 220 + w.rng.next() * 0.04) * (PLOTS[w.plotKind[p]]?.speed ?? 1);
    w.plotSecrecy[p] = Math.max(0, w.plotSecrecy[p] - 0.03 - w.rng.next() * 0.04 + w.charIntrigue[o] / 600);
    const tRealm = w.charRealm[t];
    const spymaster = tRealm >= 0 ? w.realmRuler[tRealm] : NONE;
    const vigilance = spymaster >= 0 ? w.charIntrigue[spymaster] / 25 + (w.hasTrait(spymaster, T.paranoid) ? 0.4 : 0) : 0.2;
    if (w.rng.chance((1 - w.plotSecrecy[p]) * vigilance * 0.25)) {
      discovered(w, p);
      continue;
    }
    if (w.plotProgress[p] >= 1) complete(w, p);
  }
}

function discovered(w: World, p: number): void {
  w.plotActive[p] = 0;
  const o = w.plotOwner[p], t = w.plotTarget[p];
  const oRealm = w.charRealm[o], tRealm = w.charRealm[t];
  const what = plotWhat(w, p);
  const murder = w.plotKind[p] === PlotKind.Murder || w.plotKind[p] === PlotKind.Usurp;
  if (oRealm >= 0) {
    w.realmPrestige[oRealm] = Math.max(0, w.realmPrestige[oRealm] - (murder ? 10 : 4));
    if (tRealm >= 0 && w.realmAlive[tRealm] && w.top(tRealm) !== w.top(oRealm)) {
      remember(w, w.top(tRealm), w.top(oRealm), murder ? -50 : -25, `They plotted ${what}`);
      addGrudge(w, w.top(tRealm), w.top(oRealm), murder ? 50 : 20);
      addInfamy(w, w.top(oRealm), murder ? 10 : 4);
    }
  }
  if (w.concernsPlayer(oRealm) && w.realmRuler[w.player] === o) {
    w.addLog('bad', `Our plot ${what} has been discovered! Our name is mud.`);
  } else if (tRealm >= 0 && w.concernsPlayer(tRealm)) {
    w.addLog('bad', `A plot by ${w.charFullName(o)} ${what} has been uncovered!`);
    // Courtiers caught plotting at our own court are punished.
    if (oRealm === tRealm && w.charRules[o] < 0) {
      w.playerQueue.push({
        uid: w.nextUid++,
        kind: 'event',
        title: 'A Plot Uncovered',
        text: `${w.charFullName(o)} has been caught plotting ${what}. The court waits to see what you will do.`,
        options: [{ label: 'Execute the traitor', tooltip: 'Kills the plotter. Stability +5, prestige +2.' }, { label: 'Exile them', tooltip: 'Sends them away.' }, { label: 'Forgive them', tooltip: 'Stability -5.' }],
        eventIdx: -1,
        ctx: { realm: w.player, ruler: w.realmRuler[w.player], province: w.realmCapital[w.player], region: w.realmRegion(w.player), other: NONE, char: o },
      });
    }
  } else if (oRealm === tRealm && w.charRules[o] < 0 && oRealm >= 0) {
    const ruler = w.realmRuler[oRealm];
    if (w.hasTrait(ruler, T.cruel) || w.rng.chance(0.4)) killChar(w, o, 'execution');
  }
}

/** Resolve the player's choice on a discovered courtier plot. */
export function punishPlotter(w: World, c: number, option: number): void {
  const r = w.player;
  if (option === 0) {
    killChar(w, c, 'execution');
    w.realmStability[r] = Math.min(100, w.realmStability[r] + 5);
    w.realmPrestige[r] += 2;
  } else if (option === 1) {
    // Exile to the nearest other realm.
    for (let o = 0; o < w.R; o++) {
      if (w.realmAlive[o] && o !== r && !w.realmLandless[o]) {
        w.charRealm[c] = o;
        break;
      }
    }
  } else {
    w.realmStability[r] = Math.max(0, w.realmStability[r] - 5);
  }
}

function plotWhat(w: World, p: number): string {
  const t = w.plotTarget[p];
  const tRealm = w.charRealm[t];
  const rn = tRealm >= 0 ? w.realmName[tRealm] : 'their realm';
  switch (w.plotKind[p]) {
    case PlotKind.Murder: return `to murder ${w.charFullName(t)}`;
    case PlotKind.Usurp: return `to seize the throne of ${rn}`;
    case PlotKind.Sway: return `to buy the favor of ${w.charFullName(t)}`;
    case PlotKind.Incite: return `to stir up the people of ${rn}`;
    case PlotKind.Fabricate: return `to forge a claim on ${w.plotProv[p] >= 0 ? w.scenario.provinces[w.plotProv[p]].name : 'their land'}`;
    default: return `to rob the treasury of ${rn}`;
  }
}

/** Realm-level schemes: sway, incite, fabricate, steal. */
function completeRealmPlot(w: World, p: number): void {
  const o = w.plotOwner[p], t = w.plotTarget[p];
  const mine = w.charRealm[o], tr = w.charRealm[t];
  if (mine < 0 || tr < 0 || !w.realmAlive[tr]) return;
  const me = w.top(mine), them = w.top(tr);
  const forPlayer = w.realmRuler[w.player] === o;
  const againstPlayer = w.player !== NONE && them === w.top(w.player);
  switch (w.plotKind[p]) {
    case PlotKind.Sway:
      remember(w, them, me, 30, 'Their envoys won us over');
      addGrudge(w, them, me, -30);
      if (forPlayer) w.addLog('good', `${w.charFullName(t)} has been won over. ${w.realmName[them]} thinks better of us now.`);
      return;
    case PlotKind.Incite: {
      w.realmStability[tr] = Math.max(0, w.realmStability[tr] - 20);
      // The two most populous provinces boil over.
      const ps: number[] = [];
      for (let q = 0; q < w.P; q++) if (w.provOwner[q] === tr) ps.push(q);
      ps.sort((a, b) => w.provPop[b] - w.provPop[a]);
      for (const q of ps.slice(0, 2)) w.provUnrest[q] = Math.min(100, w.provUnrest[q] + 35);
      if (forPlayer) w.addLog('good', `Our agitators have done their work: ${w.realmName[tr]} is in turmoil.`);
      else if (againstPlayer) w.addLog('bad', 'Agitators are stirring up our people. Stability falls.');
      return;
    }
    case PlotKind.Fabricate: {
      const q = w.plotProv[p];
      if (q < 0 || w.provOwner[q] < 0 || w.top(w.provOwner[q]) === me) return;
      w.provClaim[q] = me;
      w.markProv(q);
      if (forPlayer) w.addLog('good', `Our scribes have "found" old tablets: ${w.scenario.provinces[q].name} is ours by right. A war for it will earn almost no infamy.`, q);
      return;
    }
    case PlotKind.Steal: {
      const trade = Math.min(60, w.realmTrade[tr] * 0.3), metal = Math.min(20, w.realmMetal[tr] * 0.2);
      w.realmTrade[tr] -= trade;
      w.realmMetal[tr] -= metal;
      w.realmTrade[mine] += trade;
      w.realmMetal[mine] += metal;
      if (forPlayer) w.addLog('good', `Our thieves bring home ${Math.round(trade)} trade goods and ${Math.round(metal)} metal from ${w.realmName[tr]}.`);
      else if (againstPlayer) w.addLog('bad', `Our treasury has been robbed: ${Math.round(trade)} trade goods and ${Math.round(metal)} metal are gone.`);
      return;
    }
  }
}

function complete(w: World, p: number): void {
  w.plotActive[p] = 0;
  const o = w.plotOwner[p], t = w.plotTarget[p];
  if (w.plotKind[p] >= PlotKind.Sway) {
    completeRealmPlot(w, p);
    return;
  }
  if (w.plotKind[p] === PlotKind.Murder) {
    const tRealm = w.charRealm[t];
    const name = w.charFullName(t);
    killChar(w, t, 'murder');
    if (w.realmRuler[w.player] === o) w.addLog('good', `It is done. ${name} is dead, and no one suspects us.`);
    else if (tRealm >= 0 && w.concernsPlayer(tRealm)) w.addLog('bad', `${name} has been found dead. Whispers say it was poison.`);
    return;
  }
  // Usurp: the plotter (a vassal ruler) seizes their liege's throne.
  const mine = w.charRules[o];
  const liege = mine >= 0 ? w.realmLiege[mine] : NONE;
  if (mine < 0 || liege < 0 || w.realmRuler[liege] !== t) return;
  const oldName = w.charFullName(t);
  mergeRealm(w, mine, liege);
  setRuler(w, liege, o);
  w.realmStability[liege] = Math.max(0, w.realmStability[liege] - 20);
  if (w.player === liege || w.player === mine) {
    w.addLog(w.realmRuler[w.player] === o ? 'good' : 'bad', `${w.charFullName(o)} has overthrown ${oldName} and now rules ${w.realmName[liege]}.`);
  } else if (w.isFullDetail(liege)) w.addLog('world', `${w.charFullName(o)} has overthrown ${oldName} in ${w.realmName[liege]}.`);
}

/** Realms nursing a grudge pay it back in kind: theft, agitators, or the knife. */
function revengePlot(w: World, r: number, ruler: number, scheming: number): boolean {
  const R = w.R;
  let foe = NONE, worst = 30;
  for (let o = 0; o < R; o++) {
    const g = w.grudge[r * R + o];
    if (g > worst && w.realmAlive[o] && w.realmRuler[o] >= 0) {
      worst = g;
      foe = o;
    }
  }
  if (foe < 0 || !w.rng.chance(0.03 * (1 + Math.max(0, scheming)))) return false;
  const kind = worst >= 70 && scheming >= 1 ? PlotKind.Murder : w.rng.chance(0.5) ? PlotKind.Incite : PlotKind.Steal;
  const p = startPlot(w, ruler, w.realmRuler[foe], kind);
  if (p >= 0 && foe === w.player && getGrudge(w, r, foe) >= 50 && w.rng.chance(0.4)) w.addLog('bad', `Our spies warn that ${w.realmName[r]} is plotting against us.`);
  return p >= 0;
}

/**
 * Character AI for scheming: ambitious younger sons eye the heir, disloyal vassals
 * eye the throne. Runs monthly per realm, cheap and rare.
 */
export function plotAi(w: World, r: number): void {
  const ruler = w.realmRuler[r];
  if (ruler < 0 || r === w.player) return;
  const scheming = aiAxis(w, ruler, AXIS_SCHEMING) + aiAxis(w, ruler, AXIS_AMBITION) - aiAxis(w, ruler, AXIS_HONOR);
  if (revengePlot(w, r, ruler, scheming)) return;
  if (scheming < 2) return;
  // Ambitious schemers forge claims on their neighbors' land.
  if (w.realmLiege[r] === NONE && w.rng.chance(0.015 * scheming)) {
    const m = w.map;
    for (let k = 0; k < 6; k++) {
      const q = w.rng.int(w.P);
      const owner = w.provOwner[q];
      if (owner < 0 || w.top(owner) === r || w.provClaim[q] >= 0) continue;
      let borders = false;
      for (let e = m.adjOffset[q]; e < m.adjOffset[q + 1] && !borders; e++) borders = w.provOwner[m.adj[e]] >= 0 && w.top(w.provOwner[m.adj[e]]) === r;
      const tr = w.realmRuler[w.top(owner)];
      if (borders && tr >= 0 && startPlot(w, ruler, tr, PlotKind.Fabricate, q) >= 0) return;
    }
  }
  const l = w.realmLiege[r];
  if (l >= 0 && w.realmLoyalty[r] < 30 && w.rng.chance(0.04 * scheming)) {
    const liegeRuler = w.realmRuler[l];
    if (liegeRuler >= 0) startPlot(w, ruler, liegeRuler, w.realmLoyalty[r] < 15 ? PlotKind.Usurp : PlotKind.Murder);
    return;
  }
  // Murder a rival ruler we're at war with, or the heir of a realm we'd inherit... keep it rare.
  if (w.rng.chance(0.004 * scheming)) {
    for (let o = 0; o < w.R; o++) {
      if (!w.realmAlive[o] || !w.isHostile(r, o) || o === r) continue;
      const target = w.realmRuler[w.top(o)];
      if (target >= 0) {
        startPlot(w, ruler, target, PlotKind.Murder);
        if (target === w.realmRuler[w.player] && w.rng.chance(0.3)) w.addLog('bad', 'Your spies hear rumors of an assassin sent against you.');
        return;
      }
    }
  }
}
