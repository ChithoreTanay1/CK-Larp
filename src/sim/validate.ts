import type { CultureData, EventData, ScenarioData, TraitData } from './types';
import { TERRAINS, LAWS, PRESSURE_KEYS } from './types';
import { compileContent } from './content';
import { compileEvents } from './events/loader';

/**
 * Schema and reference checks for all data files. Run at build time (npm run validate)
 * so typos fail the build instead of surfacing at runtime.
 */
export function validateData(scenario: ScenarioData, cultures: CultureData[], traits: TraitData[], events: EventData[]): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);
  const num = (v: unknown, where: string, lo = -Infinity, hi = Infinity) => {
    if (typeof v !== 'number' || Number.isNaN(v) || v < lo || v > hi) err(`${where}: expected number in [${lo}, ${hi}], got ${JSON.stringify(v)}`);
  };

  // Traits
  const traitIds = new Set<string>();
  if (traits.length > 32) err(`traits: ${traits.length} traits exceed the 32-bit mask`);
  for (const t of traits) {
    if (traitIds.has(t.id)) err(`trait ${t.id}: duplicate id`);
    traitIds.add(t.id);
    if (!['personality', 'education', 'physical', 'special'].includes(t.kind)) err(`trait ${t.id}: bad kind ${t.kind}`);
  }
  for (const t of traits) if (t.opposite && !traitIds.has(t.opposite)) err(`trait ${t.id}: unknown opposite ${t.opposite}`);

  // Cultures
  const cultureIds = new Set<string>();
  for (const c of cultures) {
    if (cultureIds.has(c.id)) err(`culture ${c.id}: duplicate id`);
    cultureIds.add(c.id);
    if (!LAWS.includes(c.law)) err(`culture ${c.id}: bad law ${c.law}`);
    if (c.male.length < 5 || c.female.length < 3) err(`culture ${c.id}: needs at least 5 male and 3 female names`);
    if (!c.dynasties.length) err(`culture ${c.id}: no dynasty names`);
    num(c.hue, `culture ${c.id}.hue`, 0, 360);
  }

  // Scenario
  const regionIds = new Set(scenario.regions.map((r) => r.id));
  for (const r of scenario.regions) {
    for (const k of PRESSURE_KEYS) num(r.pressure[k], `region ${r.id}.pressure.${k}`, 0, 1);
    num(r.droughtBaseline, `region ${r.id}.droughtBaseline`, 0, 1);
    num(r.raiderBaseline, `region ${r.id}.raiderBaseline`, 0, 1);
    num(r.ironRate, `region ${r.id}.ironRate`, 0, 5);
  }
  const m = scenario.map;
  const provNames = new Set<string>();
  for (const p of scenario.provinces) {
    const w = `province ${p.name}`;
    if (provNames.has(p.name)) err(`${w}: duplicate name`);
    provNames.add(p.name);
    if (!regionIds.has(p.region)) err(`${w}: unknown region ${p.region}`);
    if (!TERRAINS.includes(p.terrain)) err(`${w}: unknown terrain ${p.terrain}`);
    num(p.lon, `${w}.lon`, m.lonMin, m.lonMax);
    num(p.lat, `${w}.lat`, m.latMin, m.latMax);
    num(p.ore, `${w}.ore`, 0, 3);
    num(p.trade, `${w}.trade`, 0, 3);
    num(p.develop, `${w}.develop`, 1, 5);
    if (p.fort !== undefined) num(p.fort, `${w}.fort`, 0, 3);
  }
  if (scenario.provinces.length > 0xfff0) err('too many provinces for a Uint16 province map');
  const owned = new Map<string, string>();
  const realmIds = new Set(scenario.realms.map((r) => r.id));
  for (const r of scenario.realms) {
    if (!cultureIds.has(r.culture)) err(`realm ${r.id}: unknown culture ${r.culture}`);
    if (r.liege && !realmIds.has(r.liege)) err(`realm ${r.id}: unknown liege ${r.liege}`);
    if (r.law && !LAWS.includes(r.law)) err(`realm ${r.id}: bad law ${r.law}`);
    if (!r.provinces.length) err(`realm ${r.id}: no provinces`);
    for (const p of r.provinces) {
      if (!provNames.has(p)) err(`realm ${r.id}: unknown province ${p}`);
      if (owned.has(p)) err(`realm ${r.id}: province ${p} already owned by ${owned.get(p)}`);
      owned.set(p, r.id);
    }
  }
  for (const b of scenario.raiders) if (!cultureIds.has(b.culture)) err(`raider band ${b.name}: unknown culture ${b.culture}`);

  // Events: compiling checks every condition, effect, trait and culture reference.
  if (!errors.length) {
    try {
      const content = compileContent(traits, cultures);
      compileEvents(events, content);
      for (const e of events) {
        if (!e.title || !e.text) err(`event ${e.id}: missing title or text`);
        num(e.weight, `event ${e.id}.weight`, 0, 1000);
        for (const t of e.region_tags) {
          const ok = t === 'any' || t === 'coastal' || regionIds.has(t) || cultureIds.has(t) || content.groups.includes(t);
          if (!ok) err(`event ${e.id}: unknown region tag ${t}`);
        }
      }
    } catch (e) {
      err((e as Error).message);
    }
  }
  return errors;
}
