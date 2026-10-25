import { World } from './world';
import type { GameData } from './setup';
import { setEventDb } from './events/runner';
import { initTraitIds } from './systems/characters';

/**
 * Binary saves: every typed array in the World is written raw, plus a small JSON
 * header for strings and scalars, then gzip-compressed with CompressionStream.
 * The map is regenerated from the scenario seed, so it is not stored.
 */

const MAGIC = 0x31534941; // "AIS1"
const VERSION = 2;

type TA = Int8Array | Uint8Array | Uint16Array | Int16Array | Int32Array | Uint32Array | Float32Array;
const CTORS: Record<string, new (b: ArrayBuffer, o: number, n: number) => TA> = {
  Int8Array,
  Uint8Array,
  Uint16Array,
  Int16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
};

/** Fields that are derived or transient and should not be saved. */
const SKIP = new Set(['aliveChars', 'dirtyProv']);
const SCALARS = ['seed', 'day', 'player', 'playerDynasty', 'gameOver', 'nextUid', 'charCap', 'charCount', 'realmsDirty'] as const;

interface Header {
  version: number;
  scenario: string;
  scalars: Record<string, unknown>;
  strings: { nameTable: string[]; dynName: string[]; dynCulture: number[]; deathCause: string[]; realmName: string[] };
  eventCooldown: [number, number][];
  playerQueue: World['playerQueue'];
  log: World['log'];
  arrays: { key: string; type: string; offset: number; length: number }[];
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function typedArrays(w: World): [string, TA][] {
  const out: [string, TA][] = [];
  for (const [k, v] of Object.entries(w)) if (ArrayBuffer.isView(v) && !SKIP.has(k)) out.push([k, v as TA]);
  out.push(['rng', w.rng.s]);
  return out;
}

export async function serializeWorld(w: World): Promise<ArrayBuffer> {
  const arrays = typedArrays(w);
  const meta: Header['arrays'] = [];
  let offset = 0;
  for (const [key, a] of arrays) {
    offset = (offset + 7) & ~7;
    meta.push({ key, type: a.constructor.name, offset, length: a.length });
    offset += a.byteLength;
  }
  const scalars: Record<string, unknown> = {};
  for (const k of SCALARS) scalars[k] = w[k];
  const header: Header = {
    version: VERSION,
    scenario: w.scenario.id,
    scalars,
    strings: { nameTable: w.nameTable, dynName: w.dynName, dynCulture: w.dynCulture, deathCause: Array.from({ length: w.charCount }, (_, i) => w.deathCause[i] ?? ''), realmName: w.realmName },
    eventCooldown: [...w.eventCooldown.entries()],
    playerQueue: w.playerQueue,
    log: w.log.slice(-50),
    arrays: meta,
  };
  const hb = new TextEncoder().encode(JSON.stringify(header));
  const bodyStart = (8 + hb.length + 7) & ~7;
  const buf = new Uint8Array(bodyStart + offset);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, hb.length, true);
  buf.set(hb, 8);
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i][1];
    buf.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), bodyStart + meta[i].offset);
  }
  const z = await pipe(buf, new CompressionStream('gzip'));
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
}

export async function deserializeWorld(data: GameData, compressed: ArrayBuffer): Promise<World> {
  const buf = await pipe(new Uint8Array(compressed), new DecompressionStream('gzip'));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not an Ashes & Iron save file');
  const hlen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hlen))) as Header;
  if (header.version !== VERSION) throw new Error(`Unsupported save version ${header.version}`);
  if (header.scenario !== data.scenario.id) throw new Error(`Save is for scenario ${header.scenario}`);
  const bodyStart = (8 + hlen + 7) & ~7;

  setEventDb(data.events);
  const w = new World(data.scenario, data.map, data.content, header.scalars.seed as number);
  initTraitIds(w);
  const target = w as unknown as Record<string, unknown>;
  for (const m of header.arrays) {
    const Ctor = CTORS[m.type];
    if (!Ctor) throw new Error(`Bad array type ${m.type}`);
    // Copy into a fresh, aligned buffer.
    const bytes = buf.slice(bodyStart + m.offset, bodyStart + m.offset + m.length * (Ctor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT);
    const arr = new Ctor(bytes.buffer, 0, m.length);
    if (m.key === 'rng') w.rng.s.set(arr);
    else target[m.key] = arr;
  }
  for (const k of SCALARS) target[k] = header.scalars[k];
  w.nameTable = header.strings.nameTable;
  w.nameIndex = new Map(w.nameTable.map((n, i) => [n, i]));
  w.dynName = header.strings.dynName;
  w.dynCulture = header.strings.dynCulture;
  w.deathCause = header.strings.deathCause;
  w.realmName = header.strings.realmName;
  w.eventCooldown = new Map(header.eventCooldown);
  w.playerQueue = header.playerQueue;
  w.log = header.log;
  w.aliveChars = new Int32Array(w.charCap);
  w.rebuildAlive();
  w.dirtyProv.fill(1);
  w.realmsDirty = true;
  return w;
}
