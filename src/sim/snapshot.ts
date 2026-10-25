import { World, NONE, WAR_CAP, ARMY_CAP, BATTLE_CAP, PLOT_CAP, LogEntry, PendingChoice, BattleReport, DAYS_PER_MONTH, MONTHS_PER_YEAR, DAYS_PER_YEAR } from './world';
import { maaCap, maaRegiments, maaFielded, maaHireCost, maaPay, maaExpandCost } from './systems/maa';
import { findHeir } from './systems/succession';
import { strength } from './systems/realms';
import { warName, atWar } from './systems/war';
import { evaluate } from './systems/diplomacy';
import { plotName } from './systems/plots';
import { lawName } from './systems/characters';
import { TERRAINS } from './types';
import type { TickStats } from './tick';
import { UNIT_COUNT } from './units';
import { armyPace, armyPower, availableLevy, availableRetinue, retinueCap, fieldedMen, siegeNeed, siegeMinMen, garrison, fortCost, siegeStatus, tierOf, ANNEX_DAYS } from './systems/military';

/** Sim -> UI data shapes. The UI only ever sees these plain objects. */

export interface CharBrief {
  id: number;
  name: string;
  age: number;
  female: boolean;
  alive: boolean;
  rules: number;
}

export interface RealmInfo {
  id: number;
  name: string;
  color: number;
  liege: number;
  capital: number;
  culture: number;
  landless: boolean;
  provinces: number;
  rulerName: string;
}

export interface ArmyInfo {
  id: number;
  realm: number;
  kind: number;
  loc: number;
  next: number;
  progress: number;
  men: number;
  dest: number;
  manual: boolean;
  sieging: boolean;
  /** Men per troop type (spear, bow, sling, heavy, chariot). */
  units: number[];
  /** Of those, men-at-arms per type. */
  maa: number[];
  /** Index of the largest troop type, for the map marker. */
  main: number;
  /** Battle the army is fighting in, or -1. */
  battle: number;
  /** Beaten and falling back. */
  routed: boolean;
}

/** Full detail of one of the player's armies. */
export interface ArmyDetail extends ArmyInfo {
  locName: string;
  destName: string;
  /** Provinces still to cross, in order. */
  route: number[];
  daysLeft: number;
  power: number;
  morale: number;
  quality: number;
  pace: number;
  siege: number;
  leader: CharBrief | null;
  leaderMartial: number;
  inOwnLand: boolean;
  /** Siege: why no progress ('' if progressing), days to go, storm odds. */
  siegeBlock: string;
  siegeDays: number;
  fort: number;
  /** Rough odds of a successful assault right now, 0-1. */
  assaultOdds: number;
  /** Our other armies standing in the same province (merge candidates). */
  mergeable: { id: number; men: number }[];
}

export interface WarInfo {
  id: number;
  name: string;
  attacker: number;
  defender: number;
  score: number;
  target: number;
  /** Player's side: 1 attacker, 2 defender, 0 not involved. */
  side: number;
  leader: boolean;
  months: number;
}

export interface PlayerInfo {
  realm: number;
  realmName: string;
  dynasty: string;
  ruler: CharBrief;
  heir: CharBrief | null;
  grain: number;
  cattle: number;
  metal: number;
  trade: number;
  prestige: number;
  stability: number;
  manpower: number;
  levy: number;
  liege: number;
  loyalty: number;
  vassals: { id: number; name: string; loyalty: number }[];
  allies: number[];
  army: number;
  /** All of our field armies. */
  armies: number[];
  fielded: number;
  availableLevy: number;
  /** Room left for paid professionals, and the cap. */
  availableRetinue: number;
  retinueCap: number;
  /** Adults at court who could lead an army. */
  commanders: { id: number; name: string; martial: number; leads: number }[];
  /** Men-at-arms, per troop type. */
  maa: { regiments: number; ready: number; fielded: number; cost: { metal: number; trade: number; cattle: number }; pay: number }[];
  maaUsed: number;
  maaCap: number;
  maaExpand: { trade: number; prestige: number };
  raidReadyMonths: number;
  plots: { id: number; target: string; kind: string; progress: number; secrecy: number }[];
  hostages: CharBrief[];
  region: number;
}

export interface Update {
  day: number;
  date: string;
  yearBce: number;
  provChanges?: { ids: number[]; owner: number[]; occupier: number[]; develop: number[]; fort: number[] };
  /** Selected game speed (0 paused). Time stops anyway while a choice is waiting. */
  speed: number;
  realms?: RealmInfo[];
  armies: ArmyInfo[];
  battles: BattleInfo[];
  sieges: SiegeInfo[];
  /** Occupied provinces and how long they have been held. */
  holds: { loc: number; occupier: number; days: number }[];
  annexDays: number;
  /** Our battles that just ended. */
  battleReports: BattleReport[];
  wars: WarInfo[];
  player: PlayerInfo | null;
  log: LogEntry[];
  choice: PendingChoice | null;
  queued: number;
  pressure: number[];
  regionDetail: number[];
  gameOver: string;
  stats: SimStats;
}

export interface SimStats extends TickStats {
  chars: number;
  charsTotal: number;
  realms: number;
  armies: number;
  wars: number;
  speed: number;
  daysPerSec: number;
}

const MONTHS = ['Thaw', 'Sowing', 'Blossom', 'Harvest', 'Threshing', 'High Sun', 'Dust', 'Vintage', 'First Rain', 'Ploughing', 'Long Night', 'Frost'];

export function dateLabel(w: World): string {
  const m = Math.floor(w.day / DAYS_PER_MONTH) % MONTHS_PER_YEAR;
  return `${(w.day % DAYS_PER_MONTH) + 1} ${MONTHS[m]}, ${w.yearBce} BCE`;
}

export function brief(w: World, c: number): CharBrief {
  return { id: c, name: w.charFullName(c), age: w.charAge[c], female: w.charFemale[c] === 1, alive: w.charAlive[c] === 1, rules: w.charRules[c] };
}

export function realmInfos(w: World): RealmInfo[] {
  const out: RealmInfo[] = [];
  for (let r = 0; r < w.R; r++) {
    if (!w.realmAlive[r]) continue;
    out.push({
      id: r,
      name: w.realmName[r],
      color: w.realmColor[r],
      liege: w.realmLiege[r],
      capital: w.realmCapital[r],
      culture: w.realmCulture[r],
      landless: w.realmLandless[r] === 1,
      provinces: w.realmProvCount[r],
      rulerName: w.realmRuler[r] >= 0 ? w.charFullName(w.realmRuler[r]) : '',
    });
  }
  return out;
}

export function warInfos(w: World): WarInfo[] {
  const out: WarInfo[] = [];
  const pt = w.player !== NONE ? w.top(w.player) : NONE;
  for (let war = 0; war < WAR_CAP; war++) {
    if (!w.warActive[war]) continue;
    out.push({
      id: war,
      name: warName(w, war),
      attacker: w.warAttacker[war],
      defender: w.warDefender[war],
      score: w.warScore[war],
      target: w.warTarget[war],
      side: pt >= 0 ? w.warSide[war * w.R + pt] : 0,
      leader: w.warAttacker[war] === pt || w.warDefender[war] === pt,
      months: Math.floor((w.day - w.warStart[war]) / DAYS_PER_MONTH),
    });
  }
  return out;
}

function unitsOf(w: World, a: number): number[] {
  const out: number[] = [];
  for (let u = 0; u < UNIT_COUNT; u++) out.push(Math.round(w.armyUnits[a * UNIT_COUNT + u]));
  return out;
}

function mainUnit(w: World, a: number): number {
  let best = 0;
  for (let u = 1; u < UNIT_COUNT; u++) if (w.armyUnits[a * UNIT_COUNT + u] > w.armyUnits[a * UNIT_COUNT + best]) best = u;
  // Chariots mark the army even as a minority: they are what the enemy sees coming.
  if (w.armyUnits[a * UNIT_COUNT + 4] > w.armyMen[a] * 0.12) best = 4;
  return best;
}

export interface BattleSide {
  army: number;
  realm: number;
  realmName: string;
  men: number;
  startMen: number;
  lost: number;
  morale: number;
  leader: string;
  units: number[];
}

export interface BattleInfo {
  id: number;
  loc: number;
  locName: string;
  day: number;
  /** Attacker's share of the fighting on the last day (0-1). */
  share: number;
  att: BattleSide;
  def: BattleSide;
  /** Player's side: 1 attacker, 2 defender, 0 not involved. */
  playerSide: number;
}

export interface SiegeInfo {
  army: number;
  realm: number;
  loc: number;
  locName: string;
  tier: number;
  fort: number;
  men: number;
  garrison: number;
  progress: number;
  days: number;
  odds: number;
  /** Why the siege makes no progress, or ''. */
  block: string;
  /** Player's side: 1 besieging, 2 besieged, 0 not involved. */
  playerSide: number;
}

export function siegeInfos(w: World): SiegeInfo[] {
  const out: SiegeInfo[] = [];
  const pt = w.player !== NONE ? w.top(w.player) : NONE;
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyKind[a] !== 0 || w.armyNext[a] >= 0 || w.armyBattle[a] >= 0) continue;
    const loc = w.armyLoc[a];
    const o = w.provOwner[loc];
    if (o < 0) continue;
    const st = siegeStatus(w, a);
    // Only real sieges: progress made, or an army able to start one.
    if (st.block && !w.armySiege[a]) continue;
    if (st.block === 'already taken' || st.block === 'not at war with the owner') continue;
    out.push({
      army: a,
      realm: w.armyRealm[a],
      loc,
      locName: w.scenario.provinces[loc].name,
      tier: tierOf(w, loc),
      fort: w.provFort[loc],
      men: Math.round(w.armyMen[a]),
      garrison: Math.round(garrison(w, loc)),
      progress: st.progress,
      days: st.days,
      odds: st.odds,
      block: st.block,
      playerSide: w.top(w.armyRealm[a]) === pt ? 1 : w.top(o) === pt ? 2 : 0,
    });
  }
  return out;
}

function holdInfos(w: World): { loc: number; occupier: number; days: number }[] {
  const out: { loc: number; occupier: number; days: number }[] = [];
  for (let p = 0; p < w.P; p++) if (w.provOccupier[p] >= 0) out.push({ loc: p, occupier: w.provOccupier[p], days: w.provOccDays[p] });
  return out;
}

function flushReports(w: World): BattleReport[] {
  const r = w.battleReports;
  w.battleReports = [];
  return r;
}

function battleSide(w: World, a: number, start: number, lost: number): BattleSide {
  const l = w.armyLeader[a];
  return {
    army: a,
    realm: w.armyRealm[a],
    realmName: w.realmName[w.armyRealm[a]],
    men: Math.round(w.armyMen[a]),
    startMen: Math.round(start),
    lost: Math.round(lost),
    morale: w.armyMorale[a],
    leader: l >= 0 && w.charAlive[l] ? w.charFullName(l) : '',
    units: unitsOf(w, a),
  };
}

export function battleInfos(w: World): BattleInfo[] {
  const out: BattleInfo[] = [];
  const pt = w.player !== NONE ? w.top(w.player) : NONE;
  for (let bt = 0; bt < BATTLE_CAP; bt++) {
    if (!w.battleActive[bt]) continue;
    const a = w.battleAtt[bt], b = w.battleDef[bt];
    out.push({
      id: bt,
      loc: w.battleLoc[bt],
      locName: w.scenario.provinces[w.battleLoc[bt]].name,
      day: w.battleDay[bt],
      share: w.battleShare[bt],
      att: battleSide(w, a, w.battleAttStart[bt], w.battleAttLoss[bt]),
      def: battleSide(w, b, w.battleDefStart[bt], w.battleDefLoss[bt]),
      playerSide: w.top(w.armyRealm[a]) === pt ? 1 : w.top(w.armyRealm[b]) === pt ? 2 : 0,
    });
  }
  return out;
}

export function armyInfos(w: World): ArmyInfo[] {
  const out: ArmyInfo[] = [];
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a]) continue;
    out.push({
      id: a,
      realm: w.armyRealm[a],
      kind: w.armyKind[a],
      loc: w.armyLoc[a],
      next: w.armyNext[a],
      progress: w.armyNext[a] >= 0 && w.armyLegDays[a] > 0 ? w.armyProgress[a] / w.armyLegDays[a] : 0,
      men: Math.round(w.armyMen[a]),
      dest: w.armyDest[a],
      manual: w.armyManual[a] === 1,
      sieging: w.armySiege[a] > 0,
      units: unitsOf(w, a),
      maa: Array.from({ length: UNIT_COUNT }, (_, u) => Math.round(w.armyMaa[a * UNIT_COUNT + u])),
      main: mainUnit(w, a),
      battle: w.armyBattle[a],
      routed: w.day < w.armyRout[a],
    });
  }
  return out;
}

export function playerInfo(w: World): PlayerInfo | null {
  const r = w.player;
  if (r === NONE || !w.realmAlive[r]) return null;
  const ruler = w.realmRuler[r];
  const heir = ruler >= 0 ? findHeir(w, r, ruler) : NONE;
  const vassals: PlayerInfo['vassals'] = [];
  const allies: number[] = [];
  for (let o = 0; o < w.R; o++) {
    if (!w.realmAlive[o]) continue;
    if (w.realmLiege[o] === r) vassals.push({ id: o, name: w.realmName[o], loyalty: Math.round(w.realmLoyalty[o]) });
    if (w.allied[r * w.R + o]) allies.push(o);
  }
  const plots: PlayerInfo['plots'] = [];
  for (let p = 0; p < PLOT_CAP; p++) {
    if (w.plotActive[p] && w.plotOwner[p] === ruler) {
      plots.push({ id: p, target: w.charFullName(w.plotTarget[p]), kind: plotName(w.plotKind[p]), progress: w.plotProgress[p], secrecy: w.plotSecrecy[p] });
    }
  }
  const hostages: CharBrief[] = [];
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (w.charAlive[c] && w.charHostage[c] === r) hostages.push(brief(w, c));
  }
  const armies: number[] = [];
  const leads = new Map<number, number>();
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a]) continue;
    if (w.armyLeader[a] >= 0) leads.set(w.armyLeader[a], a);
    if (w.armyRealm[a] === r && w.armyKind[a] === 0) armies.push(a);
  }
  const commanders: PlayerInfo['commanders'] = [];
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (!w.charAlive[c] || w.charRealm[c] !== r || w.charAge[c] < 16 || w.charHostage[c] >= 0) continue;
    commanders.push({ id: c, name: w.charFullName(c), martial: w.charMartial[c], leads: leads.get(c) ?? -1 });
  }
  commanders.sort((a, b) => b.martial - a.martial);
  return {
    realm: r,
    realmName: w.realmName[r],
    dynasty: w.playerDynasty >= 0 ? w.dynName[w.playerDynasty] : '',
    ruler: brief(w, ruler),
    heir: heir >= 0 ? brief(w, heir) : null,
    grain: w.realmGrain[r],
    cattle: w.realmCattle[r],
    metal: w.realmMetal[r],
    trade: w.realmTrade[r],
    prestige: w.realmPrestige[r],
    stability: w.realmStability[r],
    manpower: w.realmManpower[r],
    levy: w.realmLevy[r],
    liege: w.realmLiege[r],
    loyalty: w.realmLoyalty[r],
    vassals,
    allies,
    army: w.realmArmy[r],
    armies,
    fielded: fieldedMen(w, r),
    availableLevy: availableLevy(w, r),
    availableRetinue: availableRetinue(w, r),
    maa: Array.from({ length: UNIT_COUNT }, (_, u) => ({
      regiments: w.realmMaa[r * UNIT_COUNT + u],
      ready: Math.floor(w.realmMaaMen[r * UNIT_COUNT + u]),
      fielded: Math.round(maaFielded(w, r, u)),
      cost: maaHireCost(u),
      pay: maaPay(u),
    })),
    maaUsed: maaRegiments(w, r),
    maaCap: maaCap(w, r),
    maaExpand: maaExpandCost(w, r),
    retinueCap: retinueCap(w, r),
    commanders,
    raidReadyMonths: Math.max(0, Math.ceil((w.realmRaidReady[r] - w.day) / DAYS_PER_MONTH)),
    plots,
    hostages,
    region: w.realmRegion(r),
  };
}

/** Build one batched UI update. Province/realm data only when something changed (diffs). */
export function buildUpdate(w: World, stats: SimStats): Update {
  let provChanges: Update['provChanges'];
  for (let p = 0; p < w.P; p++) {
    if (!w.dirtyProv[p]) continue;
    provChanges ??= { ids: [], owner: [], occupier: [], develop: [], fort: [] };
    provChanges.ids.push(p);
    provChanges.owner.push(w.provOwner[p]);
    provChanges.occupier.push(w.provOccupier[p]);
    provChanges.develop.push(w.provDevelop[p]);
    provChanges.fort.push(w.provFort[p]);
    w.dirtyProv[p] = 0;
  }
  let realms: RealmInfo[] | undefined;
  if (w.realmsDirty) {
    realms = realmInfos(w);
    w.realmsDirty = false;
  }
  const log = w.log;
  w.log = [];
  return {
    day: w.day,
    date: dateLabel(w),
    yearBce: w.yearBce,
    provChanges,
    realms,
    armies: armyInfos(w),
    battles: battleInfos(w),
    sieges: siegeInfos(w),
    holds: holdInfos(w),
    annexDays: ANNEX_DAYS,
    battleReports: flushReports(w),
    wars: warInfos(w),
    player: playerInfo(w),
    log,
    choice: w.playerQueue[0] ?? null,
    queued: w.playerQueue.length,
    pressure: Array.from(w.pressure),
    regionDetail: Array.from(w.regionDetail),
    gameOver: w.gameOver,
    stats,
    speed: stats.speed,
  };
}

// ---------- On-demand details ----------

export interface CharDetail extends CharBrief {
  dynasty: string;
  culture: string;
  traits: number[];
  skills: number[];
  health: number;
  father: CharBrief | null;
  mother: CharBrief | null;
  spouse: CharBrief | null;
  children: CharBrief[];
  siblings: CharBrief[];
  realm: { id: number; name: string } | null;
  rulesName: string;
  hostageAt: string;
  death: string;
  isPlayerFamily: boolean;
  canPlot: boolean;
}

export function charDetail(w: World, c: number): CharDetail | null {
  if (c < 0 || c >= w.charCount) return null;
  const rel = (x: number) => (x >= 0 ? brief(w, x) : null);
  const children: CharBrief[] = [];
  const siblings: CharBrief[] = [];
  const f = w.charFather[c];
  for (let o = 0; o < w.charCount; o++) {
    if (w.charFather[o] === c || w.charMother[o] === c) children.push(brief(w, o));
    else if (o !== c && f >= 0 && w.charFather[o] === f) siblings.push(brief(w, o));
  }
  const traits: number[] = [];
  for (let t = 0; t < 32; t++) if (w.hasTrait(c, t)) traits.push(t);
  const realm = w.charRealm[c];
  const ruler = w.player !== NONE ? w.realmRuler[w.player] : NONE;
  return {
    ...brief(w, c),
    dynasty: w.charDynasty[c] >= 0 ? w.dynName[w.charDynasty[c]] : 'Lowborn',
    culture: w.content.cultures[w.charCulture[c]].name,
    traits,
    skills: [w.charMartial[c], w.charDiplomacy[c], w.charStewardship[c], w.charIntrigue[c], w.charLearning[c]],
    health: w.charHealth[c],
    father: rel(w.charFather[c]),
    mother: rel(w.charMother[c]),
    spouse: rel(w.charSpouse[c]),
    children: children.sort((a, b) => b.age - a.age),
    siblings,
    realm: realm >= 0 ? { id: realm, name: w.realmName[realm] } : null,
    rulesName: w.charRules[c] >= 0 ? w.realmName[w.charRules[c]] : '',
    hostageAt: w.charHostage[c] >= 0 ? w.realmName[w.charHostage[c]] : '',
    death: w.charAlive[c] ? '' : `Died ${w.scenario.startYear - Math.floor(w.charDeathDay[c] / DAYS_PER_YEAR)} BCE of ${w.deathCause[c] || 'unknown causes'}`,
    isPlayerFamily: w.charDynasty[c] >= 0 && w.charDynasty[c] === w.playerDynasty,
    canPlot: w.charAlive[c] === 1 && c !== ruler && w.player !== NONE,
  };
}

export interface RealmDetail {
  id: number;
  name: string;
  culture: string;
  law: string;
  ruler: CharBrief | null;
  heir: CharBrief | null;
  liege: { id: number; name: string } | null;
  vassals: { id: number; name: string; loyalty: number }[];
  provinces: number;
  levy: number;
  strength: number;
  stability: number;
  prestige: number;
  grain: number;
  trade: number;
  metal: number;
  isPlayer: boolean;
  playerTop: boolean;
  opinionOfPlayer: number;
  playerOpinion: number;
  allied: boolean;
  married: boolean;
  hostile: boolean;
  truceYears: number;
  atWar: boolean;
  landless: boolean;
  /** Unmarried adults at this court, for proposing matches. */
  eligible: CharBrief[];
  /** Unmarried adults at the player's court. */
  myEligible: CharBrief[];
  verdicts: { alliance: string; vassal: string; hostage: string; allianceOk: boolean; vassalOk: boolean; hostageOk: boolean };
  playerStrength: number;
}

export function realmDetail(w: World, r: number): RealmDetail | null {
  if (r < 0 || r >= w.R || !w.realmAlive[r]) return null;
  const ruler = w.realmRuler[r];
  const heir = ruler >= 0 ? findHeir(w, r, ruler) : NONE;
  const me = w.player;
  const vassals: RealmDetail['vassals'] = [];
  for (let o = 0; o < w.R; o++) if (w.realmAlive[o] && w.realmLiege[o] === r) vassals.push({ id: o, name: w.realmName[o], loyalty: Math.round(w.realmLoyalty[o]) });
  const eligible: CharBrief[] = [];
  const myEligible: CharBrief[] = [];
  for (let i = 0; i < w.aliveCount; i++) {
    const c = w.aliveChars[i];
    if (!w.charAlive[c] || w.charSpouse[c] >= 0 || w.charAge[c] < 16 || w.charHostage[c] >= 0) continue;
    if (w.charRealm[c] === r && w.charDynasty[c] >= 0) eligible.push(brief(w, c));
    if (me !== NONE && w.charRealm[c] === me && w.charDynasty[c] >= 0 && r !== me) myEligible.push(brief(w, c));
  }
  const v = (t: 'alliance' | 'vassal' | 'hostage') => (me !== NONE && r !== me ? evaluate(w, t, me, r) : { ok: false, reason: '' });
  const va = v('alliance'), vv = v('vassal'), vh = v('hostage');
  const R = w.R;
  return {
    id: r,
    name: w.realmName[r],
    culture: w.content.cultures[w.realmCulture[r]].name,
    law: lawName(w.realmLaw[r]),
    ruler: ruler >= 0 ? brief(w, ruler) : null,
    heir: heir >= 0 ? brief(w, heir) : null,
    liege: w.realmLiege[r] >= 0 ? { id: w.realmLiege[r], name: w.realmName[w.realmLiege[r]] } : null,
    vassals,
    provinces: w.realmProvCount[r],
    levy: Math.round(w.realmLevy[r]),
    strength: Math.round(strength(w, w.top(r))),
    stability: w.realmStability[r],
    prestige: w.realmPrestige[r],
    grain: w.realmGrain[r],
    trade: w.realmTrade[r],
    metal: w.realmMetal[r],
    isPlayer: r === me,
    playerTop: me !== NONE && w.top(r) === w.top(me),
    opinionOfPlayer: me !== NONE ? w.opinion[r * R + me] : 0,
    playerOpinion: me !== NONE ? w.opinion[me * R + r] : 0,
    allied: me !== NONE && w.allied[me * R + r] === 1,
    married: me !== NONE && w.married[me * R + r] === 1,
    hostile: me !== NONE && w.isHostile(me, r),
    truceYears: me !== NONE ? Math.max(0, (w.truceUntil[me * R + r] - w.day) / DAYS_PER_YEAR) : 0,
    atWar: atWar(w, r),
    landless: w.realmLandless[r] === 1,
    eligible,
    myEligible,
    verdicts: { alliance: va.reason, vassal: vv.reason, hostage: vh.reason, allianceOk: va.ok, vassalOk: vv.ok, hostageOk: vh.ok },
    playerStrength: me !== NONE ? Math.round(strength(w, w.top(me))) : 0,
  };
}

export interface ProvDetail {
  id: number;
  name: string;
  region: string;
  regionId: number;
  terrain: string;
  pop: number;
  develop: number;
  ore: number;
  trade: number;
  grain: number;
  cattle: number;
  raided: number;
  unrest: number;
  coastal: boolean;
  owner: { id: number; name: string } | null;
  topOwner: { id: number; name: string } | null;
  occupier: { id: number; name: string } | null;
  neighbors: { id: number; name: string; sea: boolean }[];
  daysFromCapital: number;
  fort: number;
  /** Months until new walls are done, 0 if not building. */
  fortBuild: number;
  fortCost: { trade: number; metal: number; months: number };
  /** Men needed to besiege it, and base siege work. */
  siegeMen: number;
  siegeNeed: number;
  garrison: number;
  /** Main settlement: 0 village, 1 town, 2 city. */
  tier: number;
  /** Days the occupier has held it, out of annexDays. */
  occDays: number;
  annexDays: number;
  /** Armies besieging it now. */
  besiegers: { army: number; realm: string; men: number; progress: number; days: number; block: string }[];
}

export function provDetail(w: World, p: number): ProvDetail | null {
  if (p < 0 || p >= w.P) return null;
  const m = w.map;
  const o = w.provOwner[p];
  const occ = w.provOccupier[p];
  const neighbors: ProvDetail['neighbors'] = [];
  for (let e = m.adjOffset[p]; e < m.adjOffset[p + 1]; e++) neighbors.push({ id: m.adj[e], name: w.scenario.provinces[m.adj[e]].name, sea: m.adjSea[e] === 1 });
  const cap = w.player !== NONE ? w.realmCapital[w.player] : NONE;
  return {
    id: p,
    name: w.scenario.provinces[p].name,
    region: w.scenario.regions[w.provRegion[p]].name,
    regionId: w.provRegion[p],
    terrain: TERRAINS[w.provTerrain[p]],
    pop: w.provPop[p],
    develop: w.provDevelop[p],
    ore: w.provOre[p],
    trade: w.provTrade[p],
    grain: w.provGrainOut[p],
    cattle: w.provCattleOut[p],
    raided: w.provRaided[p],
    unrest: w.provUnrest[p],
    coastal: m.coastal[p] === 1,
    owner: o >= 0 ? { id: o, name: w.realmName[o] } : null,
    topOwner: o >= 0 ? { id: w.top(o), name: w.realmName[w.top(o)] } : null,
    occupier: occ >= 0 ? { id: occ, name: w.realmName[occ] } : null,
    neighbors,
    daysFromCapital: cap >= 0 ? m.hopDays[p * w.P + cap] : 0,
    fort: w.provFort[p],
    fortBuild: w.provFortBuild[p],
    fortCost: fortCost(w.provFort[p]),
    siegeMen: siegeMinMen(w, p),
    siegeNeed: Math.round(siegeNeed(w, p)),
    garrison: Math.round(garrison(w, p)),
    tier: tierOf(w, p),
    occDays: w.provOccDays[p],
    annexDays: ANNEX_DAYS,
    besiegers: besiegersOf(w, p),
  };
}

function besiegersOf(w: World, p: number): ProvDetail['besiegers'] {
  const out: ProvDetail['besiegers'] = [];
  for (let a = 0; a < ARMY_CAP; a++) {
    if (!w.armyActive[a] || w.armyKind[a] !== 0 || w.armyLoc[a] !== p || w.armyNext[a] >= 0) continue;
    const st = siegeStatus(w, a);
    if (st.block && !w.armySiege[a]) continue;
    out.push({ army: a, realm: w.realmName[w.armyRealm[a]], men: Math.round(w.armyMen[a]), progress: st.progress, days: st.days, block: st.block });
  }
  return out;
}

export function armyDetail(w: World, a: number): ArmyDetail | null {
  if (a < 0 || a >= ARMY_CAP || !w.armyActive[a]) return null;
  const info = armyInfos(w).find((x) => x.id === a)!;
  const P = w.P;
  const route: number[] = [];
  let cur = w.armyNext[a] >= 0 ? w.armyNext[a] : w.armyLoc[a];
  if (w.armyNext[a] >= 0) route.push(cur);
  for (let guard = 0; cur !== w.armyDest[a] && guard < 64; guard++) {
    const n = w.map.nextHop[w.armyDest[a] * P + cur];
    if (n < 0) break;
    route.push(n);
    cur = n;
  }
  const from = w.armyNext[a] >= 0 ? w.armyNext[a] : w.armyLoc[a];
  const daysLeft = (w.armyNext[a] >= 0 ? w.armyLegDays[a] - w.armyProgress[a] : 0) + (from !== w.armyDest[a] ? w.map.hopDays[w.armyDest[a] * P + from] * armyPace(w, a) : 0);
  const leader = w.armyLeader[a] >= 0 && w.charAlive[w.armyLeader[a]] ? w.armyLeader[a] : NONE;
  const loc = w.armyLoc[a];
  const o = w.provOwner[loc];
  const mergeable: ArmyDetail['mergeable'] = [];
  for (let b = 0; b < ARMY_CAP; b++) {
    if (b !== a && w.armyActive[b] && w.armyRealm[b] === w.armyRealm[a] && w.armyKind[b] === 0 && w.armyLoc[b] === loc && w.armyNext[b] < 0) mergeable.push({ id: b, men: Math.round(w.armyMen[b]) });
  }
  const top = w.top(w.armyRealm[a]);
  const st = siegeStatus(w, a);
  return {
    ...info,
    locName: w.scenario.provinces[loc].name,
    destName: w.scenario.provinces[w.armyDest[a]].name,
    route,
    daysLeft: Math.ceil(daysLeft),
    power: Math.round(armyPower(w, a)),
    morale: w.armyMorale[a],
    quality: w.armyQuality[a],
    pace: armyPace(w, a),
    siege: w.armySiege[a] > 0 ? st.progress : 0,
    leader: leader >= 0 ? brief(w, leader) : null,
    leaderMartial: leader >= 0 ? w.charMartial[leader] : 0,
    siegeBlock: st.block,
    siegeDays: st.days,
    fort: w.provFort[loc],
    assaultOdds: st.odds,
    inOwnLand: o >= 0 && w.top(o) === top && (w.provOccupier[loc] < 0 || w.provOccupier[loc] === top),
    mergeable,
  };
}
