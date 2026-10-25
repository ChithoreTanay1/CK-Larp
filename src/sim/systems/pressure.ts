import { World, NONE, P_DROUGHT, P_FAMINE, P_RAIDER, P_TRADE, P_IRON, P_LEGIT, WarKind } from '../world';
import { allocRealm, newDynasty, setRuler, transferProvince } from './realms';
import { createChar } from './characters';
import { declareWar } from './war';

let raided = new Float32Array(0), warring = new Float32Array(0), count = new Float32Array(0);

/**
 * The collapse model. Slow-moving regional values, updated monthly (quarterly for
 * reduced-detail regions), that bias events, AI choices, raider spawns and revolts.
 */
export function pressureMonthly(w: World): void {
  const n = w.regionCount;
  if (raided.length !== n) {
    raided = new Float32Array(n);
    warring = new Float32Array(n);
    count = new Float32Array(n);
  }
  raided.fill(0);
  warring.fill(0);
  count.fill(0);
  for (let p = 0; p < w.P; p++) {
    const reg = w.provRegion[p];
    count[reg]++;
    if (w.provRaided[p] > 0) raided[reg]++;
    const o = w.provOwner[p];
    if (o >= 0 && w.realmArmy[w.top(o)] >= 0) warring[reg]++;
  }
  const quarter = w.month % 3 === 0;
  // Slow climate cycle shared by the whole world (decades long), plus regional noise.
  const cycle = Math.sin((w.month / 12 / 37) * Math.PI * 2) * 0.08;

  for (let r = 0; r < n; r++) {
    const full = w.regionDetail[r] === 1;
    if (!full && !quarter) continue;
    const k = full ? 1 : 3;
    const data = w.scenario.regions[r];
    const raidShare = count[r] ? raided[r] / count[r] : 0;
    const warShare = count[r] ? warring[r] / count[r] : 0;
    const rng = w.rng;

    const d = w.p(r, P_DROUGHT);
    w.setP(r, P_DROUGHT, d + (data.droughtBaseline + cycle - d) * 0.02 * k + (rng.next() - 0.5) * 0.03 * Math.sqrt(k));
    const dr = w.p(r, P_DROUGHT);
    const th = w.p(r, P_TRADE);
    const rp = w.p(r, P_RAIDER);

    const famineTarget = dr * 0.75 + (1 - th) * 0.25 + raidShare * 0.5 - 0.15;
    w.setP(r, P_FAMINE, w.p(r, P_FAMINE) + (famineTarget - w.p(r, P_FAMINE)) * 0.08 * k);
    const fam = w.p(r, P_FAMINE);

    // Hunger drives migration, which shows up as raiders.
    const raidTarget = data.raiderBaseline + fam * 0.3 + (w.regionRaids[r] > 0 ? 0.05 : 0);
    w.setP(r, P_RAIDER, rp + (raidTarget - rp) * 0.015 * k);

    const tradeTarget = 0.3 + 0.65 * (1 - rp) * (1 - warShare * 0.5) - raidShare * 0.3;
    w.setP(r, P_TRADE, th + (tradeTarget - th) * 0.012 * k);

    // Bronze needs tin from far away; when trade fails, smiths turn to local iron.
    const iron = w.p(r, P_IRON);
    w.setP(r, P_IRON, iron + (0.0006 + 0.0018 * (1 - th)) * data.ironRate * k);

    const legit = w.p(r, P_LEGIT);
    w.setP(r, P_LEGIT, legit + (0.75 - fam * 0.4 - warShare * 0.2 - legit) * 0.025 * k);

    w.regionRaids[r] = 0;
  }
}

/** Yearly climate shocks: a failed rain or a good flood year. */
export function pressureYearly(w: World): void {
  for (let r = 0; r < w.regionCount; r++) {
    if (w.rng.chance(0.18)) {
      w.setP(r, P_DROUGHT, w.p(r, P_DROUGHT) + 0.12 + w.rng.next() * 0.1);
      if (w.player !== NONE && w.realmRegion(w.player) === r) w.addLog('bad', `The rains have failed across ${w.scenario.regions[r].name}.`);
    } else if (w.rng.chance(0.12)) {
      w.setP(r, P_DROUGHT, w.p(r, P_DROUGHT) - 0.1);
    }
  }
}

/** Starving, restless provinces may rise against an unstable ruler. */
export function revoltsMonthly(w: World): void {
  for (let p = 0; p < w.P; p++) {
    const o = w.provOwner[p];
    if (o < 0 || w.provUnrest[p] < 55) continue;
    if (w.realmCapital[o] === p || w.realmProvCount[o] < 2) continue;
    const top = w.top(o);
    const stab = w.realmStability[o];
    const legit = w.p(w.provRegion[p], P_LEGIT);
    const chance = ((w.provUnrest[p] - 50) / 50) * (1 - stab / 100) * (1.2 - legit) * 0.06;
    if (!w.rng.chance(chance)) continue;
    const culture = w.realmCulture[o];
    const rebel = allocRealm(w, `${w.scenario.provinces[p].name} Rebels`, culture, w.content.cultureLaw[culture]);
    const leader = createChar(w, { culture, female: false, age: 24 + w.rng.int(20), dynasty: NONE, realm: rebel });
    w.charDynasty[leader] = newDynasty(w, culture);
    setRuler(w, rebel, leader);
    transferProvince(w, p, rebel);
    w.realmCapital[rebel] = p;
    w.realmGrain[rebel] = 20;
    w.realmStability[rebel] = 40;
    w.provUnrest[p] = 10;
    w.addLog(w.concernsPlayer(o) ? 'bad' : 'world', `Unpaid soldiers and hungry farmers rise in ${w.scenario.provinces[p].name} against ${w.realmName[o]}!`, p);
    declareWar(w, rebel, top, p, WarKind.Revolt);
  }
}
