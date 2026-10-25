import { World, NONE, DAYS_PER_YEAR, Law } from '../world';
import { traitId, KIND_PHYSICAL, TAG_SEAFARING } from '../content';
import { fireTrigger } from '../events/runner';
import { onRulerDied } from './succession';

/** Monthly death chance by age bracket (yearly chance / 12). */
function monthlyDeath(age: number): number {
  const y = age < 3 ? 0.07 : age < 10 ? 0.015 : age < 40 ? 0.012 : age < 50 ? 0.025 : age < 60 ? 0.05 : age < 70 ? 0.1 : 0.22;
  return y / 12;
}

export interface NewChar {
  culture: number;
  female: boolean;
  age: number;
  dynasty: number;
  father?: number;
  mother?: number;
  realm: number;
}

/** Add trait t and its skill modifiers. Removes the opposite trait if present. */
export function addTrait(w: World, c: number, t: number): void {
  if (w.hasTrait(c, t)) return;
  const ct = w.content;
  const opp = ct.tOpposite[t];
  if (opp >= 0) removeTrait(w, c, opp);
  w.charTraits[c] |= 1 << t;
  applySkills(w, c, t, 1);
  w.charHealth[c] = clamp(w.charHealth[c] + ct.tHealth[t], 1, 100);
}

export function removeTrait(w: World, c: number, t: number): void {
  if (!w.hasTrait(c, t)) return;
  w.charTraits[c] &= ~(1 << t);
  applySkills(w, c, t, -1);
  w.charHealth[c] = clamp(w.charHealth[c] - w.content.tHealth[t], 1, 100);
}

function applySkills(w: World, c: number, t: number, sign: number): void {
  const s = w.content.tSkill;
  w.charMartial[c] = clamp(w.charMartial[c] + sign * s[t * 5], 0, 30);
  w.charDiplomacy[c] = clamp(w.charDiplomacy[c] + sign * s[t * 5 + 1], 0, 30);
  w.charStewardship[c] = clamp(w.charStewardship[c] + sign * s[t * 5 + 2], 0, 30);
  w.charIntrigue[c] = clamp(w.charIntrigue[c] + sign * s[t * 5 + 3], 0, 30);
  w.charLearning[c] = clamp(w.charLearning[c] + sign * s[t * 5 + 4], 0, 30);
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Create a character. May grow the character arrays: don't hold array references across this call. */
export function createChar(w: World, o: NewChar): number {
  w.ensureCharCapacity(1);
  const c = w.charCount++;
  const ct = w.content;
  const rng = w.rng;
  w.charAlive[c] = 1;
  w.charFemale[c] = o.female ? 1 : 0;
  w.charAge[c] = o.age;
  w.charBirthDay[c] = w.day - o.age * DAYS_PER_YEAR - rng.int(DAYS_PER_YEAR);
  w.charDeathDay[c] = 0;
  w.charFather[c] = o.father ?? NONE;
  w.charMother[c] = o.mother ?? NONE;
  w.charSpouse[c] = NONE;
  w.charRealm[c] = o.realm;
  w.charDynasty[c] = o.dynasty;
  w.charCulture[c] = o.culture;
  w.charHostage[c] = NONE;
  w.charRules[c] = NONE;
  w.charTraits[c] = 0;
  const pool = o.female ? ct.cultureFemale[o.culture] : ct.cultureMale[o.culture];
  w.charName[c] = pool[rng.int(pool.length)];
  w.charMartial[c] = 2 + rng.int(8);
  w.charDiplomacy[c] = 2 + rng.int(8);
  w.charStewardship[c] = 2 + rng.int(8);
  w.charIntrigue[c] = 2 + rng.int(8);
  w.charLearning[c] = 2 + rng.int(8);
  w.charHealth[c] = 65 + rng.int(30);
  w.deathCause[c] = '';

  // Personality: three traits, never two opposites.
  for (let tries = 0, n = 0; n < 3 && tries < 20; tries++) {
    const t = ct.personality[rng.int(ct.personality.length)];
    if (w.hasTrait(c, t)) continue;
    const opp = ct.tOpposite[t];
    if (opp >= 0 && w.hasTrait(c, opp)) continue;
    addTrait(w, c, t);
    n++;
  }
  // Congenital traits from parents, or rarely out of nowhere.
  for (let t = 0; t < ct.traits.length; t++) {
    if (ct.tKind[t] !== KIND_PHYSICAL) continue;
    let p = 0;
    if (ct.tInherit[t] > 0) {
      if (o.father !== undefined && o.father >= 0 && w.hasTrait(o.father, t)) p += ct.tInherit[t];
      if (o.mother !== undefined && o.mother >= 0 && w.hasTrait(o.mother, t)) p += ct.tInherit[t];
      p += 0.03;
    } else if (t === T.sickly) p = 0.02;
    if (p > 0 && rng.chance(p)) addTrait(w, c, t);
  }
  if (ct.cultureTags[o.culture] & TAG_SEAFARING && rng.chance(0.12)) addTrait(w, c, T.seafarer);
  if (o.age >= 16) educate(w, c);
  return c;
}

/** Pick an education based on the character's strongest skill. */
export function educate(w: World, c: number): void {
  const ct = w.content;
  for (const t of ct.education) if (w.hasTrait(c, t)) return;
  const sk = [w.charMartial[c], w.charDiplomacy[c], w.charStewardship[c], w.charIntrigue[c], w.charLearning[c]];
  let best = 0;
  for (let i = 1; i < 5; i++) if (sk[i] + w.rng.next() * 3 > sk[best]) best = i;
  addTrait(w, c, [T.warrior, T.envoy, T.steward, T.schemer, T.scribe][best]);
}

/** Trait ids resolved once from data (see initTraitIds). */
export const T = {
  brave: 0, craven: 0, ambitious: 0, content: 0, cruel: 0, kind: 0, greedy: 0, generous: 0, honest: 0, deceitful: 0,
  wrathful: 0, calm: 0, zealous: 0, cynical: 0, diligent: 0, lazy: 0, paranoid: 0, trusting: 0, proud: 0, humble: 0,
  warrior: 0, scribe: 0, schemer: 0, steward: 0, envoy: 0, strong: 0, frail: 0, clever: 0, dull: 0, sickly: 0, wounded: 0, seafarer: 0,
};

export function initTraitIds(w: World): void {
  for (const k of Object.keys(T) as (keyof typeof T)[]) T[k] = traitId(w.content, k);
}

/** Sum of an AI axis across a character's traits. */
export function aiAxis(w: World, c: number, axis: number): number {
  if (c < 0) return 0;
  const bits = w.charTraits[c];
  const ai = w.content.tAi;
  let s = 0;
  for (let t = 0; t < 32; t++) if (bits & (1 << t)) s += ai[t * 7 + axis];
  return s;
}

export function fertility(w: World, c: number): number {
  const bits = w.charTraits[c];
  const f = w.content.tFertility;
  let m = 1;
  for (let t = 0; t < 32; t++) if (bits & (1 << t)) m += f[t];
  return m < 0.05 ? 0.05 : m;
}

export function marry(w: World, a: number, b: number): void {
  const husband = w.charFemale[a] ? b : a;
  const wife = husband === a ? b : a;
  w.charSpouse[husband] = wife;
  w.charSpouse[wife] = husband;
  const ra = w.charRealm[husband], rb = w.charRealm[wife];
  // The spouse joins the court of whoever rules (or the husband's, by default).
  if (w.charRules[wife] >= 0 && w.charRules[husband] < 0) w.charRealm[husband] = rb;
  else w.charRealm[wife] = ra;
  if (ra >= 0 && rb >= 0 && ra !== rb && w.realmAlive[ra] && w.realmAlive[rb]) {
    w.married[ra * w.R + rb] = 1;
    w.married[rb * w.R + ra] = 1;
    w.addOpinionBoth(ra, rb, 20);
  }
}

export function killChar(w: World, c: number, cause: string): void {
  if (!w.charAlive[c]) return;
  w.charAlive[c] = 0;
  w.charDeathDay[c] = w.day;
  w.deathCause[c] = cause;
  const sp = w.charSpouse[c];
  if (sp >= 0) w.charSpouse[sp] = NONE;
  for (let p = 0; p < w.plotActive.length; p++) {
    if (w.plotActive[p] && (w.plotOwner[p] === c || w.plotTarget[p] === c)) w.plotActive[p] = 0;
  }
  for (let a = 0; a < w.armyActive.length; a++) if (w.armyActive[a] && w.armyLeader[a] === c) w.armyLeader[a] = NONE;
  const realm = w.charRealm[c];
  if (w.player !== NONE && realm >= 0 && w.top(realm) === w.top(w.player) && w.charDynasty[c] === w.playerDynasty) {
    w.addLog('family', `${w.charFullName(c)} has died (${cause}), aged ${w.charAge[c]}.`);
  }
  const r = w.charRules[c];
  if (r >= 0) {
    w.charRules[c] = NONE;
    onRulerDied(w, r, c);
  }
}

/** A lowborn spouse for a dynast who found no match among the great houses. */
function lowbornSpouse(w: World, c: number): number {
  const s = createChar(w, {
    culture: w.charCulture[c],
    female: !w.charFemale[c],
    age: Math.max(16, w.charAge[c] + (w.charFemale[c] ? 3 : -4) + w.rng.int(5) - 2),
    dynasty: NONE,
    realm: w.charRealm[c],
  });
  return s;
}

// Scratch buffers for marriage matching (reused every month, never reallocated mid-tick).
let eligF = new Int32Array(1024), eligM = new Int32Array(1024);
let nF = 0, nM = 0;
/** Living characters per realm court; large courts have fewer children. */
let court = new Uint16Array(0);

/** Rebuild the pools of unmarried adults. Called once a month. */
export function rebuildMarriagePools(w: World): void {
  nF = nM = 0;
  if (court.length !== w.R) court = new Uint16Array(w.R);
  court.fill(0);
  if (eligF.length < w.aliveCount) {
    eligF = new Int32Array(w.charCap);
    eligM = new Int32Array(w.charCap);
  }
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    const cr = w.charRealm[c];
    if (cr >= 0 && w.charAlive[c] && court[cr] < 65535) court[cr]++;
    if (!w.charAlive[c] || w.charSpouse[c] >= 0 || w.charAge[c] < 16 || w.charHostage[c] >= 0) continue;
    if (w.charFemale[c]) {
      if (w.charAge[c] <= 40) eligF[nF++] = c;
    } else if (w.charAge[c] <= 60) eligM[nM++] = c;
  }
}

function closeKin(w: World, a: number, b: number): boolean {
  const fa = w.charFather[a], fb = w.charFather[b];
  if (fa >= 0 && fa === fb) return true;
  if (fa === b || fb === a || w.charMother[a] === b || w.charMother[b] === a) return true;
  return false;
}

/** Character AI: the head of the family looks for a good match. */
function seekSpouse(w: World, c: number): void {
  const pool = w.charFemale[c] ? eligM : eligF;
  const n = w.charFemale[c] ? nM : nF;
  if (n === 0) return;
  const myRealm = w.charRealm[c];
  if (myRealm < 0) return;
  const myTop = w.top(myRealm);
  const ct = w.content;
  let best = -1, bestScore = 4;
  for (let k = 0; k < 14; k++) {
    const o = pool[w.rng.int(n)];
    if (!w.charAlive[o] || w.charSpouse[o] >= 0 || o === c) continue;
    if (w.charDynasty[o] >= 0 && w.charDynasty[o] === w.charDynasty[c]) continue;
    if (closeKin(w, c, o)) continue;
    const or = w.charRealm[o];
    if (or < 0 || !w.realmAlive[or]) continue;
    if (w.charRules[o] >= 0 && w.charRules[c] >= 0) continue; // two rulers would merge realms; keep it rare
    let s = 0;
    if (or === myRealm) s += 3;
    else {
      const dist = w.map.hopDays[w.realmCapital[w.top(or)] * w.P + w.realmCapital[myTop]];
      if (dist > 60) continue;
      s += 6 - dist / 12;
      s += w.getOpinion(myTop, w.top(or)) / 20;
      if (w.isHostile(myTop, or)) continue;
    }
    if (ct.cultureGroup[w.charCulture[o]] === ct.cultureGroup[w.charCulture[c]]) s += 2;
    if (w.charDynasty[o] >= 0) s += 2;
    // Rulers' families prefer other rulers' families.
    const oFamRuler = w.charRules[o] >= 0 || (w.charFather[o] >= 0 && w.charRules[w.charFather[o]] >= 0);
    if (oFamRuler) s += 3;
    const ageGap = Math.abs(w.charAge[o] - w.charAge[c]);
    s -= ageGap / 5;
    s += w.rng.next() * 2;
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  if (best >= 0) {
    marry(w, c, best);
    const r1 = w.charRealm[c];
    if (w.concernsPlayer(r1) && w.charDynasty[c] === w.playerDynasty) {
      w.addLog('family', `${w.charFullName(c)} has married ${w.charFullName(best)}.`);
    }
  } else if (w.rng.chance(0.25)) {
    const s = lowbornSpouse(w, c);
    marry(w, c, s);
  }
}

function birth(w: World, mother: number): void {
  const father = w.charSpouse[mother];
  if (father < 0) return;
  const dyn = w.charDynasty[father] >= 0 && !(w.charRules[mother] >= 0 && w.charRules[father] < 0) ? w.charDynasty[father] : w.charDynasty[mother];
  const realm = w.charRealm[mother];
  const culture = w.charRules[mother] >= 0 ? w.charCulture[mother] : w.charCulture[father];
  const child = createChar(w, { culture, female: w.rng.chance(0.5), age: 0, dynasty: dyn, father, mother, realm });
  w.charBirthDay[child] = w.day;
  if (w.rng.chance(0.02)) {
    killChar(w, mother, 'childbirth');
  }
  if (w.player !== NONE && dyn === w.playerDynasty && realm >= 0 && w.top(realm) === w.top(w.player)) {
    w.addLog('family', `${w.charShortName(mother)} has given birth to a ${w.charFemale[child] ? 'daughter' : 'son'}, ${w.charShortName(child)}.`);
    const ruler = w.realmRuler[w.player];
    if (father === ruler || mother === ruler) fireTrigger(w, 'on_birth', w.player, NONE, child);
  }
}

/** Monthly update for one character (staggered so ~1/30 of characters run each day). */
export function charMonthly(w: World, c: number): void {
  if (!w.charAlive[c]) return;
  const age = w.charAge[c];
  const health = w.charHealth[c];
  let p = monthlyDeath(age);
  if (health < 40) p *= 2;
  else if (health > 85) p *= 0.7;
  if (w.rng.chance(p)) {
    killChar(w, c, age < 5 ? 'childhood fever' : age > 55 ? 'old age' : w.rng.pick(['fever', 'a hunting accident', 'a wasting sickness', 'bad water', 'a fall']));
    return;
  }
  if (age >= 16 && !hasEducation(w, c)) educate(w, c);

  if (w.charFemale[c]) {
    const sp = w.charSpouse[c];
    if (sp >= 0 && w.charAlive[sp] && age >= 16 && age <= 45 && w.charHostage[c] < 0 && w.charHostage[sp] < 0) {
      let f = 0.024 * fertility(w, c) * fertility(w, sp);
      if (age > 35) f *= 0.5;
      if (w.charDynasty[c] < 0 && w.charDynasty[sp] < 0) f *= 0.3; // lowborn couples stay off-screen
      const size = w.charRealm[c] >= 0 && court.length ? court[w.charRealm[c]] : 0;
      if (size > 18) f *= Math.max(0.05, 1 - (size - 18) / 14);
      // The ruling couple always tries for heirs.
      if (w.charRules[sp] >= 0 || w.charRules[c] >= 0) f = Math.max(f, 0.02);
      if (w.rng.chance(f)) birth(w, c);
    }
  }
  if (w.charSpouse[c] < 0 && age >= 16 && w.charDynasty[c] >= 0 && w.charHostage[c] < 0) {
    const realm = w.charRealm[c];
    // The player arranges their own ruler's match.
    const isPlayerRuler = w.player !== NONE && w.realmRuler[w.player] === c;
    if (!isPlayerRuler && realm >= 0 && w.rng.chance(w.charRules[c] >= 0 ? 0.25 : 0.1)) seekSpouse(w, c);
  }
}

function hasEducation(w: World, c: number): boolean {
  const ct = w.content;
  for (const t of ct.education) if (w.hasTrait(c, t)) return true;
  return false;
}

export function yearlyAging(w: World): void {
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (w.charAlive[c] && w.charAge[c] < 255) w.charAge[c]++;
    // Old age wears health down.
    if (w.charAge[c] > 50 && w.rng.chance(0.3)) w.charHealth[c] = Math.max(1, w.charHealth[c] - 3);
  }
}

/** Generate a ruling family for a realm at scenario start. */
export function generateFamily(w: World, realm: number, culture: number, dynasty: number): number {
  const rng = w.rng;
  const female = rng.chance(0.05);
  const ruler = createChar(w, { culture, female, age: 22 + rng.int(36), dynasty, realm });
  if (rng.chance(0.85)) {
    const sp = createChar(w, { culture, female: !female, age: Math.max(16, w.charAge[ruler] - 3 + rng.int(8) - 4), dynasty: NONE, realm });
    marry(w, ruler, sp);
    const mother = female ? ruler : sp;
    const father = female ? sp : ruler;
    const maxKids = Math.max(0, Math.min(5, Math.floor((w.charAge[mother] - 17) / 4)));
    const kids = rng.int(maxKids + 1);
    for (let k = 0; k < kids; k++) {
      const age = Math.max(0, w.charAge[mother] - 17 - rng.int(Math.max(1, w.charAge[mother] - 17)));
      createChar(w, { culture, female: rng.chance(0.5), age: Math.min(age, 25), dynasty, father, mother, realm });
    }
  }
  if (rng.chance(0.4)) {
    const bro = createChar(w, { culture, female: false, age: Math.max(16, w.charAge[ruler] - 2 - rng.int(8)), dynasty, realm });
    if (rng.chance(0.6)) marry(w, bro, createChar(w, { culture, female: true, age: Math.max(16, w.charAge[bro] - 3), dynasty: NONE, realm }));
  }
  return ruler;
}

export function lawName(l: number): string {
  return l === Law.Primogeniture ? 'Eldest son' : l === Law.Elective ? 'Elective' : 'Tribal choice';
}

