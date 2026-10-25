import { World, NONE, WAR_CAP, ARMY_CAP, PLOT_CAP, LogEntry, PendingChoice, DAYS_PER_MONTH, MONTHS_PER_YEAR, DAYS_PER_YEAR } from './world';
import { findHeir } from './systems/succession';
import { strength } from './systems/realms';
import { warName, atWar } from './systems/war';
import { evaluate } from './systems/diplomacy';
import { plotName } from './systems/plots';
import { lawName } from './systems/characters';
import { TERRAINS } from './types';
import type { TickStats } from './tick';
import { UNIT_COUNT } from './units';
import { armyPace, armyPower, availableLevy, availableRetinue, retinueCap, fieldedMen, siegeNeed } from './systems/military';

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
  /** Index of the largest troop type, for the map marker. */
  main: number;
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
  raidReadyMonths: number;
  plots: { id: number; target: string; kind: string; progress: number; secrecy: number }[];
  hostages: CharBrief[];
  region: number;
}

export interface Update {
  day: number;
  date: string;
  yearBce: number;
  provChanges?: { ids: number[]; owner: number[]; occupier: number[]; develop: number[] };
  realms?: RealmInfo[];
  armies: ArmyInfo[];
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
      main: mainUnit(w, a),
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
    provChanges ??= { ids: [], owner: [], occupier: [], develop: [] };
    provChanges.ids.push(p);
    provChanges.owner.push(w.provOwner[p]);
    provChanges.occupier.push(w.provOccupier[p]);
    provChanges.develop.push(w.provDevelop[p]);
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
    wars: warInfos(w),
    player: playerInfo(w),
    log,
    choice: w.playerQueue[0] ?? null,
    queued: w.playerQueue.length,
    pressure: Array.from(w.pressure),
    regionDetail: Array.from(w.regionDetail),
    gameOver: w.gameOver,
    stats,
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
  };
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
  const need = siegeNeed(w, loc);
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
    siege: w.armySiege[a] > 0 ? Math.min(1, w.armySiege[a] / need) : 0,
    leader: leader >= 0 ? brief(w, leader) : null,
    leaderMartial: leader >= 0 ? w.charMartial[leader] : 0,
    inOwnLand: o >= 0 && w.top(o) === top && (w.provOccupier[loc] < 0 || w.provOccupier[loc] === top),
    mergeable,
  };
}
