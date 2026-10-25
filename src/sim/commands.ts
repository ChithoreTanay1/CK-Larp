import { World, NONE, WarKind, PlotKind, ArmyKind } from './world';
import { declareWar, endWar, atWar } from './systems/war';
import { launchRaid, raiseArmy, disbandArmy, setDest } from './systems/military';
import { evaluate, enact, gift } from './systems/diplomacy';
import { startPlot } from './systems/plots';
import { resolveChoice } from './events/runner';
import { TAG_TEMPLE } from './content';

/** Commands flow UI -> sim. Every command is validated here; the UI is never trusted. */
export type Command =
  | { c: 'declareWar'; target: number; kind: 'conquest' | 'subjugation' }
  | { c: 'raid'; target: number }
  | { c: 'propose'; type: 'alliance' | 'vassal' | 'hostage'; realm: number }
  | { c: 'marry'; mine: number; theirs: number; realm: number }
  | { c: 'gift'; realm: number }
  | { c: 'plot'; target: number; kind: 'murder' | 'usurp' }
  | { c: 'peace'; war: number; mode: 'white' | 'surrender' | 'demand' }
  | { c: 'choice'; uid: number; option: number }
  | { c: 'moveArmy'; army: number; dest: number }
  | { c: 'armyAuto'; army: number }
  | { c: 'raiseArmy' }
  | { c: 'disbandArmy' }
  | { c: 'endowTemple' }
  | { c: 'feast' }
  | { c: 'rebel' }
  | { c: 'breakAlliance'; realm: number }
  | { c: 'releaseHostage'; char: number };

export interface CommandResult {
  ok: boolean;
  message: string;
}

const ok = (message: string): CommandResult => ({ ok: true, message });
const no = (message: string): CommandResult => ({ ok: false, message });

export function applyCommand(w: World, cmd: Command): CommandResult {
  const me = w.player;
  if (me === NONE || !w.realmAlive[me]) return no('You have no realm.');
  const top = w.top(me);
  switch (cmd.c) {
    case 'choice':
      resolveChoice(w, cmd.uid, cmd.option);
      return ok('');

    case 'declareWar': {
      const p = cmd.target;
      if (p < 0 || p >= w.P) return no('No such province.');
      const owner = w.provOwner[p];
      if (owner < 0) return no('Nobody owns that land.');
      const them = w.top(owner);
      if (w.realmLiege[me] !== NONE) return no('Vassals cannot declare wars. Rebel first.');
      if (them === top) return no('That is our own land.');
      if (w.isHostile(me, them)) return no('We are already at war with them.');
      if (w.hasTruce(me, them)) return no('We have a truce with them.');
      if (w.isAllied(me, them)) return no('They are our allies. Break the alliance first.');
      const kind = cmd.kind === 'subjugation' ? WarKind.Subjugation : WarKind.Conquest;
      if (w.isAllied(me, them) || w.married[me * w.R + them]) w.realmPrestige[me] = Math.max(0, w.realmPrestige[me] - 10);
      const war = declareWar(w, me, them, p, kind);
      return war >= 0 ? ok(`War declared on ${w.realmName[them]}.`) : no('The war could not begin.');
    }

    case 'raid': {
      const p = cmd.target;
      if (p < 0 || p >= w.P || w.provOwner[p] < 0) return no('Nothing to raid there.');
      if (w.top(w.provOwner[p]) === top) return no('We will not raid our own people.');
      if (w.day < w.realmRaidReady[me]) return no(`Our raiders are not ready (${Math.ceil((w.realmRaidReady[me] - w.day) / 30)} months).`);
      const d = w.map.hopDays[p * w.P + w.realmCapital[me]];
      if (d > 40) return no('Too far to raid.');
      const a = launchRaid(w, me, p);
      if (a < 0) return no('No raiders could be gathered.');
      w.addOpinion(w.top(w.provOwner[p]), me, -10);
      return ok(`${Math.round(w.armyMen[a])} raiders set out for ${w.scenario.provinces[p].name}.`);
    }

    case 'propose': {
      const r = cmd.realm;
      if (r < 0 || !w.realmAlive[r] || r === me) return no('No such realm.');
      const v = evaluate(w, cmd.type, me, r);
      if (!v.ok) {
        w.addOpinion(r, me, -3);
        w.addLog('info', `${w.realmName[r]} refuses: ${v.reason}`);
        return no(v.reason);
      }
      enact(w, cmd.type, me, r);
      w.addLog('good', `${w.realmName[r]} accepts. ${v.reason}`);
      return ok(v.reason);
    }

    case 'marry': {
      const r = cmd.realm;
      if (w.charRealm[cmd.mine] !== me || w.charRealm[cmd.theirs] !== r) return no('Those two cannot be matched.');
      const v = evaluate(w, 'marriage', me, r, cmd.mine, cmd.theirs);
      if (!v.ok) {
        w.addLog('info', `${w.realmName[r]} refuses the match: ${v.reason}`);
        return no(v.reason);
      }
      enact(w, 'marriage', me, r, cmd.mine, cmd.theirs);
      w.addLog('family', `${w.charFullName(cmd.mine)} will marry ${w.charFullName(cmd.theirs)}.`);
      return ok(v.reason);
    }

    case 'gift': {
      const r = cmd.realm;
      if (!w.realmAlive[r] || r === me) return no('No such realm.');
      if (w.realmTrade[me] < 25) return no('We need 25 trade goods for a fitting gift.');
      gift(w, me, r, 25);
      w.addLog('info', `Gifts sent to ${w.realmName[r]}.`);
      return ok('Gift sent.');
    }

    case 'plot': {
      const t = cmd.target;
      if (t < 0 || t >= w.charCount || !w.charAlive[t]) return no('No such person.');
      const ruler = w.realmRuler[me];
      if (t === ruler) return no('You cannot plot against yourself.');
      if (w.realmTrade[me] < 20) return no('Plots need 20 trade goods for bribes.');
      let kind = PlotKind.Murder;
      if (cmd.kind === 'usurp') {
        const l = w.realmLiege[me];
        if (l < 0 || w.realmRuler[l] !== t) return no('You can only usurp your own liege.');
        kind = PlotKind.Usurp;
      }
      const p = startPlot(w, ruler, t, kind);
      if (p < 0) return no('You are already running a plot.');
      w.realmTrade[me] -= 20;
      w.addLog('info', `A plot against ${w.charFullName(t)} has begun.`);
      return ok('Plot started.');
    }

    case 'peace': {
      const war = cmd.war;
      if (war < 0 || war >= w.warActive.length || !w.warActive[war]) return no('No such war.');
      const att = w.warAttacker[war], def = w.warDefender[war];
      if (att !== top && def !== top) return no('Only the war leaders can make peace.');
      const weAreAtt = att === top;
      const score = w.warScore[war] * (weAreAtt ? 1 : -1);
      if (cmd.mode === 'surrender') {
        endWar(w, war, weAreAtt ? 'defender' : 'attacker');
        return ok('We have surrendered.');
      }
      if (cmd.mode === 'white') {
        if (score > -25) {
          endWar(w, war, 'white');
          return ok('They accept a white peace.');
        }
        return no('They are winning and refuse a white peace.');
      }
      if (score >= 60 || (score >= 40 && w.rng.chance(0.5))) {
        endWar(w, war, weAreAtt ? 'attacker' : 'defender');
        return ok('They accept our terms.');
      }
      return no(`They refuse our terms (war score ${Math.round(score)}%).`);
    }

    case 'moveArmy': {
      const a = cmd.army;
      if (a < 0 || a >= w.armyActive.length || !w.armyActive[a] || w.armyRealm[a] !== me || w.armyKind[a] !== ArmyKind.Host) return no('Not our army.');
      if (cmd.dest < 0 || cmd.dest >= w.P) return no('No such place.');
      if (w.map.hopDays[cmd.dest * w.P + w.armyLoc[a]] === 0xffff) return no('No route there.');
      w.armyManual[a] = 1;
      setDest(w, a, cmd.dest);
      return ok(`The army marches for ${w.scenario.provinces[cmd.dest].name}.`);
    }

    case 'armyAuto': {
      const a = cmd.army;
      if (a < 0 || a >= w.armyActive.length || !w.armyActive[a] || w.armyRealm[a] !== me) return no('Not our army.');
      w.armyManual[a] = 0;
      return ok('The generals will command the army.');
    }

    case 'raiseArmy': {
      if (w.realmArmy[me] >= 0) return no('The army is already in the field.');
      const a = raiseArmy(w, me);
      return a >= 0 ? ok(`${Math.round(w.armyMen[a])} men answer the call.`) : no('Too few men to raise an army.');
    }

    case 'disbandArmy': {
      const a = w.realmArmy[me];
      if (a < 0) return no('No army to disband.');
      if (atWar(w, me)) return no('Not while we are at war.');
      disbandArmy(w, a);
      return ok('The levies go home to their fields.');
    }

    case 'endowTemple': {
      if (w.realmTrade[me] < 30) return no('We need 30 trade goods.');
      w.realmTrade[me] -= 30;
      const temple = (w.content.cultureTags[w.realmCulture[me]] & TAG_TEMPLE) !== 0 ? 1.5 : 1;
      w.realmStability[me] = Math.min(100, w.realmStability[me] + 5 * temple);
      w.realmPrestige[me] += 3;
      w.setP(w.realmRegion(me), 5, w.p(w.realmRegion(me), 5) + 0.02);
      return ok('The priests sing our praises.');
    }

    case 'feast': {
      const cost = 25;
      if (w.realmGrain[me] < cost) return no(`We need ${cost} grain.`);
      w.realmGrain[me] -= cost;
      for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.realmLiege[o] === me) w.realmLoyalty[o] = Math.min(100, w.realmLoyalty[o] + 8);
      w.realmStability[me] = Math.min(100, w.realmStability[me] + 2);
      return ok('The great hall rings with songs. Our vassals are pleased.');
    }

    case 'rebel': {
      const l = w.realmLiege[me];
      if (l < 0) return no('We serve no one.');
      const war = declareWar(w, me, l, w.realmCapital[me], WarKind.Independence);
      return war >= 0 ? ok('We declare our independence!') : no('The rebellion failed to start.');
    }

    case 'breakAlliance': {
      if (!w.isAllied(me, cmd.realm)) return no('We are not allied.');
      w.setAllied(me, cmd.realm, false);
      w.addOpinionBoth(me, cmd.realm, -20);
      return ok('The alliance is ended.');
    }

    case 'releaseHostage': {
      const c = cmd.char;
      if (c < 0 || c >= w.charCount || w.charHostage[c] !== me) return no('Not our hostage.');
      w.charHostage[c] = NONE;
      w.addOpinion(w.charRealm[c], me, 15);
      return ok('The hostage goes home.');
    }
  }
}
