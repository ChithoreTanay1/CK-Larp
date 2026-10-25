import type { CultureData, TraitData } from './types';
import { AI_AXES, LAWS } from './types';

export const TAGS = ['seafaring', 'raider', 'migrant', 'palace', 'temple', 'horse'] as const;
export const TAG_SEAFARING = 1, TAG_RAIDER = 2, TAG_MIGRANT = 4, TAG_PALACE = 8, TAG_TEMPLE = 16, TAG_HORSE = 32;

export const SKILLS = ['martial', 'diplomacy', 'stewardship', 'intrigue', 'learning'] as const;
export const AXIS_AGGRESSION = 0, AXIS_AMBITION = 1, AXIS_GREED = 2, AXIS_HONOR = 3, AXIS_PIETY = 4, AXIS_BOLDNESS = 5, AXIS_SCHEMING = 6;

const KIND = { personality: 0, education: 1, physical: 2, special: 3 } as const;
export const KIND_PERSONALITY = 0, KIND_EDUCATION = 1, KIND_PHYSICAL = 2, KIND_SPECIAL = 3;

/** Trait and culture data compiled into flat lookup tables. */
export interface Content {
  traits: TraitData[];
  traitIdx: Map<string, number>;
  /** [trait * 5 + skill] */
  tSkill: Int8Array;
  /** [trait * 7 + axis] */
  tAi: Float32Array;
  tHealth: Int8Array;
  tFertility: Float32Array;
  tInherit: Float32Array;
  tOpposite: Int8Array;
  tKind: Uint8Array;
  personality: number[];
  education: number[];

  cultures: CultureData[];
  cultureIdx: Map<string, number>;
  cultureTags: Uint8Array;
  cultureLaw: Uint8Array;
  cultureGroup: Uint8Array;
  groups: string[];
  /** Interned name ids per culture. */
  cultureMale: number[][];
  cultureFemale: number[][];
  names: string[];
}

export function compileContent(traits: TraitData[], cultures: CultureData[]): Content {
  if (traits.length > 32) throw new Error('At most 32 traits fit in the trait bitmask');
  const T = traits.length;
  const traitIdx = new Map(traits.map((t, i) => [t.id, i]));
  const tSkill = new Int8Array(T * 5);
  const tAi = new Float32Array(T * AI_AXES.length);
  const tHealth = new Int8Array(T);
  const tFertility = new Float32Array(T);
  const tInherit = new Float32Array(T);
  const tOpposite = new Int8Array(T).fill(-1);
  const tKind = new Uint8Array(T);
  traits.forEach((t, i) => {
    SKILLS.forEach((s, k) => (tSkill[i * 5 + k] = t.skills?.[s] ?? 0));
    AI_AXES.forEach((a, k) => (tAi[i * AI_AXES.length + k] = t.ai?.[a] ?? 0));
    tHealth[i] = t.health ?? 0;
    tFertility[i] = t.fertility ?? 0;
    tInherit[i] = t.inherit ?? 0;
    tOpposite[i] = t.opposite ? (traitIdx.get(t.opposite) ?? -1) : -1;
    tKind[i] = KIND[t.kind];
  });

  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  const intern = (n: string) => {
    let i = nameIdx.get(n);
    if (i === undefined) {
      i = names.length;
      names.push(n);
      nameIdx.set(n, i);
    }
    return i;
  };
  const groups: string[] = [];
  const cultureTags = new Uint8Array(cultures.length);
  const cultureLaw = new Uint8Array(cultures.length);
  const cultureGroup = new Uint8Array(cultures.length);
  cultures.forEach((c, i) => {
    let mask = 0;
    for (const tag of c.tags) {
      const k = TAGS.indexOf(tag as (typeof TAGS)[number]);
      if (k >= 0) mask |= 1 << k;
    }
    cultureTags[i] = mask;
    cultureLaw[i] = LAWS.indexOf(c.law);
    if (!groups.includes(c.group)) groups.push(c.group);
    cultureGroup[i] = groups.indexOf(c.group);
  });

  return {
    traits,
    traitIdx,
    tSkill,
    tAi,
    tHealth,
    tFertility,
    tInherit,
    tOpposite,
    tKind,
    personality: traits.flatMap((t, i) => (t.kind === 'personality' ? [i] : [])),
    education: traits.flatMap((t, i) => (t.kind === 'education' ? [i] : [])),
    cultures,
    cultureIdx: new Map(cultures.map((c, i) => [c.id, i])),
    cultureTags,
    cultureLaw,
    cultureGroup,
    groups,
    cultureMale: cultures.map((c) => c.male.map(intern)),
    cultureFemale: cultures.map((c) => c.female.map(intern)),
    names,
  };
}

/** Look up a trait index by id, throwing on typos (used at module init by systems). */
export function traitId(c: Content, id: string): number {
  const i = c.traitIdx.get(id);
  if (i === undefined) throw new Error(`Unknown trait ${id}`);
  return i;
}
