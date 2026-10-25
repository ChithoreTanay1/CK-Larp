import { TAG_HORSE, TAG_MIGRANT, TAG_PALACE, TAG_RAIDER, TAG_SEAFARING, TAG_TEMPLE } from './content';

/** Troop types. Armies are a mix of these, stored as men per type. */
export const enum Unit {
  Spear = 0,
  Bow = 1,
  Sling = 2,
  Heavy = 3,
  Chariot = 4,
}
export const UNIT_COUNT = 5;

export interface UnitType {
  id: string;
  name: string;
  desc: string;
  /** Hand-to-hand strength per man. */
  melee: number;
  /** Missile strength per man. */
  ranged: number;
  /** Charge strength per man; blunted by enemy spears. */
  shock: number;
  /** How much of the enemy's charge this unit absorbs (per share of the army). */
  screen: number;
  /** Share of casualties taken (lower is better armored). */
  armor: number;
  /** Travel-time multiplier; the slowest unit sets the pace. */
  pace: number;
  /** Siege work per man. */
  siege: number;
  /** Strength multiplier by terrain: plains, hills, mountains, river, steppe. */
  terrain: [number, number, number, number, number];
  /** Monthly upkeep per 1000 men. */
  upkeepGrain: number;
  upkeepMetal: number;
  /** Recruitment cost per 100 men. */
  costMetal: number;
  costTrade: number;
  costCattle: number;
  /** Levy troops come from the fields; professionals must be paid for. */
  levy: boolean;
}

export const UNITS: UnitType[] = [
  {
    id: 'spear', name: 'Spearmen', desc: 'Levied farmers with spear and hide shield. The backbone of any host, and the only thing that stops a chariot charge.',
    melee: 1.0, ranged: 0, shock: 0, screen: 1.0, armor: 1.0, pace: 1.0, siege: 1.0,
    terrain: [1, 1.1, 1, 1, 1], upkeepGrain: 1.5, upkeepMetal: 0.15, costMetal: 0.3, costTrade: 0, costCattle: 0, levy: true,
  },
  {
    id: 'bow', name: 'Bowmen', desc: 'Archers with composite bows. Deadly from high ground, helpless if the enemy closes.',
    melee: 0.45, ranged: 1.35, shock: 0, screen: 0.15, armor: 1.15, pace: 1.0, siege: 0.8,
    terrain: [1, 1.2, 1.2, 0.95, 1], upkeepGrain: 1.5, upkeepMetal: 0.1, costMetal: 0.2, costTrade: 0.8, costCattle: 0, levy: true,
  },
  {
    id: 'sling', name: 'Slingers', desc: 'Hill men with slings and javelins. Fast, cheap and at home in rough country.',
    melee: 0.6, ranged: 0.75, shock: 0, screen: 0.2, armor: 1.05, pace: 0.8, siege: 0.6,
    terrain: [0.85, 1.25, 1.45, 0.95, 0.9], upkeepGrain: 1.2, upkeepMetal: 0.05, costMetal: 0, costTrade: 0, costCattle: 0, levy: true,
  },
  {
    id: 'heavy', name: 'Bronze Warriors', desc: 'Professional fighters in bronze corslets with long swords. Expensive, slow, and they break lines.',
    melee: 1.8, ranged: 0, shock: 0.3, screen: 0.6, armor: 0.6, pace: 1.15, siege: 1.2,
    terrain: [1, 1, 0.9, 1, 1], upkeepGrain: 2, upkeepMetal: 0.7, costMetal: 4, costTrade: 2, costCattle: 0, levy: false,
  },
  {
    id: 'chariot', name: 'Chariots', desc: 'Two-horse chariots carrying a driver and an archer. Terrifying on open plains, useless in the hills.',
    melee: 0.5, ranged: 0.7, shock: 3.0, screen: 0.1, armor: 0.8, pace: 0.75, siege: 0.15,
    terrain: [1.3, 0.55, 0.25, 1.0, 1.4], upkeepGrain: 4, upkeepMetal: 0.9, costMetal: 6, costTrade: 6, costCattle: 4, levy: false,
  },
];

/** Share of casualties per type for the winning and losing side. */
const EXPOSURE_WIN = [1, 0.55, 0.6, 0.85, 0.5];
const EXPOSURE_LOSE = [1, 1.0, 0.85, 0.8, 1.25];

export function exposure(u: number, won: boolean): number {
  return (won ? EXPOSURE_WIN : EXPOSURE_LOSE)[u] * UNITS[u].armor;
}

export type Mix = [number, number, number, number, number];

/** Levy mix (spear, bow, sling) by culture tags. */
export function levyMix(tags: number): Mix {
  const m: Mix = [0.55, 0.25, 0.2, 0, 0];
  if (tags & TAG_TEMPLE) {
    m[0] -= 0.1;
    m[1] += 0.1;
  }
  if (tags & (TAG_RAIDER | TAG_MIGRANT)) {
    m[1] -= 0.1;
    m[2] += 0.1;
  }
  return m;
}

/** How much of a raised host the realm would like as professionals, by culture. */
export function professionalShare(tags: number): { heavy: number; chariot: number } {
  let heavy = 0.04, chariot = 0;
  if (tags & TAG_PALACE) {
    heavy += 0.08;
    chariot += 0.06;
  }
  if (tags & TAG_HORSE) chariot += 0.1;
  if (tags & TAG_SEAFARING && tags & TAG_RAIDER) heavy += 0.1;
  return { heavy, chariot };
}

/** Mix for raid parties: light troops. Horse peoples bring a few chariots. */
export function raidMix(tags: number): Mix {
  return tags & TAG_HORSE ? [0.3, 0.2, 0.4, 0, 0.1] : [0.35, 0.2, 0.45, 0, 0];
}

/** Sea Peoples bands: Sherden swordsmen and javelin men. */
export const SEA_BAND_MIX: Mix = [0.3, 0.1, 0.3, 0.3, 0];
