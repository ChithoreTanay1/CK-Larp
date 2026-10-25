import type { MapData } from './mapgen';
import type { ScenarioData } from './types';
import type { Content } from './content';
import { PRESSURE_KEYS } from './types';
import { Rng } from './rng';

export const NONE = -1;

/** Capacities for fixed-size tables. Realm slots are recycled when a realm dies. */
export const REALM_CAP = 256;
export const WAR_CAP = 64;
export const ARMY_CAP = 256;
export const PLOT_CAP = 128;

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export const enum Law {
  Primogeniture = 0,
  Elective = 1,
  Tribal = 2,
}

export const enum Goal {
  Consolidate = 0,
  Expand = 1,
  Defend = 2,
  Recover = 3,
}

export const enum ArmyKind {
  Host = 0,
  Raid = 1,
  SeaBand = 2,
}

export const enum WarKind {
  Conquest = 0,
  Subjugation = 1,
  Independence = 2,
  /** Peasant/soldier revolt: crushed rebels are absorbed. */
  Revolt = 3,
}

export const enum PlotKind {
  Murder = 0,
  Usurp = 1,
}

export const P_DROUGHT = 0, P_FAMINE = 1, P_RAIDER = 2, P_TRADE = 3, P_IRON = 4, P_LEGIT = 5;
export const PRESSURE_COUNT = PRESSURE_KEYS.length;

export type LogKind = 'info' | 'good' | 'bad' | 'war' | 'family' | 'world';
export interface LogEntry {
  day: number;
  kind: LogKind;
  text: string;
  /** Optional province to focus when clicked. */
  prov?: number;
}

export interface ChoiceOption {
  label: string;
  tooltip?: string;
}

/** Something waiting for the player: an event or an AI proposal. */
export interface PendingChoice {
  uid: number;
  kind: 'event' | 'proposal';
  title: string;
  text: string;
  options: ChoiceOption[];
  /** Event index, or proposal payload. */
  eventIdx?: number;
  ctx?: EventScope;
  proposal?: { type: 'marriage' | 'alliance' | 'vassal' | 'hostage' | 'peace'; from: number; a?: number; b?: number; war?: number };
}

export interface EventScope {
  realm: number;
  ruler: number;
  province: number;
  region: number;
  /** The other party for trigger events (enemy realm, raider realm, newborn char...). */
  other: number;
  char: number;
}

/** Growable typed arrays for characters. */
function grow<T extends Int32Array | Uint8Array | Uint32Array | Float32Array | Uint16Array>(a: T, n: number): T {
  const b = new (a.constructor as new (n: number) => T)(n);
  b.set(a);
  return b;
}

/**
 * The whole simulation state, stored as flat typed arrays (struct-of-arrays) keyed
 * by integer ids. Strings live in lookup tables. This keeps ticks GC-free and lets
 * saves serialize the arrays directly.
 */
export class World {
  readonly scenario: ScenarioData;
  readonly map: MapData;
  readonly content: Content;
  readonly P: number;
  readonly R: number;

  rng: Rng;
  seed: number;
  day = 0;
  player = NONE;
  playerDynasty = NONE;
  gameOver = '';
  nextUid = 1;

  // ---- Provinces ----
  provOwner: Int32Array;
  provOccupier: Int32Array;
  provRegion: Uint8Array;
  provTerrain: Uint8Array;
  provPop: Float32Array;
  provDevelop: Uint8Array;
  /** Months of devastation left after a raid or siege. */
  provRaided: Uint8Array;
  provOre: Uint8Array;
  provTrade: Uint8Array;
  /** Last month's output, used by the UI and event conditions. */
  provGrainOut: Float32Array;
  provCattleOut: Float32Array;
  provUnrest: Float32Array;

  // ---- Realms ----
  realmAlive: Uint8Array;
  realmRuler: Int32Array;
  realmLiege: Int32Array;
  realmCulture: Uint8Array;
  realmCapital: Int32Array;
  realmLaw: Uint8Array;
  realmColor: Uint32Array;
  /** 1 for landless raider bands such as the Sea Peoples. */
  realmLandless: Uint8Array;
  realmGrain: Float32Array;
  realmCattle: Float32Array;
  realmMetal: Float32Array;
  realmTrade: Float32Array;
  realmPrestige: Float32Array;
  realmStability: Float32Array;
  /** Vassal loyalty to its liege, 0-100. */
  realmLoyalty: Float32Array;
  realmAiGoal: Uint8Array;
  realmAiOffset: Uint16Array;
  realmRaidReady: Int32Array;
  realmArmy: Int32Array;
  realmProvCount: Int32Array;
  realmLevy: Float32Array;
  /** Fraction of the levy available (drops with casualties, recovers monthly). */
  realmManpower: Float32Array;
  realmIncome: Float32Array;
  realmFounded: Int32Array;
  realmName: string[];
  /** Pairwise tables (REALM_CAP^2). */
  opinion: Int8Array;
  allied: Uint8Array;
  truceUntil: Int32Array;
  hostile: Uint8Array;
  married: Uint8Array;

  // ---- Characters (growable) ----
  charCap = 0;
  charCount = 0;
  charAlive!: Uint8Array;
  charFemale!: Uint8Array;
  charAge!: Uint8Array;
  charHealth!: Uint8Array;
  charTraits!: Uint32Array;
  charFather!: Int32Array;
  charMother!: Int32Array;
  charSpouse!: Int32Array;
  charRealm!: Int32Array;
  charDynasty!: Int32Array;
  charName!: Int32Array;
  charMartial!: Uint8Array;
  charDiplomacy!: Uint8Array;
  charStewardship!: Uint8Array;
  charIntrigue!: Uint8Array;
  charLearning!: Uint8Array;
  charBirthDay!: Int32Array;
  charDeathDay!: Int32Array;
  charHostage!: Int32Array;
  charRules!: Int32Array;
  charCulture!: Uint8Array;
  /** Alive character ids, rebuilt monthly so per-character loops skip the dead. */
  aliveChars = new Int32Array(1024);
  aliveCount = 0;

  nameTable: string[] = [];
  nameIndex = new Map<string, number>();
  dynName: string[] = [];
  dynCulture: number[] = [];
  deathCause: string[] = [];

  // ---- Wars ----
  warActive = new Uint8Array(WAR_CAP);
  warAttacker = new Int32Array(WAR_CAP);
  warDefender = new Int32Array(WAR_CAP);
  warTarget = new Int32Array(WAR_CAP);
  warKind = new Uint8Array(WAR_CAP);
  warScore = new Float32Array(WAR_CAP);
  /** Accumulated score from battles; occupation score is added on top each day. */
  warBattle = new Float32Array(WAR_CAP);
  warStart = new Int32Array(WAR_CAP);
  /** warSide[w * R + realm]: 1 attacker side, 2 defender side, 0 not involved. */
  warSide: Int8Array;

  // ---- Armies ----
  armyActive = new Uint8Array(ARMY_CAP);
  armyRealm = new Int32Array(ARMY_CAP);
  armyKind = new Uint8Array(ARMY_CAP);
  armyLoc = new Int32Array(ARMY_CAP);
  armyNext = new Int32Array(ARMY_CAP);
  armyDest = new Int32Array(ARMY_CAP);
  armyProgress = new Float32Array(ARMY_CAP);
  armyLegDays = new Float32Array(ARMY_CAP);
  armyMen = new Float32Array(ARMY_CAP);
  armyMorale = new Float32Array(ARMY_CAP);
  armyQuality = new Float32Array(ARMY_CAP);
  armySiege = new Float32Array(ARMY_CAP);
  armyTargetRealm = new Int32Array(ARMY_CAP);
  armyLootGrain = new Float32Array(ARMY_CAP);
  armyLootCattle = new Float32Array(ARMY_CAP);
  armyLootMetal = new Float32Array(ARMY_CAP);
  armyLootTrade = new Float32Array(ARMY_CAP);
  armyHome = new Int32Array(ARMY_CAP);
  armyLeader = new Int32Array(ARMY_CAP);
  armyManual = new Uint8Array(ARMY_CAP);
  armyRaids = new Uint8Array(ARMY_CAP);

  // ---- Plots ----
  plotActive = new Uint8Array(PLOT_CAP);
  plotOwner = new Int32Array(PLOT_CAP);
  plotTarget = new Int32Array(PLOT_CAP);
  plotKind = new Uint8Array(PLOT_CAP);
  plotProgress = new Float32Array(PLOT_CAP);
  plotSecrecy = new Float32Array(PLOT_CAP);

  // ---- Pressure (regions x PRESSURE_COUNT) ----
  regionCount: number;
  pressure: Float32Array;
  regionDetail: Uint8Array;
  /** Count of raids per region this month, feeding raider pressure / trade health. */
  regionRaids: Uint16Array;

  // ---- Events ----
  /** key eventIdx * REALM_CAP + realm -> day the event may fire again. */
  eventCooldown = new Map<number, number>();
  playerQueue: PendingChoice[] = [];

  // ---- Outbox for the UI (drained by the worker) ----
  log: LogEntry[] = [];
  dirtyProv: Uint8Array;
  realmsDirty = true;

  constructor(scenario: ScenarioData, map: MapData, content: Content, seed: number) {
    this.scenario = scenario;
    this.map = map;
    this.content = content;
    this.nameTable = content.names.slice();
    content.names.forEach((n, i) => this.nameIndex.set(n, i));
    this.seed = seed;
    this.rng = new Rng(seed);
    const P = (this.P = map.provinceCount);
    const R = (this.R = REALM_CAP);

    this.provOwner = new Int32Array(P).fill(NONE);
    this.provOccupier = new Int32Array(P).fill(NONE);
    this.provRegion = new Uint8Array(P);
    this.provTerrain = new Uint8Array(P);
    this.provPop = new Float32Array(P);
    this.provDevelop = new Uint8Array(P);
    this.provRaided = new Uint8Array(P);
    this.provOre = new Uint8Array(P);
    this.provTrade = new Uint8Array(P);
    this.provGrainOut = new Float32Array(P);
    this.provCattleOut = new Float32Array(P);
    this.provUnrest = new Float32Array(P);
    this.dirtyProv = new Uint8Array(P);

    this.realmAlive = new Uint8Array(R);
    this.realmRuler = new Int32Array(R).fill(NONE);
    this.realmLiege = new Int32Array(R).fill(NONE);
    this.realmCulture = new Uint8Array(R);
    this.realmCapital = new Int32Array(R).fill(NONE);
    this.realmLaw = new Uint8Array(R);
    this.realmColor = new Uint32Array(R);
    this.realmLandless = new Uint8Array(R);
    this.realmGrain = new Float32Array(R);
    this.realmCattle = new Float32Array(R);
    this.realmMetal = new Float32Array(R);
    this.realmTrade = new Float32Array(R);
    this.realmPrestige = new Float32Array(R);
    this.realmStability = new Float32Array(R);
    this.realmLoyalty = new Float32Array(R);
    this.realmAiGoal = new Uint8Array(R);
    this.realmAiOffset = new Uint16Array(R);
    this.realmRaidReady = new Int32Array(R);
    this.realmArmy = new Int32Array(R).fill(NONE);
    this.realmProvCount = new Int32Array(R);
    this.realmLevy = new Float32Array(R);
    this.realmManpower = new Float32Array(R);
    this.realmIncome = new Float32Array(R);
    this.realmFounded = new Int32Array(R);
    this.realmName = new Array<string>(R).fill('');
    this.opinion = new Int8Array(R * R);
    this.allied = new Uint8Array(R * R);
    this.truceUntil = new Int32Array(R * R);
    this.hostile = new Uint8Array(R * R);
    this.married = new Uint8Array(R * R);
    this.warSide = new Int8Array(WAR_CAP * R);

    this.regionCount = scenario.regions.length;
    this.pressure = new Float32Array(this.regionCount * PRESSURE_COUNT);
    this.regionDetail = new Uint8Array(this.regionCount);
    this.regionRaids = new Uint16Array(this.regionCount);

    this.armyRealm.fill(NONE);
    this.ensureCharCapacity(2048);
  }

  // ---------- helpers ----------

  get month(): number {
    return Math.floor(this.day / DAYS_PER_MONTH);
  }

  get year(): number {
    return Math.floor(this.day / DAYS_PER_YEAR);
  }

  /** Current calendar year in BCE. */
  get yearBce(): number {
    return this.scenario.startYear - this.year;
  }

  p(region: number, key: number): number {
    return this.pressure[region * PRESSURE_COUNT + key];
  }

  setP(region: number, key: number, v: number): void {
    this.pressure[region * PRESSURE_COUNT + key] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** Walk up the liege chain to the independent realm. */
  top(r: number): number {
    let guard = 0;
    while (this.realmLiege[r] !== NONE && guard++ < 16) r = this.realmLiege[r];
    return r;
  }

  realmRegion(r: number): number {
    const c = this.realmCapital[r];
    return c >= 0 ? this.provRegion[c] : 0;
  }

  isFullDetail(r: number): boolean {
    return this.regionDetail[this.realmRegion(r)] === 1;
  }

  getOpinion(a: number, b: number): number {
    return this.opinion[a * this.R + b];
  }

  addOpinion(a: number, b: number, v: number): void {
    const i = a * this.R + b;
    const n = this.opinion[i] + v;
    this.opinion[i] = n > 100 ? 100 : n < -100 ? -100 : n;
  }

  addOpinionBoth(a: number, b: number, v: number): void {
    this.addOpinion(a, b, v);
    this.addOpinion(b, a, v);
  }

  isHostile(a: number, b: number): boolean {
    return this.hostile[this.top(a) * this.R + this.top(b)] === 1;
  }

  isAllied(a: number, b: number): boolean {
    return this.allied[a * this.R + b] === 1;
  }

  setAllied(a: number, b: number, v: boolean): void {
    this.allied[a * this.R + b] = v ? 1 : 0;
    this.allied[b * this.R + a] = v ? 1 : 0;
  }

  hasTruce(a: number, b: number): boolean {
    return this.truceUntil[a * this.R + b] > this.day;
  }

  setTruce(a: number, b: number, days: number): void {
    this.truceUntil[a * this.R + b] = this.day + days;
    this.truceUntil[b * this.R + a] = this.day + days;
  }

  hasTrait(c: number, t: number): boolean {
    return (this.charTraits[c] & (1 << t)) !== 0;
  }

  charFullName(c: number): string {
    if (c < 0) return 'nobody';
    const d = this.charDynasty[c];
    return d >= 0 ? `${this.nameTable[this.charName[c]]} of ${this.dynName[d]}` : this.nameTable[this.charName[c]];
  }

  charShortName(c: number): string {
    return c < 0 ? 'nobody' : this.nameTable[this.charName[c]];
  }

  internName(n: string): number {
    let i = this.nameIndex.get(n);
    if (i === undefined) {
      i = this.nameTable.length;
      this.nameTable.push(n);
      this.nameIndex.set(n, i);
    }
    return i;
  }

  addLog(kind: LogKind, text: string, prov?: number): void {
    this.log.push({ day: this.day, kind, text, prov });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  /** Is realm r the player, or a vassal/liege the player cares about? */
  concernsPlayer(r: number): boolean {
    return this.player !== NONE && (r === this.player || this.top(r) === this.top(this.player));
  }

  ensureCharCapacity(extra: number): void {
    const need = this.charCount + extra;
    if (need <= this.charCap) return;
    let cap = Math.max(1024, this.charCap);
    while (cap < need) cap *= 2;
    if (this.charCap === 0) {
      this.charAlive = new Uint8Array(cap);
      this.charFemale = new Uint8Array(cap);
      this.charAge = new Uint8Array(cap);
      this.charHealth = new Uint8Array(cap);
      this.charTraits = new Uint32Array(cap);
      this.charFather = new Int32Array(cap);
      this.charMother = new Int32Array(cap);
      this.charSpouse = new Int32Array(cap);
      this.charRealm = new Int32Array(cap);
      this.charDynasty = new Int32Array(cap);
      this.charName = new Int32Array(cap);
      this.charMartial = new Uint8Array(cap);
      this.charDiplomacy = new Uint8Array(cap);
      this.charStewardship = new Uint8Array(cap);
      this.charIntrigue = new Uint8Array(cap);
      this.charLearning = new Uint8Array(cap);
      this.charBirthDay = new Int32Array(cap);
      this.charDeathDay = new Int32Array(cap);
      this.charHostage = new Int32Array(cap);
      this.charRules = new Int32Array(cap);
      this.charCulture = new Uint8Array(cap);
    } else {
      this.charAlive = grow(this.charAlive, cap);
      this.charFemale = grow(this.charFemale, cap);
      this.charAge = grow(this.charAge, cap);
      this.charHealth = grow(this.charHealth, cap);
      this.charTraits = grow(this.charTraits, cap);
      this.charFather = grow(this.charFather, cap);
      this.charMother = grow(this.charMother, cap);
      this.charSpouse = grow(this.charSpouse, cap);
      this.charRealm = grow(this.charRealm, cap);
      this.charDynasty = grow(this.charDynasty, cap);
      this.charName = grow(this.charName, cap);
      this.charMartial = grow(this.charMartial, cap);
      this.charDiplomacy = grow(this.charDiplomacy, cap);
      this.charStewardship = grow(this.charStewardship, cap);
      this.charIntrigue = grow(this.charIntrigue, cap);
      this.charLearning = grow(this.charLearning, cap);
      this.charBirthDay = grow(this.charBirthDay, cap);
      this.charDeathDay = grow(this.charDeathDay, cap);
      this.charHostage = grow(this.charHostage, cap);
      this.charRules = grow(this.charRules, cap);
      this.charCulture = grow(this.charCulture, cap);
    }
    if (this.aliveChars.length < cap) this.aliveChars = new Int32Array(cap);
    this.charCap = cap;
  }

  rebuildAlive(): void {
    let n = 0;
    for (let c = 0; c < this.charCount; c++) if (this.charAlive[c]) this.aliveChars[n++] = c;
    this.aliveCount = n;
  }

  recountProvinces(): void {
    this.realmProvCount.fill(0);
    for (let p = 0; p < this.P; p++) {
      const o = this.provOwner[p];
      if (o >= 0) this.realmProvCount[o]++;
    }
  }

  markProv(p: number): void {
    this.dirtyProv[p] = 1;
  }
}
