import { describe, expect, it } from 'vitest';
import { gameData } from './helpers';
import { createWorld, setPlayer } from '../src/sim/setup';
import { stepDay } from '../src/sim/tick';
import { serializeWorld, deserializeWorld } from '../src/sim/save';
import { findHeir } from '../src/sim/systems/succession';
import { createChar, killChar } from '../src/sim/systems/characters';
import { World, NONE, DAYS_PER_YEAR } from '../src/sim/world';
import { validateData } from '../src/sim/validate';
import { applyCommand } from '../src/sim/commands';
import { forceEvent, resolveChoice } from '../src/sim/events/runner';
import scenario from '../src/data/scenarios/west.json';
import cultures from '../src/data/cultures.json';
import traits from '../src/data/traits.json';
import events from '../src/data/events/west.json';
import type { CultureData, EventData, ScenarioData, TraitData } from '../src/sim/types';

function hash(w: World): string {
  let h = 2166136261;
  const mix = (a: ArrayLike<number>) => {
    for (let i = 0; i < a.length; i++) h = Math.imul(h ^ Math.round(a[i] * 1000), 16777619) >>> 0;
  };
  mix(w.provOwner);
  mix(w.provPop);
  mix(w.realmGrain);
  mix(w.realmRuler);
  mix(w.charAge.subarray(0, w.charCount));
  return `${w.day}:${w.charCount}:${h}`;
}

const realmId = (w: World, name: string) => w.realmName.findIndex((n, i) => n === name && w.realmAlive[i] === 1);

describe('data', () => {
  it('passes validation', () => {
    const errors = validateData(scenario as unknown as ScenarioData, cultures as CultureData[], traits as TraitData[], events as unknown as EventData[]);
    expect(errors).toEqual([]);
    expect(events.length).toBeGreaterThanOrEqual(50);
  });
});

describe('simulation', () => {
  it('is deterministic for a seed', async () => {
    const data = await gameData();
    const a = createWorld(data, 99);
    const b = createWorld(data, 99);
    for (let d = 0; d < 3 * DAYS_PER_YEAR; d++) {
      stepDay(a);
      stepDay(b);
    }
    expect(hash(a)).toBe(hash(b));
  });

  it('round-trips through a save file and continues identically', async () => {
    const data = await gameData();
    const a = createWorld(data, 5);
    setPlayer(a, realmId(a, 'Mycenae'));
    for (let d = 0; d < 2 * DAYS_PER_YEAR; d++) stepDay(a);
    a.playerQueue.length = 0;
    const buf = await serializeWorld(a);
    const b = await deserializeWorld(data, buf);
    expect(hash(b)).toBe(hash(a));
    expect(b.player).toBe(a.player);
    expect(b.dynName).toEqual(a.dynName);
    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      stepDay(a);
      stepDay(b);
    }
    expect(hash(b)).toBe(hash(a));
  });

  it('passes the throne to the eldest son under primogeniture', async () => {
    const data = await gameData();
    const w = createWorld(data, 11);
    const r = realmId(w, 'Mycenae');
    const ruler = w.realmRuler[r];
    const culture = w.realmCulture[r];
    const dyn = w.charDynasty[ruler];
    const younger = createChar(w, { culture, female: false, age: 10, dynasty: dyn, father: ruler, realm: r });
    const elder = createChar(w, { culture, female: false, age: 14, dynasty: dyn, father: ruler, realm: r });
    const daughter = createChar(w, { culture, female: true, age: 20, dynasty: dyn, father: ruler, realm: r });
    w.rebuildAlive();
    // Sons generated with the family may exist too; the heir must be the eldest son.
    const heir = findHeir(w, r, ruler);
    expect(w.charFemale[heir]).toBe(0);
    expect(w.charFather[heir]).toBe(ruler);
    expect(w.charAge[heir]).toBeGreaterThanOrEqual(w.charAge[elder]);
    killChar(w, ruler, 'test');
    expect(w.realmRuler[r]).toBe(heir);
    expect([younger, daughter]).not.toContain(w.realmRuler[r]);
  });

  it('ends the game when the dynasty holds no throne', async () => {
    const data = await gameData();
    const w = createWorld(data, 12);
    setPlayer(w, realmId(w, 'Pylos'));
    for (let guard = 0; guard < 60 && !w.gameOver; guard++) {
      w.rebuildAlive();
      killChar(w, w.realmRuler[w.player], 'test');
    }
    expect(w.gameOver).not.toBe('');
  });

  it('applies player commands and event choices', async () => {
    const data = await gameData();
    const w = createWorld(data, 21);
    const r = realmId(w, 'Tyre');
    setPlayer(w, r);
    w.realmTrade[r] = 100;
    const before = w.realmStability[r];
    expect(applyCommand(w, { c: 'endowTemple' }).ok).toBe(true);
    expect(w.realmStability[r]).toBeGreaterThan(before);
    w.playerQueue.length = 0;
    expect(forceEvent(w, 'good_harvest', r)).toBe(true);
    const q = w.playerQueue[0];
    const grain = w.realmGrain[r];
    resolveChoice(w, q.uid, 0);
    expect(w.realmGrain[r]).toBeGreaterThan(grain);
    expect(w.playerQueue.length).toBe(0);
  });

  it('declares a war that resolves within a few years', async () => {
    const data = await gameData();
    const w = createWorld(data, 31);
    const me = realmId(w, 'Egypt');
    const target = realmId(w, 'Philistia');
    setPlayer(w, me);
    const p = w.realmCapital[target];
    expect(applyCommand(w, { c: 'declareWar', target: p, kind: 'conquest' }).ok).toBe(true);
    expect(w.isHostile(me, target)).toBe(true);
    for (let d = 0; d < 6 * DAYS_PER_YEAR && w.isHostile(me, target); d++) {
      stepDay(w);
      w.playerQueue.length = 0;
    }
    expect(w.isHostile(me, target)).toBe(false);
  });

  it('runs 50 years without corrupting state', async () => {
    const data = await gameData();
    const w = createWorld(data, 3);
    for (let d = 0; d < 50 * DAYS_PER_YEAR; d++) stepDay(w);
    for (let r = 0; r < w.R; r++) {
      if (!w.realmAlive[r]) continue;
      const ruler = w.realmRuler[r];
      expect(ruler).not.toBe(NONE);
      expect(w.charAlive[ruler]).toBe(1);
      expect(w.charRules[ruler]).toBe(r);
      expect(Number.isFinite(w.realmGrain[r])).toBe(true);
      if (!w.realmLandless[r]) expect(w.provOwner[w.realmCapital[r]]).toBe(r);
    }
    for (let p = 0; p < w.P; p++) expect(w.realmAlive[w.provOwner[p]]).toBe(1);
  });
});
