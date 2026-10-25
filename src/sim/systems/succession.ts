import { World, NONE, Law } from '../world';
import { createChar } from './characters';
import { fireTrigger } from '../events/runner';
import { mergeRealm, newDynasty, setRuler } from './realms';

/** Scratch list for candidate scans. */
let cand = new Int32Array(256);

function isChildOf(w: World, c: number, parent: number): boolean {
  return w.charFather[c] === parent || w.charMother[c] === parent;
}

function siblings(w: World, a: number, b: number): boolean {
  const f = w.charFather[a];
  return a !== b && f >= 0 && f === w.charFather[b];
}

/**
 * Pick the heir of realm r if `ruler` died now. Returns -1 if the dynasty has no one left.
 * West primogeniture: sons by age, then brothers, nephews, daughters, then any dynast.
 * Elective / tribal: the strongest adult candidate of the dynasty.
 */
export function findHeir(w: World, r: number, ruler: number): number {
  if (ruler < 0) return NONE;
  const dyn = w.charDynasty[ruler];
  const law = w.realmLaw[r];
  let n = 0;
  if (cand.length < w.aliveCount) cand = new Int32Array(w.charCap);
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (c === ruler || !w.charAlive[c]) continue;
    if (isChildOf(w, c, ruler) || (dyn >= 0 && w.charDynasty[c] === dyn)) cand[n++] = c;
  }
  if (n === 0) return NONE;

  if (law === Law.Primogeniture) {
    let best = NONE, bestRank = 1e9;
    for (let k = 0; k < n; k++) {
      const c = cand[k];
      const male = !w.charFemale[c];
      let rank: number;
      if (isChildOf(w, c, ruler)) rank = male ? 0 : 3;
      else if (siblings(w, c, ruler)) rank = male ? 1 : 4;
      else if (w.charFather[c] >= 0 && siblings(w, w.charFather[c], ruler)) rank = male ? 2 : 5;
      else rank = male ? 6 : 7;
      if (w.charRules[c] >= 0 && w.charRules[c] !== r) rank += 0.5; // prefer the unlanded
      // Within a rank, the eldest wins.
      const score = rank * 1e6 + w.charBirthDay[c] / 1000;
      if (score < bestRank) {
        bestRank = score;
        best = c;
      }
    }
    return best;
  }

  let best = NONE, bestScore = -1e9;
  for (let k = 0; k < n; k++) {
    const c = cand[k];
    const age = w.charAge[c];
    let s = law === Law.Tribal ? w.charMartial[c] * 1.5 + w.charDiplomacy[c] * 0.5 : w.charMartial[c] + w.charDiplomacy[c] + w.charLearning[c] * 0.5;
    if (age < 16) s -= 40;
    if (w.charFemale[c]) s -= 15;
    if (isChildOf(w, c, ruler)) s += 4;
    if (w.charRules[c] >= 0 && w.charRules[c] !== r) s -= 10;
    // Deterministic per-character jitter keeps the "heir" display stable between months.
    s += ((c * 2654435761) >>> 0) % 7;
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

/** Called when the ruler of realm r dies. */
export function onRulerDied(w: World, r: number, dead: number): void {
  if (!w.realmAlive[r]) return;
  let heir = findHeir(w, r, dead);
  const wasPlayer = r === w.player;
  let target = r;

  if (heir >= 0 && w.charRules[heir] >= 0 && w.charRules[heir] !== r) {
    // Heir already rules elsewhere: the two realms unite under one crown.
    const other = w.charRules[heir];
    if (w.top(other) === r) {
      mergeRealm(w, other, r);
      setRuler(w, r, heir);
    } else {
      mergeRealm(w, r, other);
      target = other;
      w.addLog('world', `${w.realmName[r]} passes by inheritance to ${w.charFullName(heir)} of ${w.realmName[other]}.`);
    }
  } else if (heir >= 0) {
    setRuler(w, r, heir);
  } else {
    // The line is extinct: a strongman seizes the throne and founds a new house.
    const culture = w.realmCulture[r];
    const c = createChar(w, { culture, female: false, age: 25 + w.rng.int(20), dynasty: NONE, realm: r });
    w.charDynasty[c] = newDynasty(w, culture);
    setRuler(w, r, c);
    heir = c;
    w.realmStability[r] = Math.max(0, w.realmStability[r] - 20);
    if (!wasPlayer && w.isFullDetail(r)) w.addLog('world', `The line of ${w.realmName[r]} is extinct. ${w.charFullName(c)} seizes the throne.`);
  }

  if (target === r) {
    const law = w.realmLaw[r];
    const hit = law === Law.Tribal ? 12 : law === Law.Elective ? 8 : 5;
    w.realmStability[r] = Math.max(0, w.realmStability[r] - hit - (w.charAge[heir] < 16 ? 10 : 0));
    w.realmPrestige[r] *= 0.85;
    if (w.charAge[heir] < 16 && w.concernsPlayer(r)) w.addLog('bad', `${w.realmName[r]} is ruled by a child. The court is restless.`);
  }

  if (wasPlayer) {
    if (w.charDynasty[heir] === w.playerDynasty) {
      w.player = target;
      w.addLog('family', `Long live ${w.charFullName(heir)}, ruler of ${w.realmName[target]}!`);
      fireTrigger(w, 'on_succession', target, NONE, heir);
    } else {
      // Look for any other realm still held by the dynasty.
      let found = NONE;
      for (let o = 0; o < w.R; o++) {
        const ru = w.realmRuler[o];
        if (w.realmAlive[o] && ru >= 0 && w.charDynasty[ru] === w.playerDynasty) {
          found = o;
          break;
        }
      }
      if (found >= 0) {
        w.player = found;
        w.addLog('family', `${w.realmName[r]} is lost to another house, but your blood still rules ${w.realmName[found]}.`);
      } else {
        w.gameOver = `The house of ${w.dynName[w.playerDynasty]} holds no throne. ${w.charFullName(heir)} now rules ${w.realmName[r]}.`;
      }
    }
  } else if (w.player !== NONE && w.isFullDetail(r) && w.realmProvCount[r] >= 2) {
    w.addLog('info', `${w.charFullName(heir)} now rules ${w.realmName[target]}.`);
  }
}
