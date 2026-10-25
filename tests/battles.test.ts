import { describe, expect, it } from 'vitest';
import { gameData } from './helpers';
import { createWorld, setPlayer } from '../src/sim/setup';
import { World, ArmyKind, WarKind, ARMY_CAP, NONE } from '../src/sim/world';
import { spawnArmy, setDest } from '../src/sim/systems/military';
import { declareWar } from '../src/sim/systems/war';
import { applyCommand } from '../src/sim/commands';
import { stepDay } from '../src/sim/tick';

const realmId = (w: World, name: string) => w.realmName.findIndex((n, i) => n === name && w.realmAlive[i] === 1);
const prov = (w: World, name: string) => w.scenario.provinces.findIndex((p) => p.name === name);

/** Egypt (player) at war with Philistia; all other armies cleared. */
async function warSetup() {
  const w = createWorld(await gameData(), 5);
  const egypt = realmId(w, 'Egypt'), phil = realmId(w, 'Philistia');
  setPlayer(w, egypt);
  declareWar(w, phil, egypt, w.realmCapital[egypt], WarKind.Conquest);
  w.armyActive.fill(0);
  w.realmArmy.fill(NONE);
  w.playerQueue.length = 0;
  return { w, egypt, phil };
}

function run(w: World, days: number, until: () => boolean = () => false): number {
  for (let d = 1; d <= days; d++) {
    stepDay(w);
    w.playerQueue.length = 0;
    if (until()) return d;
  }
  return days;
}

describe('battles', () => {
  it('stop a marching army where an enemy stands, and last several days', async () => {
    const { w, egypt, phil } = await warSetup();
    const gaza = prov(w, 'Gaza'), tjaru = prov(w, 'Tjaru'), memphis = prov(w, 'Memphis');
    const def = spawnArmy(w, egypt, ArmyKind.Host, tjaru, [3000, 1000, 500, 0, 0]);
    w.armyManual[def] = 1;
    // The Philistines march from Gaza past Tjaru toward Memphis.
    const att = spawnArmy(w, phil, ArmyKind.Host, gaza, [2500, 800, 500, 300, 0]);
    w.armyManual[att] = 1;
    setDest(w, att, memphis);
    run(w, 60, () => w.armyBattle[att] >= 0);
    expect(w.armyBattle[att]).toBeGreaterThanOrEqual(0);
    expect(w.armyLoc[att]).toBe(tjaru);
    const bt = w.armyBattle[att];
    expect(w.armyBattle[def]).toBe(bt);
    const days = run(w, 30, () => !w.battleActive[bt]);
    expect(w.battleActive[bt]).toBe(0);
    expect(days).toBeGreaterThan(1);
    // Exactly one side holds the field; the loser fell back or broke.
    const attHolds = w.armyActive[att] === 1 && w.armyLoc[att] === tjaru && w.armyNext[att] < 0;
    const defHolds = w.armyActive[def] === 1 && w.armyLoc[def] === tjaru && w.armyNext[def] < 0;
    expect(attHolds !== defHolds).toBe(true);
    expect(w.log.some((l) => l.text.startsWith('Battle of Tjaru'))).toBe(true);
    expect(w.battleReports.length).toBeGreaterThan(0);
  });

  it('happen when two armies meet on the road', async () => {
    const { w, egypt, phil } = await warSetup();
    const a = prov(w, 'Tjaru'), b = w.map.adj[w.map.adjOffset[prov(w, 'Tjaru')]];
    const x = spawnArmy(w, egypt, ArmyKind.Host, a, [2000, 0, 0, 0, 0]);
    const y = spawnArmy(w, phil, ArmyKind.Host, b, [2000, 0, 0, 0, 0]);
    w.armyManual[x] = w.armyManual[y] = 1;
    setDest(w, x, b);
    setDest(w, y, a);
    run(w, 40, () => w.armyBattle[x] >= 0);
    expect(w.armyBattle[x]).toBeGreaterThanOrEqual(0);
    expect(w.armyBattle[x]).toBe(w.armyBattle[y]);
  });

  it('can be broken off with a retreat', async () => {
    const { w, egypt, phil } = await warSetup();
    const p = prov(w, 'Tjaru');
    const x = spawnArmy(w, egypt, ArmyKind.Host, p, [1000, 0, 0, 0, 0]);
    spawnArmy(w, phil, ArmyKind.Host, p, [4000, 0, 0, 0, 0]);
    w.armyManual[x] = 1;
    run(w, 1);
    expect(w.armyBattle[x]).toBeGreaterThanOrEqual(0);
    expect(applyCommand(w, { c: 'moveArmy', army: x, dest: w.realmCapital[egypt] }).ok).toBe(false);
    expect(applyCommand(w, { c: 'retreat', army: x }).ok).toBe(true);
    expect(w.armyBattle[x]).toBe(NONE);
  });
});

describe('player armies', () => {
  it('are raised at war under the player\'s command and stay put', async () => {
    const w = createWorld(await gameData(), 8);
    const me = realmId(w, 'Mycenae');
    setPlayer(w, me);
    const target = w.realmCapital[realmId(w, 'Pylos')];
    expect(applyCommand(w, { c: 'declareWar', target, kind: 'conquest' }).ok).toBe(true);
    const mine = () => Array.from({ length: ARMY_CAP }, (_, a) => a).filter((a) => w.armyActive[a] && w.armyRealm[a] === me && w.armyKind[a] === ArmyKind.Host);
    expect(mine().length).toBeGreaterThan(0);
    const start = mine().map((a) => w.armyLoc[a]);
    for (const a of mine()) expect(w.armyManual[a]).toBe(1);
    // A month passes with no orders and no enemy in reach: nothing of ours moves.
    for (let d = 0; d < 30; d++) {
      for (let a = 0; a < ARMY_CAP; a++) if (w.armyRealm[a] !== me) w.armyActive[a] = 0;
      stepDay(w);
      w.playerQueue.length = 0;
    }
    mine().forEach((a, i) => {
      expect(w.armyLoc[a]).toBe(start[i]);
      expect(w.armyNext[a]).toBe(NONE);
      expect(w.armyManual[a]).toBe(1);
    });
  });
});
