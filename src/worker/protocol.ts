import type { Command, CommandResult } from '../sim/commands';
import type { ArmyDetail, CharDetail, DiploRow, ProvDetail, RealmDetail, RealmInfo, Update } from '../sim/snapshot';

/** Days per second for each speed setting: each step roughly triples the last. */
export const SPEEDS = [0, 1, 3, 10, 30, 100];

/** UI -> worker messages. */
export type ToWorker =
  | { type: 'newGame'; scenario: string; seed: number }
  | { type: 'start'; realm: number }
  | { type: 'speed'; speed: number }
  | { type: 'cmd'; cmd: Command; reqId?: number }
  | { type: 'detail'; reqId: number; what: 'char' | 'realm' | 'province' | 'army' | 'diplomacy'; id: number }
  | { type: 'save'; reqId: number }
  | { type: 'load'; scenario: string; buffer: ArrayBuffer }
  | { type: 'devFire'; id: string }
  | { type: 'step'; days: number };

export interface StaticMap {
  width: number;
  height: number;
  ids: Uint16Array;
  provinceCount: number;
  anchorX: Float32Array;
  anchorY: Float32Array;
  coastal: Uint8Array;
  terrain: Uint8Array;
  region: Uint8Array;
}

export interface Featured {
  realm: number;
  name: string;
  pitch: string;
  culture: string;
}

export interface Ready {
  type: 'ready';
  map: StaticMap;
  provinceNames: string[];
  regions: { id: string; name: string }[];
  cultures: { id: string; name: string; hue: number }[];
  traits: { id: string; name: string; desc: string; kind: string }[];
  events: string[];
  featured: Featured[];
  realms: RealmInfo[];
  owner: number[];
  occupier: number[];
  develop: number[];
  fort: number[];
  scenarioName: string;
  scenarioDescription: string;
  loaded: boolean;
}

/** Worker -> UI messages. */
export type FromWorker =
  | Ready
  | ({ type: 'update' } & Update)
  | { type: 'detail'; reqId: number; data: CharDetail | RealmDetail | ProvDetail | ArmyDetail | DiploRow[] | null }
  | { type: 'cmdResult'; reqId?: number; result: CommandResult }
  | { type: 'saved'; reqId: number; buffer: ArrayBuffer; meta: { realm: string; ruler: string; date: string } }
  | { type: 'error'; message: string };
