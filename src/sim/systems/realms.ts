import { World, NONE, WAR_CAP } from '../world';
import { endWar } from './war';

/** HSL (0-360, 0-1, 0-1) to 0xRRGGBB. */
export function hsl(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

export function realmColorFor(w: World, culture: number, salt: number): number {
  const hue = w.content.cultures[culture].hue;
  const j = ((salt * 2654435761) >>> 0) / 4294967296;
  const k = ((salt * 40503 + 17) % 97) / 97;
  return hsl(hue + (j - 0.5) * 34, 0.38 + k * 0.3, 0.42 + ((j * 7) % 1) * 0.18);
}

export function newDynasty(w: World, culture: number): number {
  const c = w.content.cultures[culture];
  const used = new Set(w.dynName);
  let name = c.dynasties.find((d) => !used.has(d));
  if (!name) {
    for (let i = 0; i < 20 && !name; i++) {
      const n = `House of ${w.rng.pick(c.male)}`;
      if (!used.has(n)) name = n;
    }
    name ??= `House of ${w.rng.pick(c.male)} ${w.dynName.length}`;
  }
  w.dynName.push(name);
  w.dynCulture.push(culture);
  return w.dynName.length - 1;
}

/** Find a free realm slot and initialize it. */
export function allocRealm(w: World, name: string, culture: number, law: number): number {
  let r = NONE;
  for (let i = 0; i < w.R; i++) {
    if (!w.realmAlive[i] && w.realmRuler[i] === NONE) {
      r = i;
      break;
    }
  }
  if (r < 0) {
    // Recycle the longest-dead slot whose ruler is gone.
    for (let i = 0; i < w.R; i++) if (!w.realmAlive[i]) {
      r = i;
      break;
    }
  }
  if (r < 0) throw new Error('Out of realm slots');
  const R = w.R;
  for (let o = 0; o < R; o++) {
    w.opinion[r * R + o] = w.opinion[o * R + r] = 0;
    w.allied[r * R + o] = w.allied[o * R + r] = 0;
    w.truceUntil[r * R + o] = w.truceUntil[o * R + r] = 0;
    w.hostile[r * R + o] = w.hostile[o * R + r] = 0;
    w.married[r * R + o] = w.married[o * R + r] = 0;
    w.tradePact[r * R + o] = w.tradePact[o * R + r] = 0;
    w.grudge[r * R + o] = w.grudge[o * R + r] = 0;
    if (w.realmCoalition[o] === r) w.realmCoalition[o] = NONE;
  }
  for (let p = 0; p < w.P; p++) if (w.provClaim[p] === r) w.provClaim[p] = NONE;
  w.realmInfamy[r] = 0;
  w.realmCoalition[r] = NONE;
  w.memories = w.memories.filter((m) => m.a !== r && m.b !== r);
  for (let war = 0; war < WAR_CAP; war++) w.warSide[war * R + r] = 0;
  w.realmAlive[r] = 1;
  w.realmName[r] = name;
  w.realmCulture[r] = culture;
  w.realmLaw[r] = law;
  w.realmRuler[r] = NONE;
  w.realmLiege[r] = NONE;
  w.realmCapital[r] = NONE;
  w.realmLandless[r] = 0;
  w.realmGrain[r] = 40;
  w.realmCattle[r] = 20;
  w.realmMetal[r] = 5;
  w.realmTrade[r] = 10;
  w.realmPrestige[r] = 10;
  w.realmStability[r] = 50;
  w.realmLoyalty[r] = 60;
  w.realmManpower[r] = 1;
  w.realmAiGoal[r] = 0;
  w.realmAiOffset[r] = w.rng.int(90);
  w.realmRaidReady[r] = w.day + 90;
  w.realmArmy[r] = NONE;
  w.realmProvCount[r] = 0;
  w.realmLevy[r] = 0;
  w.realmFounded[r] = w.day;
  w.realmColor[r] = realmColorFor(w, culture, r * 7 + w.day);
  w.realmsDirty = true;
  return r;
}

export function setRuler(w: World, r: number, c: number): void {
  const old = w.realmRuler[r];
  if (old >= 0 && w.charRules[old] === r) w.charRules[old] = NONE;
  w.realmRuler[r] = c;
  w.charRules[c] = r;
  w.charRealm[c] = r;
  w.charHostage[c] = NONE;
  const sp = w.charSpouse[c];
  if (sp >= 0) w.charRealm[sp] = r;
  for (let a = 0; a < w.armyActive.length; a++) if (w.armyActive[a] && w.armyRealm[a] === r && w.armyLeader[a] < 0) w.armyLeader[a] = c;
  w.realmsDirty = true;
}

function pickCapital(w: World, r: number): number {
  let best = NONE, bestDev = -1;
  for (let p = 0; p < w.P; p++) {
    if (w.provOwner[p] === r && w.provDevelop[p] + w.provPop[p] / 100 > bestDev) {
      bestDev = w.provDevelop[p] + w.provPop[p] / 100;
      best = p;
    }
  }
  return best;
}

/** Give province p to realm `to` (NONE to leave it ownerless is not supported). */
export function transferProvince(w: World, p: number, to: number): void {
  const from = w.provOwner[p];
  if (from === to) return;
  w.provOwner[p] = to;
  w.provOccupier[p] = NONE;
  w.markProv(p);
  if (from >= 0) w.realmProvCount[from]--;
  w.realmProvCount[to]++;
  if (w.realmCapital[to] < 0) w.realmCapital[to] = p;
  w.realmLandless[to] = 0;
  if (from >= 0) {
    if (w.realmProvCount[from] <= 0) destroyRealm(w, from, `${w.realmName[from]} has fallen to ${w.realmName[w.top(to)]}.`);
    else if (w.realmCapital[from] === p) w.realmCapital[from] = pickCapital(w, from);
  }
  w.realmsDirty = true;
}

/** Fold realm `from` into realm `into` (inheritance, usurpation, absorption). */
export function mergeRealm(w: World, from: number, into: number): void {
  if (from === into) return;
  for (let p = 0; p < w.P; p++) {
    if (w.provOwner[p] === from) {
      w.provOwner[p] = into;
      w.provOccupier[p] = NONE;
      w.markProv(p);
    }
  }
  for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.realmLiege[o] === from && o !== into) w.realmLiege[o] = into;
  if (w.realmLiege[into] === from) w.realmLiege[into] = w.realmLiege[from];
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (w.charRealm[c] === from) w.charRealm[c] = into;
  }
  w.realmGrain[into] += w.realmGrain[from];
  w.realmCattle[into] += w.realmCattle[from];
  w.realmMetal[into] += w.realmMetal[from];
  w.realmTrade[into] += w.realmTrade[from];
  w.realmPrestige[into] += w.realmPrestige[from] * 0.5;
  w.recountProvinces();
  destroyRealm(w, from, '');
  if (w.player === from) w.player = into;
}

/** Remove a realm from the world: armies disband, wars end, vassals go free. */
export function destroyRealm(w: World, r: number, message: string): void {
  if (!w.realmAlive[r]) return;
  for (let war = 0; war < WAR_CAP; war++) {
    if (!w.warActive[war]) continue;
    if (w.warAttacker[war] === r || w.warDefender[war] === r) endWar(w, war, 'white');
    else w.warSide[war * w.R + r] = 0;
  }
  for (let a = 0; a < w.armyActive.length; a++) if (w.armyActive[a] && w.armyRealm[a] === r) w.armyActive[a] = 0;
  for (let o = 0; o < w.R; o++) {
    if (w.realmAlive[o] && w.realmLiege[o] === r) {
      w.realmLiege[o] = w.realmLiege[r];
      w.realmLoyalty[o] = 50;
    }
    w.allied[r * w.R + o] = w.allied[o * w.R + r] = 0;
  }
  for (let p = 0; p < w.P; p++) if (w.provOccupier[p] === r) w.provOccupier[p] = NONE;
  const ruler = w.realmRuler[r];
  if (ruler >= 0 && w.charRules[ruler] === r) w.charRules[ruler] = NONE;
  w.realmAlive[r] = 0;
  w.realmArmy[r] = NONE;
  w.realmsDirty = true;
  if (message && w.player !== NONE && (w.isFullDetail(r) || w.concernsPlayer(r))) w.addLog('world', message);

  if (r === w.player) {
    // The player's realm is gone; keep playing if the dynasty holds another throne.
    let found = NONE;
    for (let o = 0; o < w.R; o++) {
      const ru = w.realmRuler[o];
      if (w.realmAlive[o] && ru >= 0 && w.charDynasty[ru] === w.playerDynasty) {
        found = o;
        break;
      }
    }
    if (found >= 0) w.player = found;
    else w.gameOver = `${w.realmName[r]} has fallen, and the house of ${w.dynName[w.playerDynasty]} rules nowhere.`;
  }
  w.realmRuler[r] = NONE;
}

/** Military strength of a top-level realm (levy available now). */
export function strength(w: World, r: number): number {
  return w.realmLevy[r] * (0.3 + 0.7 * w.realmManpower[r]);
}

/** Strength including allies, used by the AI to judge wars. */
export function strengthWithAllies(w: World, r: number): number {
  let s = strength(w, r);
  for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.allied[r * w.R + o]) s += strength(w, o) * 0.5;
  return s;
}

let levyScratch = new Float32Array(0);

/** Recompute levies: own provinces, plus vassal contributions scaled by loyalty. */
export function computeLevies(w: World): void {
  if (levyScratch.length !== w.R) levyScratch = new Float32Array(w.R);
  const own = levyScratch;
  own.fill(0);
  for (let p = 0; p < w.P; p++) {
    const o = w.provOwner[p];
    if (o < 0) continue;
    const occ = w.provOccupier[p] >= 0 ? 0.3 : 1;
    own[o] += w.provPop[p] * 32 * occ;
  }
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r]) {
      w.realmLevy[r] = 0;
      continue;
    }
    own[r] *= 0.6 + 0.4 * (w.realmStability[r] / 100);
    w.realmLevy[r] = own[r];
  }
  for (let r = 0; r < w.R; r++) {
    const l = w.realmLiege[r];
    if (!w.realmAlive[r] || l < 0) continue;
    const share = own[r] * 0.5 * (w.realmLoyalty[r] / 100);
    w.realmLevy[w.top(r)] += share;
    w.realmLevy[r] -= share;
  }
}
