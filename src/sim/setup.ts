import type { CultureData, EventData, ScenarioData, TraitData } from './types';
import { TERRAINS, PRESSURE_KEYS, LAWS } from './types';
import { World, NONE, PRESSURE_COUNT } from './world';
import { generateMap, type MapData } from './mapgen';
import { compileContent, type Content } from './content';
import { compileEvents, type EventDb } from './events/loader';
import { setEventDb } from './events/runner';
import { initTraitIds, generateFamily } from './systems/characters';
import { allocRealm, newDynasty, setRuler, computeLevies } from './systems/realms';
import { BASE_POP } from './systems/economy';
import { promoteDetail } from './tick';

export interface GameData {
  scenario: ScenarioData;
  content: Content;
  events: EventDb;
  map: MapData;
}

/** Compile all static data once. The map is deterministic per scenario, so saves don't store it. */
export function loadGameData(scenario: ScenarioData, cultures: CultureData[], traits: TraitData[], events: EventData[]): GameData {
  const content = compileContent(traits, cultures);
  const db = compileEvents(events, content);
  const map = generateMap(scenario);
  return { scenario, content, events: db, map };
}

/** A fresh world at the scenario's start date. */
export function createWorld(data: GameData, seed: number): World {
  const { scenario: s, content } = data;
  setEventDb(data.events);
  const w = new World(s, data.map, content, seed);
  initTraitIds(w);
  const regionIdx = new Map(s.regions.map((r, i) => [r.id, i]));

  s.regions.forEach((r, i) => {
    w.regionDetail[i] = r.detail === 'full' ? 1 : 0;
    PRESSURE_KEYS.forEach((k, j) => (w.pressure[i * PRESSURE_COUNT + j] = r.pressure[k]));
  });

  const provIdx = new Map(s.provinces.map((p, i) => [p.name, i]));
  s.provinces.forEach((p, i) => {
    w.provRegion[i] = regionIdx.get(p.region)!;
    const t = TERRAINS.indexOf(p.terrain);
    w.provTerrain[i] = t;
    w.provDevelop[i] = p.develop;
    w.provOre[i] = p.ore;
    w.provTrade[i] = p.trade;
    w.provPop[i] = BASE_POP[t] * (0.7 + p.develop * 0.15) * (0.9 + w.rng.next() * 0.2);
  });

  const realmIdx = new Map<string, number>();
  for (const rd of s.realms) {
    const culture = content.cultureIdx.get(rd.culture)!;
    const law = rd.law ? LAWS.indexOf(rd.law) : content.cultureLaw[culture];
    const r = allocRealm(w, rd.name, culture, law);
    realmIdx.set(rd.id, r);
    for (const pn of rd.provinces) {
      const p = provIdx.get(pn)!;
      w.provOwner[p] = r;
    }
    w.realmCapital[r] = provIdx.get(rd.provinces[0])!;
    w.realmAiOffset[r] = r % 30;
    const dyn = newDynasty(w, culture);
    const ruler = generateFamily(w, r, culture, dyn);
    setRuler(w, r, ruler);
  }
  for (const rd of s.realms) {
    if (!rd.liege) continue;
    const r = realmIdx.get(rd.id)!;
    w.realmLiege[r] = realmIdx.get(rd.liege)!;
    w.realmLoyalty[r] = 55 + w.rng.int(20);
  }

  w.recountProvinces();
  // Starting stores scale with the realm.
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r]) continue;
    let pop = 0;
    for (let p = 0; p < w.P; p++) if (w.provOwner[p] === r) pop += w.provPop[p];
    w.realmGrain[r] = pop * 2.5;
    w.realmCattle[r] = pop * 1.5;
    w.realmMetal[r] = 4 + pop * 0.3;
    w.realmTrade[r] = 10 + pop * 0.5;
    w.realmPrestige[r] = 10 + w.realmProvCount[r] * 4;
    w.realmStability[r] = 40 + w.rng.int(25);
  }
  // Starting opinions: kin like kin, everyone a little suspicious of everyone.
  const R = w.R;
  for (let a = 0; a < R; a++) {
    if (!w.realmAlive[a]) continue;
    for (let b = 0; b < R; b++) {
      if (a === b || !w.realmAlive[b]) continue;
      let o = w.rng.int(21) - 10;
      if (w.realmCulture[a] === w.realmCulture[b]) o += 15;
      else if (content.cultureGroup[w.realmCulture[a]] === content.cultureGroup[w.realmCulture[b]]) o += 5;
      if (w.realmLiege[a] === b) o += 20;
      w.opinion[a * R + b] = o;
    }
  }
  w.rebuildAlive();
  computeLevies(w);
  w.dirtyProv.fill(1);
  w.realmsDirty = true;
  return w;
}

/** Hand a realm to the player. */
export function setPlayer(w: World, r: number): void {
  w.player = r;
  const ruler = w.realmRuler[r];
  w.playerDynasty = ruler >= 0 ? w.charDynasty[ruler] : NONE;
  promoteDetail(w);
  w.addLog('info', `You are ${w.charFullName(ruler)}, ruler of ${w.realmName[r]}. The year is ${w.yearBce} BCE.`);
}
