import { World, NONE, ARMY_CAP, WAR_CAP } from '../world';
import { armiesHostile, armyPower, setDest } from '../systems/military';

/**
 * Military AI: simple rules, no lookahead. Chase weaker enemies, avoid stronger
 * ones, besiege the war target, liberate home. Runs when idle or every 7 days.
 */
export function armyAi(w: World, a: number): void {
  const loc = w.armyLoc[a];
  if (w.armyManual[a]) return;
  const me = w.top(w.armyRealm[a]);
  const P = w.P;
  const hop = w.map.hopDays;
  const myPow = armyPower(w, a);
  const capital = w.realmCapital[me];

  // 1. Threats and prey among enemy armies.
  let threatDays = 1e9;
  let prey = NONE, preyScore = -1e9;
  for (let b = 0; b < ARMY_CAP; b++) {
    if (!w.armyActive[b] || b === a || !armiesHostile(w, a, b)) continue;
    const bl = w.armyNext[b] >= 0 ? w.armyNext[b] : w.armyLoc[b];
    const d = hop[bl * P + loc];
    if (d > 45) continue;
    const pb = armyPower(w, b);
    if (pb > myPow * 1.3) {
      if (d < threatDays) threatDays = d;
      continue;
    }
    if (pb < myPow * 0.95) {
      const inOurLand = w.provOwner[bl] >= 0 && w.top(w.provOwner[bl]) === me;
      const s = 100 - d + (inOurLand ? 35 : 0) + (pb / Math.max(1, myPow)) * 20;
      if (s > preyScore) {
        preyScore = s;
        prey = bl;
      }
    }
  }
  if (threatDays < 8 && capital >= 0 && loc !== capital) {
    setDest(w, a, capital);
    return;
  }
  if (prey >= 0 && preyScore > 55) {
    setDest(w, a, prey);
    return;
  }

  // 2. Liberate our occupied provinces, or besiege the enemy's.
  let best = NONE, bestScore = -1e9;
  for (let p = 0; p < P; p++) {
    const o = w.provOwner[p];
    if (o < 0) continue;
    const ot = w.top(o);
    const d = hop[p * P + loc];
    if (d === 0xffff) continue;
    let s = -1e9;
    if (ot === me) {
      const occ = w.provOccupier[p];
      if (occ >= 0 && w.hostile[me * w.R + occ]) s = 60 - d;
    } else if (w.hostile[me * w.R + ot]) {
      const occ = w.provOccupier[p];
      if (occ >= 0 && (occ === me || !w.hostile[me * w.R + occ])) continue;
      s = 40 - d + w.provDevelop[p] * 2;
      for (let war = 0; war < WAR_CAP; war++) {
        if (w.warActive[war] && w.warTarget[war] === p && w.warSide[war * w.R + me] === 1) s += 25;
      }
      if (w.realmCapital[ot] === p) s += 5;
    }
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  if (best >= 0) {
    if (best !== w.armyDest[a]) setDest(w, a, best);
    return;
  }
  if (capital >= 0 && loc !== capital) setDest(w, a, capital);
}
