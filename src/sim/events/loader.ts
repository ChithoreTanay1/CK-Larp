import type { EventData, EventTrigger } from '../types';
import { EVENT_TRIGGERS, PRESSURE_KEYS } from '../types';
import type { Content } from '../content';
import { TAGS } from '../content';

/**
 * Events are data. At load time each condition and effect string is compiled into
 * a small closure / opcode so firing an event never parses text.
 */

export interface Ctx {
  /** Numeric lookups. */
  num(key: string): number;
  /** Boolean predicates: has(trait), culture.is(x), ... */
  pred(kind: string, arg: string): boolean;
}

export type Cond = (c: Ctx) => boolean;

export const NUM_KEYS = new Set([
  ...PRESSURE_KEYS.map((k) => `pressure.${k}`),
  'realm.grain', 'realm.cattle', 'realm.metal', 'realm.trade', 'realm.prestige', 'realm.stability', 'realm.provinces',
  'realm.levy', 'realm.atWar', 'realm.isVassal', 'realm.vassals', 'realm.manpower', 'realm.loyalty', 'realm.army',
  'ruler.age', 'ruler.health', 'ruler.martial', 'ruler.diplomacy', 'ruler.stewardship', 'ruler.intrigue', 'ruler.learning',
  'ruler.children', 'ruler.married', 'ruler.female',
  'heir.exists', 'heir.age',
  'province.grain', 'province.cattle', 'province.pop', 'province.develop', 'province.raided', 'province.coastal', 'province.ore', 'province.trade',
  'other.exists', 'other.strength', 'other.opinion',
  'world.elapsed', 'world.yearBce', 'rand',
]);

export const PRED_KINDS = new Set(['ruler.has', 'heir.has', 'char.has', 'culture.is', 'culture.group', 'culture.tag', 'region.is', 'terrain.is', 'law.is']);

const OPS: Record<string, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

export function compileCondition(src: string, content: Content): { fn: Cond; cost: number } {
  const s = src.trim();
  const m = /^(!?)([a-z]+\.[a-z]+)\(([A-Za-z_]+)\)$/.exec(s);
  if (m) {
    const [, neg, kind, arg] = m;
    if (!PRED_KINDS.has(kind)) throw new Error(`Unknown predicate "${kind}" in "${src}"`);
    if (kind.endsWith('.has') && !content.traitIdx.has(arg)) throw new Error(`Unknown trait "${arg}" in "${src}"`);
    if (kind === 'culture.is' && !content.cultureIdx.has(arg)) throw new Error(`Unknown culture "${arg}" in "${src}"`);
    if (kind === 'culture.group' && !content.groups.includes(arg)) throw new Error(`Unknown culture group "${arg}" in "${src}"`);
    if (kind === 'culture.tag' && !(TAGS as readonly string[]).includes(arg)) throw new Error(`Unknown culture tag "${arg}" in "${src}"`);
    const cost = kind.startsWith('heir') ? 3 : 1;
    return neg ? { fn: (c) => !c.pred(kind, arg), cost } : { fn: (c) => c.pred(kind, arg), cost };
  }
  const n = /^([a-zA-Z]+(?:\.[a-zA-Z]+)?)\s*(>=|<=|==|!=|>|<)\s*(-?[0-9.]+)$/.exec(s);
  if (!n) throw new Error(`Cannot parse condition "${src}"`);
  const [, key, op, val] = n;
  if (!NUM_KEYS.has(key)) throw new Error(`Unknown value "${key}" in "${src}"`);
  const v = Number(val);
  const f = OPS[op];
  const cost = key === 'rand' ? 4 : key.startsWith('heir') ? 3 : key.startsWith('other') ? 2 : 1;
  return { fn: (c) => f(c.num(key), v), cost };
}

export const EFFECT_KEYS = new Set([
  'grain', 'cattle', 'metal', 'trade', 'prestige', 'stability', 'manpower', 'loyalty',
  ...PRESSURE_KEYS,
  'pop', 'develop', 'raided', 'unrest',
  'health', 'morale', 'opinion_other', 'other_grain', 'other_trade',
]);
export const EFFECT_VERBS = new Set(['add_trait', 'remove_trait', 'kill', 'spawn_raiders', 'war_other', 'raid_other', 'ally_other', 'marry_heir']);

export interface Effect {
  key: string;
  value: number;
  pct: boolean;
  /** Verb argument: target ('ruler' | 'heir' | 'char') and trait id. */
  who?: string;
  trait?: number;
}

export function compileEffect(src: string, content: Content): Effect {
  const parts = src.trim().split(/\s+/);
  const key = parts[0];
  if (EFFECT_VERBS.has(key)) {
    if (key === 'add_trait' || key === 'remove_trait') {
      const [who, trait] = [parts[1], parts[2]];
      if (!['ruler', 'heir', 'char'].includes(who)) throw new Error(`Bad target "${who}" in "${src}"`);
      const t = content.traitIdx.get(trait);
      if (t === undefined) throw new Error(`Unknown trait "${trait}" in "${src}"`);
      return { key, value: 0, pct: false, who, trait: t };
    }
    if (key === 'kill') {
      if (!['ruler', 'heir', 'char'].includes(parts[1])) throw new Error(`Bad target in "${src}"`);
      return { key, value: 0, pct: false, who: parts[1] };
    }
    return { key, value: parts[1] ? Number(parts[1]) : 1, pct: false };
  }
  if (!EFFECT_KEYS.has(key)) throw new Error(`Unknown effect "${key}" in "${src}"`);
  const m = /^([+-]?[0-9.]+)(%?)$/.exec(parts[1] ?? '');
  if (!m) throw new Error(`Bad effect amount in "${src}"`);
  return { key, value: Number(m[1]), pct: m[2] === '%' };
}

export interface CompiledEvent {
  idx: number;
  data: EventData;
  conds: Cond[];
  mods: { cond: Cond; mult: number }[];
  options: { effects: Effect[]; ai: { trait: number; w: number }[]; base: number }[];
  regionTags: string[];
}

export interface EventDb {
  events: CompiledEvent[];
  byTrigger: Map<EventTrigger, CompiledEvent[]>;
  byId: Map<string, CompiledEvent>;
}

export function compileEvents(list: EventData[], content: Content): EventDb {
  const events: CompiledEvent[] = [];
  const byTrigger = new Map<EventTrigger, CompiledEvent[]>(EVENT_TRIGGERS.map((t) => [t, []]));
  const byId = new Map<string, CompiledEvent>();
  list.forEach((e, idx) => {
    const where = `event ${e.id}`;
    try {
      if (byId.has(e.id)) throw new Error('duplicate id');
      if (!EVENT_TRIGGERS.includes(e.trigger)) throw new Error(`unknown trigger ${e.trigger}`);
      if (!e.options.length) throw new Error('no options');
      // Cheap conditions first.
      const conds = e.conditions.map((c) => compileCondition(c, content)).sort((a, b) => a.cost - b.cost).map((c) => c.fn);
      const mods = (e.weight_mods ?? []).map((m) => ({ cond: compileCondition(m.if, content).fn, mult: m.mult }));
      const options = e.options.map((o) => {
        const ai: { trait: number; w: number }[] = [];
        let base = 1;
        for (const [k, v] of Object.entries(o.ai ?? {})) {
          if (k === 'base') base = v;
          else {
            const t = content.traitIdx.get(k);
            if (t === undefined) throw new Error(`unknown AI trait ${k}`);
            ai.push({ trait: t, w: v });
          }
        }
        return { effects: o.effects.map((f) => compileEffect(f, content)), ai, base };
      });
      const ce: CompiledEvent = { idx, data: e, conds, mods, options, regionTags: e.region_tags };
      events.push(ce);
      byTrigger.get(e.trigger)!.push(ce);
      byId.set(e.id, ce);
    } catch (err) {
      throw new Error(`${where}: ${(err as Error).message}`);
    }
  });
  return { events, byTrigger, byId };
}
