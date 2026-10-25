import { describe, expect, it } from 'vitest';
import { gameData } from './helpers';
import { createWorld, setPlayer } from '../src/sim/setup';
import { World, WarKind, PlotKind, DAYS_PER_YEAR } from '../src/sim/world';
import { declareWar, atWar } from '../src/sim/systems/war';
import { launchRaid } from '../src/sim/systems/military';
import { applyCommand } from '../src/sim/commands';
import { resolveChoice } from '../src/sim/events/runner';
import { startPlot, plotsMonthly } from '../src/sim/systems/plots';
import { relationsMonthly, hasTradePact, pactIncome, getGrudge, COALITION_INFAMY } from '../src/sim/systems/relations';

const realmId = (w: World, name: string) => w.realmName.findIndex((n, i) => n === name && w.realmAlive[i] === 1);


/** Egypt is the player; Philistia and Jebus are its neighbors. */
async function setup() {
  const w = createWorld(await gameData(), 5);
  const egypt = realmId(w, 'Egypt'), phil = realmId(w, 'Philistia'), jebus = realmId(w, 'Jebus');
  setPlayer(w, egypt);
  w.playerQueue.length = 0;
  return { w, egypt, phil, jebus };
}

const firstProvOf = (w: World, r: number) => w.provOwner.findIndex((o) => o === r);

describe('trade pacts', () => {
  it('pay both partners every month and end when they go to war', async () => {
    const { w, egypt, phil } = await setup();
    w.opinion[phil * w.R + egypt] = 40;
    const res = applyCommand(w, { c: 'propose', type: 'trade', realm: phil });
    expect(res.ok).toBe(true);
    expect(hasTradePact(w, egypt, phil)).toBe(true);
    const before = w.realmTrade[egypt];
    const expected = pactIncome(w, phil);
    relationsMonthly(w);
    expect(w.realmTrade[egypt] - before).toBeCloseTo(expected, 3);
    // War tears the pact up, and the victim remembers.
    declareWar(w, phil, egypt, w.realmCapital[egypt], WarKind.Conquest);
    expect(hasTradePact(w, egypt, phil)).toBe(false);
    expect(getGrudge(w, egypt, phil)).toBeGreaterThan(0);
  });

  it('can be torn up by the player, at a price', async () => {
    const { w, egypt, phil } = await setup();
    w.opinion[phil * w.R + egypt] = 40;
    applyCommand(w, { c: 'propose', type: 'trade', realm: phil });
    const op = w.getOpinion(phil, egypt);
    expect(applyCommand(w, { c: 'cancelTrade', realm: phil }).ok).toBe(true);
    expect(hasTradePact(w, egypt, phil)).toBe(false);
    expect(w.getOpinion(phil, egypt)).toBeLessThan(op);
    expect(getGrudge(w, phil, egypt)).toBeGreaterThan(0);
    expect(w.memories.some((m) => m.a === phil && m.b === egypt && m.value < 0)).toBe(true);
  });
});

describe('truces', () => {
  it('can be broken only on purpose, and breaking one costs dearly', async () => {
    const { w, egypt, phil } = await setup();
    w.setTruce(egypt, phil, 3 * DAYS_PER_YEAR);
    const target = firstProvOf(w, phil);
    expect(applyCommand(w, { c: 'declareWar', target, kind: 'conquest' }).ok).toBe(false);
    const prestige = w.realmPrestige[egypt];
    const res = applyCommand(w, { c: 'declareWar', target, kind: 'conquest', breakTruce: true });
    expect(res.ok).toBe(true);
    expect(w.isHostile(egypt, phil)).toBe(true);
    expect(w.realmInfamy[egypt]).toBeGreaterThanOrEqual(30);
    expect(w.realmPrestige[egypt]).toBeLessThan(prestige - 20);
    expect(getGrudge(w, phil, egypt)).toBeGreaterThanOrEqual(60);
    expect(w.memories.some((m) => m.a === phil && m.text.includes('truce'))).toBe(true);
  });
});

describe('betrayal', () => {
  it('raiding an ally breaks the alliance and the stronger victim takes revenge', async () => {
    const { w, phil, jebus } = await setup();
    w.setAllied(phil, jebus, true);
    w.rng.chance = () => true;
    launchRaid(w, jebus, w.realmCapital[phil]);
    expect(w.isAllied(phil, jebus)).toBe(false);
    expect(getGrudge(w, phil, jebus)).toBeGreaterThanOrEqual(70);
    expect(w.realmInfamy[jebus]).toBeGreaterThanOrEqual(20);
    expect(w.isHostile(phil, jebus)).toBe(true);
  });

  it('asks the player how to answer an ally that raids them', async () => {
    const { w, egypt, phil } = await setup();
    w.setAllied(egypt, phil, true);
    launchRaid(w, phil, w.realmCapital[egypt]);
    const q = w.playerQueue.find((x) => x.proposal?.type === 'betrayal');
    expect(q).toBeDefined();
    resolveChoice(w, q!.uid, 0);
    expect(w.isHostile(egypt, phil)).toBe(true);
    // A war of vengeance is no crime.
    expect(w.realmInfamy[egypt]).toBeLessThan(5);
  });
});

describe('calls to arms', () => {
  it('ask the player to defend an ally, and refusing ends the alliance', async () => {
    const { w, egypt, phil, jebus } = await setup();
    w.setAllied(egypt, jebus, true);
    declareWar(w, phil, jebus, w.realmCapital[jebus], WarKind.Conquest);
    const q = w.playerQueue.find((x) => x.proposal?.type === 'call');
    expect(q).toBeDefined();
    expect(atWar(w, egypt)).toBe(false);
    const prestige = w.realmPrestige[egypt];
    resolveChoice(w, q!.uid, 1);
    expect(w.isAllied(egypt, jebus)).toBe(false);
    expect(w.realmPrestige[egypt]).toBeLessThan(prestige);
    expect(getGrudge(w, jebus, egypt)).toBeGreaterThan(0);
  });

  it('bring the player in when accepted', async () => {
    const { w, egypt, phil, jebus } = await setup();
    w.setAllied(egypt, jebus, true);
    declareWar(w, phil, jebus, w.realmCapital[jebus], WarKind.Conquest);
    const q = w.playerQueue.find((x) => x.proposal?.type === 'call')!;
    resolveChoice(w, q.uid, 0);
    expect(w.isHostile(egypt, phil)).toBe(true);
  });

  it('are answered by a friendly AI ally when the player attacks', async () => {
    const { w, egypt, phil, jebus } = await setup();
    w.setAllied(egypt, jebus, true);
    w.opinion[jebus * w.R + egypt] = 80;
    w.opinion[jebus * w.R + phil] = -20;
    applyCommand(w, { c: 'declareWar', target: firstProvOf(w, phil), kind: 'conquest' });
    expect(w.isHostile(jebus, phil)).toBe(true);
  });
});

describe('schemes', () => {
  it('sway a ruler and forge claims that make war cheap', async () => {
    const { w, egypt, phil } = await setup();
    const me = w.realmRuler[egypt], them = w.realmRuler[phil];
    const op = w.getOpinion(phil, egypt);
    const p = startPlot(w, me, them, PlotKind.Sway);
    w.plotProgress[p] = 2;
    w.plotSecrecy[p] = 1;
    w.charIntrigue[them] = 0;
    plotsMonthly(w);
    expect(w.plotActive[p]).toBe(0);
    expect(w.getOpinion(phil, egypt)).toBeGreaterThanOrEqual(Math.min(100, op + 25));

    const target = firstProvOf(w, phil);
    const q = startPlot(w, me, them, PlotKind.Fabricate, target);
    w.plotProgress[q] = 2;
    plotsMonthly(w);
    expect(w.provClaim[target]).toBe(egypt);
    applyCommand(w, { c: 'declareWar', target, kind: 'conquest' });
    expect(w.isHostile(egypt, phil)).toBe(true);
    expect(w.realmInfamy[egypt]).toBeLessThanOrEqual(1.01);
  });

  it('can be started from commands against a realm ruler', async () => {
    const { w, phil } = await setup();
    w.realmTrade[w.player] = 100;
    expect(applyCommand(w, { c: 'plot', target: w.realmRuler[phil], kind: 'steal' }).ok).toBe(true);
    expect(applyCommand(w, { c: 'plot', target: w.realmRuler[phil], kind: 'incite' }).ok).toBe(false); // one at a time
  });
});

describe('coalitions', () => {
  it('form against an infamous realm', async () => {
    const { w, egypt } = await setup();
    w.realmInfamy[egypt] = COALITION_INFAMY + 10;
    for (let r = 0; r < w.R; r++) if (r !== egypt) w.opinion[r * w.R + egypt] = -60;
    relationsMonthly(w);
    const members: number[] = [];
    for (let r = 0; r < w.R; r++) if (w.realmCoalition[r] === egypt) members.push(r);
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(w.isAllied(members[0], members[1])).toBe(true);
    expect(w.log.some((l) => l.text.includes('coalition against us'))).toBe(true);
    // Members leave when the fear fades.
    w.realmInfamy[egypt] = 0;
    relationsMonthly(w);
    expect(w.realmCoalition.some((c) => c === egypt)).toBe(false);
  });
});
