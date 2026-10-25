import { World, NONE, EventScope, PRESSURE_COUNT, DAYS_PER_MONTH, REALM_CAP, WarKind, ARMY_CAP } from '../world';
import type { EventTrigger } from '../types';
import { PRESSURE_KEYS, TERRAINS, LAWS } from '../types';
import type { CompiledEvent, Ctx, Effect, EventDb } from './loader';
import { TAGS } from '../content';
import { findHeir } from '../systems/succession';
import { addTrait, removeTrait, killChar, lowbornSpouse, marry } from '../systems/characters';
import { atWar, declareWar } from '../systems/war';
import { strength } from '../systems/realms';
import { launchRaid, spawnSeaBandAt, fieldedMen } from '../systems/military';
import { answerProposal } from '../systems/diplomacy';
import { punishPlotter } from '../systems/plots';

let db: EventDb | null = null;

export function setEventDb(d: EventDb): void {
  db = d;
}

export function getEventDb(): EventDb | null {
  return db;
}

/** Evaluation context over a scope. The heir is computed lazily since it scans characters. */
class ScopeCtx implements Ctx {
  heir = -2;
  constructor(
    public w: World,
    public s: EventScope,
  ) {}

  getHeir(): number {
    if (this.heir === -2) this.heir = this.s.ruler >= 0 ? findHeir(this.w, this.s.realm, this.s.ruler) : NONE;
    return this.heir;
  }

  num(key: string): number {
    const w = this.w, s = this.s, r = s.realm, ru = s.ruler, p = s.province;
    switch (key) {
      case 'realm.grain': return w.realmGrain[r];
      case 'realm.cattle': return w.realmCattle[r];
      case 'realm.metal': return w.realmMetal[r];
      case 'realm.trade': return w.realmTrade[r];
      case 'realm.prestige': return w.realmPrestige[r];
      case 'realm.stability': return w.realmStability[r];
      case 'realm.provinces': return w.realmProvCount[r];
      case 'realm.levy': return w.realmLevy[r];
      case 'realm.atWar': return atWar(w, r) ? 1 : 0;
      case 'realm.isVassal': return w.realmLiege[r] >= 0 ? 1 : 0;
      case 'realm.vassals': {
        let n = 0;
        for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.realmLiege[o] === r) n++;
        return n;
      }
      case 'realm.manpower': return w.realmManpower[r];
      case 'realm.loyalty': return w.realmLoyalty[r];
      case 'realm.army': return fieldedMen(w, r);
      case 'ruler.age': return ru >= 0 ? w.charAge[ru] : 0;
      case 'ruler.health': return ru >= 0 ? w.charHealth[ru] : 0;
      case 'ruler.martial': return ru >= 0 ? w.charMartial[ru] : 0;
      case 'ruler.diplomacy': return ru >= 0 ? w.charDiplomacy[ru] : 0;
      case 'ruler.stewardship': return ru >= 0 ? w.charStewardship[ru] : 0;
      case 'ruler.intrigue': return ru >= 0 ? w.charIntrigue[ru] : 0;
      case 'ruler.learning': return ru >= 0 ? w.charLearning[ru] : 0;
      case 'ruler.female': return ru >= 0 ? w.charFemale[ru] : 0;
      case 'ruler.married': return ru >= 0 && w.charSpouse[ru] >= 0 ? 1 : 0;
      case 'ruler.children': {
        let n = 0;
        for (let i = 0; i < w.aliveCount; i++) {
          const c = w.aliveChars[i];
          if (w.charFather[c] === ru || w.charMother[c] === ru) n++;
        }
        return n;
      }
      case 'heir.exists': return this.getHeir() >= 0 ? 1 : 0;
      case 'heir.age': {
        const h = this.getHeir();
        return h >= 0 ? w.charAge[h] : 0;
      }
      case 'province.grain': return p >= 0 ? w.provGrainOut[p] : 0;
      case 'province.cattle': return p >= 0 ? w.provCattleOut[p] : 0;
      case 'province.pop': return p >= 0 ? w.provPop[p] : 0;
      case 'province.develop': return p >= 0 ? w.provDevelop[p] : 0;
      case 'province.raided': return p >= 0 ? w.provRaided[p] : 0;
      case 'province.coastal': return p >= 0 ? w.map.coastal[p] : 0;
      case 'province.ore': return p >= 0 ? w.provOre[p] : 0;
      case 'province.trade': return p >= 0 ? w.provTrade[p] : 0;
      case 'other.exists': return s.other >= 0 && w.realmAlive[s.other] ? 1 : 0;
      case 'other.strength': return s.other >= 0 ? strength(w, s.other) / Math.max(1, strength(w, w.top(r))) : 0;
      case 'other.opinion': return s.other >= 0 ? w.getOpinion(r, s.other) : 0;
      case 'world.elapsed': return w.year;
      case 'world.yearBce': return w.yearBce;
      case 'rand': return w.rng.next();
    }
    const pk = key.startsWith('pressure.') ? PRESSURE_KEYS.indexOf(key.slice(9) as (typeof PRESSURE_KEYS)[number]) : -1;
    if (pk >= 0) return w.pressure[s.region * PRESSURE_COUNT + pk];
    return 0;
  }

  pred(kind: string, arg: string): boolean {
    const w = this.w, s = this.s;
    const ct = w.content;
    const cul = w.realmCulture[s.realm];
    switch (kind) {
      case 'ruler.has': return s.ruler >= 0 && w.hasTrait(s.ruler, ct.traitIdx.get(arg)!);
      case 'heir.has': {
        const h = this.getHeir();
        return h >= 0 && w.hasTrait(h, ct.traitIdx.get(arg)!);
      }
      case 'char.has': return s.char >= 0 && w.hasTrait(s.char, ct.traitIdx.get(arg)!);
      case 'culture.is': return ct.cultures[cul].id === arg;
      case 'culture.group': return ct.groups[ct.cultureGroup[cul]] === arg;
      case 'culture.tag': return (ct.cultureTags[cul] & (1 << TAGS.indexOf(arg as (typeof TAGS)[number]))) !== 0;
      case 'region.is': return w.scenario.regions[s.region].id === arg;
      case 'terrain.is': return s.province >= 0 && TERRAINS[w.provTerrain[s.province]] === arg;
      case 'law.is': return LAWS[w.realmLaw[s.realm]] === arg;
    }
    return false;
  }
}

export function makeScope(w: World, realm: number, other = NONE, char = NONE, province = NONE): EventScope {
  const prov = province >= 0 ? province : w.realmCapital[realm];
  return { realm, ruler: w.realmRuler[realm], province: prov, region: prov >= 0 ? w.provRegion[prov] : 0, other, char };
}

function tagsMatch(w: World, ev: CompiledEvent, s: EventScope): boolean {
  const tags = ev.regionTags;
  if (tags.includes('any')) return true;
  const ct = w.content;
  const cul = w.realmCulture[s.realm];
  for (const t of tags) {
    if (t === w.scenario.regions[s.region].id || t === ct.groups[ct.cultureGroup[cul]] || t === ct.cultures[cul].id) return true;
    if (t === 'coastal' && s.province >= 0 && w.map.coastal[s.province]) return true;
  }
  return false;
}

/** Weight of an eligible event for this scope, or 0. */
export function eventWeight(w: World, ev: CompiledEvent, s: EventScope, ctx: ScopeCtx, ignoreCooldown = false): number {
  if (!ignoreCooldown) {
    const cd = w.eventCooldown.get(ev.idx * REALM_CAP + s.realm);
    if (cd !== undefined && cd > w.day) return 0;
  }
  if (!tagsMatch(w, ev, s)) return 0;
  for (let i = 0; i < ev.conds.length; i++) if (!ev.conds[i](ctx)) return 0;
  let weight = ev.data.weight;
  for (const m of ev.mods) if (m.cond(ctx)) weight *= m.mult;
  return weight;
}

/** Try to fire an event of the given trigger for a realm. */
export function fireTrigger(w: World, trigger: EventTrigger, realm: number, other = NONE, char = NONE, province = NONE): boolean {
  if (!db || realm < 0 || !w.realmAlive[realm] || w.realmLandless[realm] || w.realmRuler[realm] < 0) return false;
  const list = db.byTrigger.get(trigger);
  if (!list || !list.length) return false;
  const s = makeScope(w, realm, other, char, province);
  const ctx = new ScopeCtx(w, s);
  let total = 0;
  const weights: number[] = [];
  for (const ev of list) {
    const wt = eventWeight(w, ev, s, ctx);
    weights.push(wt);
    total += wt;
  }
  if (total <= 0) return false;
  let roll = w.rng.next() * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll <= 0 && weights[i] > 0) {
      fireEvent(w, list[i], s, ctx);
      return true;
    }
  }
  return false;
}

export function formatText(w: World, text: string, s: EventScope, heir: number): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => {
    switch (k) {
      case 'ruler': return w.charShortName(s.ruler);
      case 'realm': return w.realmName[s.realm];
      case 'province': return s.province >= 0 ? w.scenario.provinces[s.province].name : 'the capital';
      case 'region': return w.scenario.regions[s.region].name;
      case 'heir': return heir >= 0 ? w.charShortName(heir) : 'your heir';
      case 'other': return s.other >= 0 ? w.realmName[s.other] : 'strangers';
      case 'char': return s.char >= 0 ? w.charShortName(s.char) : 'someone';
      case 'dynasty': return s.ruler >= 0 && w.charDynasty[s.ruler] >= 0 ? w.dynName[w.charDynasty[s.ruler]] : 'your house';
      case 'year': return `${w.yearBce} BCE`;
      default: return `{${k}}`;
    }
  });
}

export function fireEvent(w: World, ev: CompiledEvent, s: EventScope, ctx?: ScopeCtx): void {
  const c = ctx ?? new ScopeCtx(w, s);
  w.eventCooldown.set(ev.idx * REALM_CAP + s.realm, w.day + (ev.data.cooldown ?? 24) * DAYS_PER_MONTH);
  if (s.realm === w.player) {
    const heir = c.getHeir();
    w.playerQueue.push({
      uid: w.nextUid++,
      kind: 'event',
      title: formatText(w, ev.data.title, s, heir),
      text: formatText(w, ev.data.text, s, heir),
      options: ev.data.options.map((o) => ({ label: formatText(w, o.label, s, heir), tooltip: o.tooltip ?? describeEffects(o.effects) })),
      eventIdx: ev.idx,
      ctx: s,
    });
    return;
  }
  // AI picks by trait weights.
  const ruler = s.ruler;
  let total = 0;
  const ws = ev.options.map((o) => {
    let v = o.base;
    for (const a of o.ai) if (ruler >= 0 && w.hasTrait(ruler, a.trait)) v += a.w;
    v = Math.max(0.05, v);
    total += v;
    return v;
  });
  let roll = w.rng.next() * total;
  let pick = 0;
  for (; pick < ws.length - 1; pick++) {
    roll -= ws[pick];
    if (roll <= 0) break;
  }
  applyEffects(w, ev.options[pick].effects, s, c.getHeir());
}

export function describeEffects(effects: string[]): string {
  return effects.length ? effects.join(', ') : 'No effect';
}

function target(who: string | undefined, s: EventScope, heir: number): number {
  return who === 'heir' ? heir : who === 'char' ? s.char : s.ruler;
}

export function applyEffects(w: World, effects: Effect[], s: EventScope, heir: number): void {
  const r = s.realm;
  if (!w.realmAlive[r]) return;
  const add = (arr: Float32Array, idx: number, e: Effect, lo = 0, hi = Infinity) => {
    const v = e.pct ? arr[idx] * (1 + e.value / 100) : arr[idx] + e.value;
    arr[idx] = v < lo ? lo : v > hi ? hi : v;
  };
  for (const e of effects) {
    const pk = PRESSURE_KEYS.indexOf(e.key as (typeof PRESSURE_KEYS)[number]);
    if (pk >= 0) {
      w.setP(s.region, pk, w.p(s.region, pk) + e.value);
      continue;
    }
    switch (e.key) {
      case 'grain': add(w.realmGrain, r, e); break;
      case 'cattle': add(w.realmCattle, r, e); break;
      case 'metal': add(w.realmMetal, r, e); break;
      case 'trade': add(w.realmTrade, r, e); break;
      case 'prestige': add(w.realmPrestige, r, e); break;
      case 'stability': add(w.realmStability, r, e, 0, 100); break;
      case 'manpower': w.realmManpower[r] = Math.max(0, Math.min(1, w.realmManpower[r] + e.value / 100)); break;
      case 'loyalty':
        if (w.realmLiege[r] >= 0) add(w.realmLoyalty, r, e, 0, 100);
        for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.realmLiege[o] === r) add(w.realmLoyalty, o, e, 0, 100);
        break;
      case 'pop': if (s.province >= 0) add(w.provPop, s.province, e, 0.3); break;
      case 'develop':
        if (s.province >= 0) {
          w.provDevelop[s.province] = Math.max(1, Math.min(5, w.provDevelop[s.province] + e.value));
          w.markProv(s.province);
        }
        break;
      case 'raided': if (s.province >= 0) w.provRaided[s.province] = Math.max(w.provRaided[s.province], e.value); break;
      case 'unrest': if (s.province >= 0) add(w.provUnrest, s.province, e, 0, 100); break;
      case 'health': if (s.ruler >= 0 && w.charAlive[s.ruler]) w.charHealth[s.ruler] = Math.max(1, Math.min(100, w.charHealth[s.ruler] + e.value)); break;
      case 'morale':
        for (let a = 0; a < ARMY_CAP; a++) if (w.armyActive[a] && w.armyRealm[a] === r) w.armyMorale[a] = Math.max(0.2, Math.min(1, w.armyMorale[a] + e.value));
        break;
      case 'opinion_other': if (s.other >= 0 && w.realmAlive[s.other]) w.addOpinionBoth(r, s.other, e.value); break;
      case 'other_grain': if (s.other >= 0 && w.realmAlive[s.other]) add(w.realmGrain, s.other, e); break;
      case 'other_trade': if (s.other >= 0 && w.realmAlive[s.other]) add(w.realmTrade, s.other, e); break;
      case 'add_trait': {
        const c = target(e.who, s, heir);
        if (c >= 0 && w.charAlive[c]) addTrait(w, c, e.trait!);
        break;
      }
      case 'remove_trait': {
        const c = target(e.who, s, heir);
        if (c >= 0 && w.charAlive[c]) removeTrait(w, c, e.trait!);
        break;
      }
      case 'kill': {
        const c = target(e.who, s, heir);
        if (c >= 0 && w.charAlive[c]) killChar(w, c, 'misfortune');
        break;
      }
      case 'spawn_raiders': {
        // Pick a coastal province of ours to be hit.
        let p = s.province;
        if (p < 0 || !w.map.coastal[p]) for (let q = 0; q < w.P; q++) if (w.provOwner[q] === r && w.map.coastal[q]) p = q;
        if (p >= 0 && w.map.coastal[p]) spawnSeaBandAt(w, p);
        break;
      }
      case 'war_other': {
        const o = s.other;
        if (o >= 0 && w.realmAlive[o] && !w.isHostile(r, o) && w.top(o) !== w.top(r) && !w.realmLandless[o]) {
          declareWar(w, r, o, w.realmCapital[w.top(o)], WarKind.Conquest);
        }
        break;
      }
      case 'raid_other': {
        const o = s.other;
        if (o >= 0 && w.realmAlive[o] && w.realmCapital[o] >= 0) {
          // Nearest province of theirs.
          const cap = w.realmCapital[r];
          let best = NONE, bd = 1e9;
          for (let q = 0; q < w.P; q++) {
            if (w.provOwner[q] < 0 || w.top(w.provOwner[q]) !== w.top(o)) continue;
            const d = w.map.hopDays[q * w.P + cap];
            if (d < bd) {
              bd = d;
              best = q;
            }
          }
          if (best >= 0) launchRaid(w, r, best);
        }
        break;
      }
      case 'marry_local': {
        const ru = s.ruler;
        if (ru >= 0 && w.charAlive[ru] && w.charSpouse[ru] < 0) marry(w, ru, lowbornSpouse(w, ru));
        break;
      }
      case 'ally_other': if (s.other >= 0 && w.realmAlive[s.other] && !w.isHostile(r, s.other)) w.setAllied(r, s.other, true); break;
    }
  }
}

/** The player picked an option on the front choice. */
export function resolveChoice(w: World, uid: number, option: number): void {
  const i = w.playerQueue.findIndex((q) => q.uid === uid);
  if (i < 0) return;
  const q = w.playerQueue[i];
  w.playerQueue.splice(i, 1);
  if (q.kind === 'proposal') {
    answerProposal(w, q, option);
    return;
  }
  if (q.eventIdx === -1 && q.ctx) {
    punishPlotter(w, q.ctx.char, option);
    return;
  }
  if (!db || q.eventIdx === undefined || !q.ctx) return;
  const ev = db.events[q.eventIdx];
  const opt = ev.options[option];
  if (!opt) return;
  const s = q.ctx;
  // The ruler may have changed while the event waited.
  s.ruler = w.realmRuler[s.realm];
  const ctx = new ScopeCtx(w, s);
  applyEffects(w, opt.effects, s, ctx.getHeir());
}

/** Monthly random event roll for one realm (staggered by caller). */
export function monthlyEventRoll(w: World, r: number): void {
  const chance = r === w.player ? 0.16 : 0.05;
  if (w.rng.chance(chance)) fireTrigger(w, 'monthly', r);
}

export function yearlyEventRoll(w: World): void {
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r] || w.realmLandless[r] || !w.isFullDetail(r)) continue;
    if (w.rng.chance(r === w.player ? 0.45 : 0.12)) fireTrigger(w, 'yearly', r);
  }
}

/** Dev tool: fire a specific event on a realm, ignoring conditions and cooldown. */
export function forceEvent(w: World, id: string, realm: number): boolean {
  const ev = db?.byId.get(id);
  if (!ev || !w.realmAlive[realm]) return false;
  fireEvent(w, ev, makeScope(w, realm));
  return true;
}
