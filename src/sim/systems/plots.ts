import { World, NONE, PLOT_CAP, PlotKind } from '../world';
import { killChar, aiAxis, T } from './characters';
import { mergeRealm, setRuler } from './realms';
import { AXIS_SCHEMING, AXIS_AMBITION, AXIS_HONOR } from '../content';

export function plotName(k: number): string {
  return k === PlotKind.Murder ? 'Murder' : 'Usurp the throne';
}

export function startPlot(w: World, owner: number, target: number, kind: PlotKind): number {
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
    w.plotProgress[p] += 0.04 + w.charIntrigue[o] / 220 + w.rng.next() * 0.04;
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
  const what = w.plotKind[p] === PlotKind.Murder ? `to murder ${w.charFullName(t)}` : `to seize the throne of ${w.realmName[tRealm]}`;
  if (oRealm >= 0) {
    w.realmPrestige[oRealm] = Math.max(0, w.realmPrestige[oRealm] - 10);
    if (tRealm >= 0 && w.realmAlive[tRealm]) w.addOpinion(w.top(tRealm), w.top(oRealm), -50);
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

function complete(w: World, p: number): void {
  w.plotActive[p] = 0;
  const o = w.plotOwner[p], t = w.plotTarget[p];
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

/**
 * Character AI for scheming: ambitious younger sons eye the heir, disloyal vassals
 * eye the throne. Runs monthly per realm, cheap and rare.
 */
export function plotAi(w: World, r: number): void {
  const ruler = w.realmRuler[r];
  if (ruler < 0 || r === w.player) return;
  const scheming = aiAxis(w, ruler, AXIS_SCHEMING) + aiAxis(w, ruler, AXIS_AMBITION) - aiAxis(w, ruler, AXIS_HONOR);
  if (scheming < 2) return;
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
