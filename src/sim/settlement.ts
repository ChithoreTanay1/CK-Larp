/**
 * Every province has one main settlement. Its size follows from the province: a realm's
 * capital, a great citadel or a rich center is a city; walled or developed places are towns;
 * the rest are villages. Shared by the simulation (siege work, garrisons) and the map.
 */
export const enum Tier {
  Village = 0,
  Town = 1,
  City = 2,
}

export const TIER_NAMES = ['village', 'town', 'city'];

export function settlementTier(capital: boolean, develop: number, fort: number): Tier {
  if (capital || fort >= 3 || develop >= 4) return Tier.City;
  if (fort >= 1 || develop >= 2) return Tier.Town;
  return Tier.Village;
}

/** Extra siege work to take a settlement of each tier. */
export const TIER_SIEGE = [0, 8, 20];
/** Garrison multiplier per tier: cities have more people to man the walls. */
export const TIER_GARRISON = [1, 1.15, 1.4];
