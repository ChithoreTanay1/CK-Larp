import { describe, expect, it } from 'vitest';
import { gameData } from './helpers';
import { createWorld, setPlayer } from '../src/sim/setup';
import { World, ArmyKind, WarKind } from '../src/sim/world';
import { spawnArmy, siegeNeed, siegeMinMen, siegeBlocked, assault, fortsMonthly } from '../src/sim/systems/military';
import { declareWar } from '../src/sim/systems/war';
import { applyCommand } from '../src/sim/commands';
import { stepDay } from '../src/sim/tick';

const realmId = (w: World, name: string) => w.realmName.findIndex((n, i) => n === name && w.realmAlive[i] === 1);
const prov = (w: World, name: string) => w.scenario.provinces.findIndex((p) => p.name === name);

/** Egypt at war with Philistia, with a host parked in Gaza. */
async function siegeSetup(seed = 3) {
  const w = createWorld(await gameData(), seed);
  const egypt = realmId(w, 'Egypt'), phil = realmId(w, 'Philistia');
  setPlayer(w, egypt);
  w.playerQueue.length = 0;
  const gaza = prov(w, 'Gaza');
  declareWar(w, egypt, phil, gaza, WarKind.Conquest);
  // Clear the field so only our test army is around.
  for (let a = 0; a < w.armyActive.length; a++) w.armyActive[a] = 0;
  w.realmArmy.fill(-1);
  return { w, egypt, phil, gaza };
}

/** Days for a fresh army of `men` spearmen to take p, or Infinity. */
function siegeDays(w: World, r: number, p: number, men: number): number {
  const a = spawnArmy(w, r, ArmyKind.Host, p, [men, 0, 0, 0, 0]);
  w.armyManual[a] = 1;
  for (let d = 1; d <= 400; d++) {
    stepDay(w);
    w.playerQueue.length = 0;
    if (w.provOccupier[p] === r) return d;
    if (!w.armyActive[a]) return Infinity;
  }
  return Infinity;
}

describe('forts', () => {
  it('start on famous citadels and every capital', async () => {
    const w = createWorld(await gameData(), 1);
    expect(w.provFort[prov(w, 'Mycenae')]).toBe(3);
    expect(w.provFort[prov(w, 'Tyre')]).toBe(3);
    for (let r = 0; r < w.R; r++) if (w.realmAlive[r] && !w.realmLandless[r]) expect(w.provFort[w.realmCapital[r]]).toBeGreaterThanOrEqual(1);
  });

  it('raise the siege work and the men needed', async () => {
    const { w, gaza } = await siegeSetup();
    w.provFort[gaza] = 0;
    const need0 = siegeNeed(w, gaza), men0 = siegeMinMen(w, gaza);
    w.provFort[gaza] = 3;
    expect(siegeNeed(w, gaza)).toBeGreaterThan(need0 + 100);
    expect(siegeMinMen(w, gaza)).toBeGreaterThan(men0 + 1000);
    // Stone walls need a thousand men.
    w.provFort[gaza] = 2;
    expect(siegeMinMen(w, gaza)).toBe(1000);
  });

  it('make no progress for an army too small to invest them', async () => {
    const { w, egypt, gaza } = await siegeSetup();
    w.provFort[gaza] = 3;
    const a = spawnArmy(w, egypt, ArmyKind.Host, gaza, [900, 0, 0, 0, 0]);
    expect(siegeBlocked(w, a)).toMatch(/too few men/);
  });

  it('make a siege take much longer', async () => {
    const open = await siegeSetup();
    open.w.provFort[open.gaza] = 0;
    const tOpen = siegeDays(open.w, open.egypt, open.gaza, 3000);
    const walled = await siegeSetup();
    walled.w.provFort[walled.gaza] = 3;
    const tWalled = siegeDays(walled.w, walled.egypt, walled.gaza, 3000);
    expect(tOpen).toBeLessThan(60);
    expect(tWalled).toBeGreaterThan(tOpen * 3);
  });

  it('can be stormed, at a cost in men and a level of wall', async () => {
    const { w, egypt, gaza } = await siegeSetup();
    w.provFort[gaza] = 2;
    const a = spawnArmy(w, egypt, ArmyKind.Host, gaza, [4000, 0, 0, 3000, 0]);
    w.armySiege[a] = siegeNeed(w, gaza) * 0.9;
    const before = w.armyMen[a];
    let won = false;
    for (let i = 0; i < 6 && !won && w.armyActive[a]; i++) won = assault(w, a);
    expect(won).toBe(true);
    expect(w.provOccupier[gaza]).toBe(egypt);
    expect(w.provFort[gaza]).toBe(1);
    expect(w.armyMen[a]).toBeLessThan(before);
  });

  it('are built by the player over months', async () => {
    const w = createWorld(await gameData(), 9);
    const me = realmId(w, 'Tyre');
    setPlayer(w, me);
    const p = w.realmCapital[me] === prov(w, 'Tyre') ? prov(w, 'Sidon') : w.realmCapital[me];
    const target = w.provOwner[p] === me ? p : w.realmCapital[me];
    w.provFort[target] = Math.min(w.provFort[target], 2);
    const lvl = w.provFort[target];
    w.realmTrade[me] = 1000;
    w.realmMetal[me] = 1000;
    expect(applyCommand(w, { c: 'buildFort', prov: target }).ok).toBe(true);
    expect(w.realmTrade[me]).toBeLessThan(1000);
    expect(applyCommand(w, { c: 'buildFort', prov: target }).ok).toBe(false);
    for (let m = 0; m < 6 * (lvl + 1); m++) fortsMonthly(w);
    expect(w.provFort[target]).toBe(lvl + 1);
  });
});
