import { describe, expect, it } from 'vitest';
import { gameData } from './helpers';
import { createWorld, setPlayer } from '../src/sim/setup';
import { World, ArmyKind, ARMY_CAP, DAYS_PER_YEAR } from '../src/sim/world';
import { spawnArmy, raiseArmy, combatPower, availableLevy, fieldedMen } from '../src/sim/systems/military';
import { applyCommand } from '../src/sim/commands';
import { stepDay } from '../src/sim/tick';
import { UNIT_COUNT, Unit } from '../src/sim/units';

const PLAINS = 0, MOUNTAINS = 2;
const realmId = (w: World, name: string) => w.realmName.findIndex((n, i) => n === name && w.realmAlive[i] === 1);
const units = (w: World, a: number) => Array.from(w.armyUnits.subarray(a * UNIT_COUNT, a * UNIT_COUNT + UNIT_COUNT));
const army = (w: World, r: number, loc: number, mix: number[]) => spawnArmy(w, r, ArmyKind.Host, loc, mix);

async function setup() {
  const w = createWorld(await gameData(), 41);
  const me = realmId(w, 'Egypt');
  setPlayer(w, me);
  w.playerQueue.length = 0;
  return { w, me, cap: w.realmCapital[me] };
}

describe('troop types', () => {
  it('chariots are strong on plains and weak in mountains', async () => {
    const { w, me, cap } = await setup();
    const a = army(w, me, cap, [0, 0, 0, 0, 500]);
    expect(combatPower(w, a, -1, PLAINS).power).toBeGreaterThan(combatPower(w, a, -1, MOUNTAINS).power * 2.5);
  });

  it('spearmen blunt a chariot charge better than archers do', async () => {
    const { w, me, cap } = await setup();
    const chariots = army(w, me, cap, [0, 0, 0, 0, 400]);
    const spears = army(w, me, cap, [1000, 0, 0, 0, 0]);
    const bows = army(w, me, cap, [0, 1000, 0, 0, 0]);
    expect(combatPower(w, chariots, spears, PLAINS).shock).toBeLessThan(combatPower(w, chariots, bows, PLAINS).shock * 0.5);
  });

  it('archers and slingers fight better in the hills than on the plain', async () => {
    const { w, me, cap } = await setup();
    const a = army(w, me, cap, [0, 500, 500, 0, 0]);
    expect(combatPower(w, a, -1, 1).power).toBeGreaterThan(combatPower(w, a, -1, PLAINS).power);
  });

  it('levies follow culture and palace realms field professionals', async () => {
    const { w } = await setup();
    const assyria = realmId(w, 'Assyria');
    w.realmMetal[assyria] = 500;
    w.realmTrade[assyria] = 500;
    w.realmCattle[assyria] = 500;
    const before = availableLevy(w, assyria);
    expect(before).toBeGreaterThan(80);
    const a = raiseArmy(w, assyria);
    const u = units(w, a);
    expect(u[Unit.Spear]).toBeGreaterThan(0);
    expect(u[Unit.Bow]).toBeGreaterThan(0);
    expect(u[Unit.Chariot]).toBeGreaterThan(0);
    expect(u[Unit.Heavy]).toBeGreaterThan(0);
    // Levy men stay within the levy; professionals come on top.
    expect(u[Unit.Spear] + u[Unit.Bow] + u[Unit.Sling]).toBeLessThanOrEqual(before + 1);
  });
});

describe('army commands', () => {
  it('raises armies only within the levy limit', async () => {
    const { w, me } = await setup();
    const avail = availableLevy(w, me);
    const r1 = applyCommand(w, { c: 'raiseArmy', men: avail / 2 });
    expect(r1.ok).toBe(true);
    expect(r1.id).toBeGreaterThanOrEqual(0);
    const r2 = applyCommand(w, { c: 'raiseArmy' });
    expect(r2.ok).toBe(true);
    expect(fieldedMen(w, me)).toBeCloseTo(avail, -1);
    expect(availableLevy(w, me)).toBeLessThan(1);
    expect(applyCommand(w, { c: 'raiseArmy' }).ok).toBe(false);
  });

  it('recruits chariots for metal, trade and cattle even with the levy spent', async () => {
    const { w, me } = await setup();
    const a = applyCommand(w, { c: 'raiseArmy' }).id!;
    expect(availableLevy(w, me)).toBeLessThan(1);
    w.realmMetal[me] = 100;
    w.realmTrade[me] = 100;
    w.realmCattle[me] = 100;
    expect(applyCommand(w, { c: 'recruit', army: a, unit: Unit.Chariot, men: 100 }).ok).toBe(true);
    expect(units(w, a)[Unit.Chariot]).toBe(100);
    expect(w.realmMetal[me]).toBeCloseTo(94);
    expect(w.realmCattle[me]).toBeCloseTo(96);
    w.realmMetal[me] = 0;
    expect(applyCommand(w, { c: 'recruit', army: a, unit: Unit.Chariot, men: 100 }).ok).toBe(false);
  });

  it('splits and merges without losing men', async () => {
    const { w } = await setup();
    const a = applyCommand(w, { c: 'raiseArmy', men: 1000 }).id!;
    const total = w.armyMen[a];
    const half = units(w, a).map((n) => Math.floor(n / 2));
    const b = applyCommand(w, { c: 'splitArmy', army: a, units: half }).id!;
    expect(b).toBeGreaterThanOrEqual(0);
    expect(w.armyMen[a] + w.armyMen[b]).toBeCloseTo(total, 3);
    expect(applyCommand(w, { c: 'mergeArmies', army: a, other: b }).ok).toBe(true);
    expect(w.armyActive[b]).toBe(0);
    expect(w.armyMen[a]).toBeCloseTo(total, 3);
  });

  it('moves, halts, and assigns a commander', async () => {
    const { w, me, cap } = await setup();
    const a = applyCommand(w, { c: 'raiseArmy' }).id!;
    const m = w.map;
    const dest = m.adj[m.adjOffset[cap]];
    expect(applyCommand(w, { c: 'moveArmy', army: a, dest }).ok).toBe(true);
    for (let d = 0; d < 60 && w.armyLoc[a] !== dest; d++) stepDay(w);
    expect(w.armyLoc[a]).toBe(dest);
    expect(applyCommand(w, { c: 'haltArmy', army: a }).ok).toBe(true);
    const ruler = w.realmRuler[me];
    expect(applyCommand(w, { c: 'setCommander', army: a, char: ruler }).ok).toBe(true);
    expect(w.armyLeader[a]).toBe(ruler);
  });

  it('keeps the head count equal to the sum of troop types through years of war', async () => {
    const w = createWorld(await gameData(), 7);
    for (let d = 0; d < 20 * DAYS_PER_YEAR; d++) {
      stepDay(w);
      if (d % 90 !== 0) continue;
      for (let a = 0; a < ARMY_CAP; a++) {
        if (!w.armyActive[a]) continue;
        const sum = units(w, a).reduce((x, y) => x + y, 0);
        expect(w.armyMen[a]).toBeCloseTo(sum, 1);
        for (const n of units(w, a)) expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
