/** Shapes of the JSON data files in /src/data. Validated at build time by scripts/validate-data.ts. */

export type LonLat = [number, number];
export type Terrain = 'plains' | 'hills' | 'mountains' | 'river' | 'steppe';
export const TERRAINS: readonly Terrain[] = ['plains', 'hills', 'mountains', 'river', 'steppe'];

export type SuccessionLaw = 'primogeniture' | 'elective' | 'tribal';
export const LAWS: readonly SuccessionLaw[] = ['primogeniture', 'elective', 'tribal'];

export const PRESSURE_KEYS = ['drought', 'famine', 'raiderPressure', 'tradeHealth', 'ironAdoption', 'legitimacy'] as const;
export type PressureKey = (typeof PRESSURE_KEYS)[number];

export interface RegionData {
  id: string;
  name: string;
  detail: 'full' | 'reduced';
  pressure: Record<PressureKey, number>;
  /** Long-run drought level the region drifts toward. */
  droughtBaseline: number;
  /** Long-run raider pressure once the migrations settle. */
  raiderBaseline: number;
  /** Multiplier on how quickly iron working spreads here. */
  ironRate: number;
}

export interface ProvinceData {
  name: string;
  lon: number;
  lat: number;
  region: string;
  terrain: Terrain;
  /** Copper/tin/iron ore richness, 0-3. */
  ore: number;
  /** Trade importance (ports, crossroads), 0-3. */
  trade: number;
  /** Development level, 1-5. */
  develop: number;
}

export interface RealmData {
  id: string;
  name: string;
  culture: string;
  provinces: string[];
  liege?: string;
  law?: SuccessionLaw;
  /** One-line pitch shown on the ruler-pick screen. */
  featured?: string;
}

export interface RaiderBandData {
  name: string;
  culture: string;
}

export interface ScenarioData {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  startYear: number; // BCE, counts down
  mapSeed: number;
  map: { width: number; height: number; lonMin: number; lonMax: number; latMin: number; latMax: number };
  land: LonLat[][];
  seas: LonLat[][];
  wastes: LonLat[][];
  regions: RegionData[];
  provinces: ProvinceData[];
  realms: RealmData[];
  raiders: RaiderBandData[];
}

export interface CultureData {
  id: string;
  name: string;
  group: string;
  hue: number;
  law: SuccessionLaw;
  tags: string[];
  male: string[];
  female: string[];
  dynasties: string[];
}

export interface TraitData {
  id: string;
  name: string;
  desc: string;
  kind: 'personality' | 'education' | 'physical' | 'special';
  opposite?: string;
  /** Chance to pass to a child if a parent has it. */
  inherit?: number;
  skills?: Partial<Record<'martial' | 'diplomacy' | 'stewardship' | 'intrigue' | 'learning', number>>;
  /** AI personality axes, roughly -2..2. */
  ai?: Partial<Record<AiAxis, number>>;
  health?: number;
  fertility?: number;
}

export type AiAxis = 'aggression' | 'ambition' | 'greed' | 'honor' | 'piety' | 'boldness' | 'scheming';
export const AI_AXES: readonly AiAxis[] = ['aggression', 'ambition', 'greed', 'honor', 'piety', 'boldness', 'scheming'];

export type EventTrigger =
  | 'monthly'
  | 'yearly'
  | 'on_war_declared'
  | 'on_battle_won'
  | 'on_battle_lost'
  | 'on_raided'
  | 'on_raid_success'
  | 'on_birth'
  | 'on_succession'
  | 'on_famine';
export const EVENT_TRIGGERS: readonly EventTrigger[] = [
  'monthly',
  'yearly',
  'on_war_declared',
  'on_battle_won',
  'on_battle_lost',
  'on_raided',
  'on_raid_success',
  'on_birth',
  'on_succession',
  'on_famine',
];

export interface EventOptionData {
  label: string;
  effects: string[];
  /** Trait-id -> weight used by AI rulers when picking this option. 'base' is the default weight. */
  ai?: Record<string, number>;
  tooltip?: string;
}

export interface EventData {
  id: string;
  trigger: EventTrigger;
  region_tags: string[];
  conditions: string[];
  weight: number;
  /** Optional multipliers: { if: condition, mult } */
  weight_mods?: { if: string; mult: number }[];
  /** Months before this event can fire again for the same realm. */
  cooldown?: number;
  title: string;
  text: string;
  options: EventOptionData[];
}
