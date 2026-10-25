import { useSyncExternalStore } from 'react';
import type { Ready } from '../worker/protocol';
import type { RealmInfo, Update } from '../sim/snapshot';
import type { BattleReport, LogEntry } from '../sim/world';
import { SimBridge } from '../worker/bridge';
import type { PaletteMode } from '../render/palette';

export type Phase = 'title' | 'loading' | 'pick' | 'playing';
export type MapMode = PaletteMode;
export type Selection = { kind: 'province' | 'realm' | 'char' | 'army'; id: number } | null;

export interface GameState {
  phase: Phase;
  ready: Ready | null;
  /** Mirrors of province state, mutated in place; bump mapVersion when they change. */
  owner: Int32Array;
  occupier: Int32Array;
  develop: Uint8Array;
  fort: Uint8Array;
  mapVersion: number;
  realms: Map<number, RealmInfo>;
  realmsVersion: number;
  update: Update | null;
  log: LogEntry[];
  selection: Selection;
  selectedProvince: number;
  selectedArmy: number;
  pickRealm: number;
  mapMode: MapMode;
  speed: number;
  lastSpeed: number;
  showDebug: boolean;
  toast: { text: string; ok: boolean; id: number } | null;
  frame: { fps: number; ms: number; renderMs: number };
  error: string;
  /** Our recent battle results, shown as cards for a while. */
  reports: (BattleReport & { id: number; at: number })[];
  /** Bumped after commands so open detail panels refetch. */
  detailVersion: number;
}

type Listener = () => void;

class Store {
  state: GameState = {
    phase: 'title',
    ready: null,
    owner: new Int32Array(0),
    occupier: new Int32Array(0),
    develop: new Uint8Array(0),
    fort: new Uint8Array(0),
    mapVersion: 0,
    realms: new Map(),
    realmsVersion: 0,
    update: null,
    log: [],
    selection: null,
    selectedProvince: -1,
    selectedArmy: -1,
    pickRealm: -1,
    mapMode: 'political',
    speed: 0,
    lastSpeed: 2,
    showDebug: false,
    toast: null,
    frame: { fps: 0, ms: 0, renderMs: 0 },
    error: '',
    detailVersion: 0,
    reports: [],
  };
  private listeners = new Set<Listener>();

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}

export const store = new Store();
export const sim = new SimBridge();

/** Subscribe a component to one slice of state. Only re-renders when that slice changes. */
export function useStore<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.state));
}

let toastId = 0;
let reportId = 0;
export function toast(text: string, ok = true): void {
  if (!text) return;
  store.set({ toast: { text, ok, id: ++toastId } });
}

sim.onReady = (r) => {
  const realms = new Map(r.realms.map((x) => [x.id, x]));
  store.set({
    ready: r,
    owner: Int32Array.from(r.owner),
    occupier: Int32Array.from(r.occupier),
    develop: Uint8Array.from(r.develop),
    fort: Uint8Array.from(r.fort),
    mapVersion: store.state.mapVersion + 1,
    realms,
    realmsVersion: store.state.realmsVersion + 1,
    phase: r.loaded ? 'playing' : 'pick',
    log: r.loaded ? store.state.log : [],
    selection: null,
    selectedProvince: -1,
    speed: 0,
  });
};

sim.onUpdate = (u) => {
  const s = store.state;
  const patch: Partial<GameState> = { update: u };
  if (u.provChanges) {
    const { ids, owner, occupier, develop, fort } = u.provChanges;
    for (let i = 0; i < ids.length; i++) {
      s.owner[ids[i]] = owner[i];
      s.occupier[ids[i]] = occupier[i];
      s.develop[ids[i]] = develop[i];
      s.fort[ids[i]] = fort[i];
    }
    patch.mapVersion = s.mapVersion + 1;
  }
  if (u.realms) {
    patch.realms = new Map(u.realms.map((x) => [x.id, x]));
    patch.realmsVersion = s.realmsVersion + 1;
  }
  if (u.log.length) {
    const log = s.log.concat(u.log);
    patch.log = log.length > 500 ? log.slice(log.length - 500) : log;
  }
  if (u.battleReports.length) {
    const now = Date.now();
    patch.reports = s.reports.concat(u.battleReports.map((r) => ({ ...r, id: ++reportId, at: now }))).slice(-4);
  }
  // The worker owns the speed; the UI only mirrors it.
  patch.speed = u.speed;
  if (u.speed > 0) patch.lastSpeed = u.speed;
  store.set(patch);
};

sim.onResult = (r) => {
  if (r.message) toast(r.message, r.ok);
  store.set({ detailVersion: store.state.detailVersion + 1 });
};

sim.onError = (m) => store.set({ error: m });

export function setSpeed(speed: number): void {
  const s = store.state;
  store.set({ speed, lastSpeed: speed > 0 ? speed : s.lastSpeed });
  sim.send({ type: 'speed', speed });
}

export function togglePause(): void {
  const s = store.state;
  setSpeed(s.speed > 0 ? 0 : s.lastSpeed);
}

export function select(sel: Selection): void {
  const patch: Partial<GameState> = { selection: sel };
  if (sel?.kind === 'province') patch.selectedProvince = sel.id;
  patch.selectedArmy = sel?.kind === 'army' ? sel.id : -1;
  store.set(patch);
}

/** Top-level liege of a realm from the UI mirror. */
export function topRealm(r: number): number {
  const realms = store.state.realms;
  let guard = 0;
  let cur = realms.get(r);
  while (cur && cur.liege >= 0 && guard++ < 16) {
    const next = realms.get(cur.liege);
    if (!next) break;
    r = cur.liege;
    cur = next;
  }
  return r;
}
