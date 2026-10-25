/// <reference lib="webworker" />
import { loadScenario } from '../sim/data';
import { createWorld, setPlayer, type GameData } from '../sim/setup';
import { stepDay, newStats } from '../sim/tick';
import { World, ARMY_CAP, WAR_CAP } from '../sim/world';
import { applyCommand } from '../sim/commands';
import { buildUpdate, armyDetail, charDetail, realmDetail, provDetail, realmInfos, dateLabel, type SimStats } from '../sim/snapshot';
import { serializeWorld, deserializeWorld } from '../sim/save';
import { forceEvent } from '../sim/events/runner';
import { SPEEDS, type FromWorker, type ToWorker, type Ready } from './protocol';

/**
 * The simulation runs here, off the main thread. It receives commands, advances days
 * against a per-frame time budget, and posts one batched update ~10 times a second.
 */

declare const self: DedicatedWorkerGlobalScope;

const STEP_BUDGET_MS = 10;
const POST_INTERVAL_MS = 100;

let data: GameData | null = null;
let w: World | null = null;
let started = false;
let speed = 0;
let acc = 0;
let last = performance.now();
let lastPost = 0;
let dirty = true;
const tick = newStats();
let daysCounted = 0, dpsWindow = performance.now(), dps = 0;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function stats(world: World): SimStats {
  let realms = 0, armies = 0, wars = 0;
  for (let r = 0; r < world.R; r++) realms += world.realmAlive[r];
  for (let a = 0; a < ARMY_CAP; a++) armies += world.armyActive[a];
  for (let i = 0; i < WAR_CAP; i++) wars += world.warActive[i];
  return { ...tick, chars: world.aliveCount, charsTotal: world.charCount, realms, armies, wars, speed, daysPerSec: dps };
}

function sendUpdate(): void {
  if (!w) return;
  post({ type: 'update', ...buildUpdate(w, stats(w)) });
  lastPost = performance.now();
  dirty = false;
}

function ready(gd: GameData, world: World, loaded: boolean): void {
  const m = gd.map;
  const ids = m.ids.slice();
  const msg: Ready = {
    type: 'ready',
    map: {
      width: m.width,
      height: m.height,
      ids,
      provinceCount: m.provinceCount,
      anchorX: m.anchorX.slice(),
      anchorY: m.anchorY.slice(),
      coastal: m.coastal.slice(),
      terrain: world.provTerrain.slice(),
      region: world.provRegion.slice(),
    },
    provinceNames: gd.scenario.provinces.map((p) => p.name),
    regions: gd.scenario.regions.map((r) => ({ id: r.id, name: r.name })),
    cultures: gd.content.cultures.map((c) => ({ id: c.id, name: c.name, hue: c.hue })),
    traits: gd.content.traits.map((t) => ({ id: t.id, name: t.name, desc: t.desc, kind: t.kind })),
    events: gd.events.events.map((e) => e.data.id),
    featured: loaded
      ? []
      : gd.scenario.realms.flatMap((r, i) => (r.featured ? [{ realm: i, name: r.name, pitch: r.featured, culture: gd.content.cultures[gd.content.cultureIdx.get(r.culture)!].name }] : [])),
    realms: realmInfos(world),
    owner: Array.from(world.provOwner),
    occupier: Array.from(world.provOccupier),
    develop: Array.from(world.provDevelop),
    fort: Array.from(world.provFort),
    scenarioName: gd.scenario.name,
    scenarioDescription: gd.scenario.description,
    loaded,
  };
  world.dirtyProv.fill(0);
  world.realmsDirty = false;
  post(msg, [ids.buffer]);
}

const cache = new Map<string, GameData>();
async function gameData(id: string): Promise<GameData> {
  let gd = cache.get(id);
  if (!gd) {
    gd = await loadScenario(id);
    cache.set(id, gd);
  }
  return gd;
}

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case 'newGame': {
      data = await gameData(msg.scenario);
      w = createWorld(data, msg.seed);
      started = false;
      speed = 0;
      ready(data, w, false);
      break;
    }
    case 'start': {
      if (!w) return;
      setPlayer(w, msg.realm);
      started = true;
      dirty = true;
      sendUpdate();
      break;
    }
    case 'load': {
      data = await gameData(msg.scenario);
      w = await deserializeWorld(data, msg.buffer);
      started = true;
      speed = 0;
      ready(data, w, true);
      dirty = true;
      sendUpdate();
      break;
    }
    case 'speed':
      speed = Math.max(0, Math.min(SPEEDS.length - 1, msg.speed));
      acc = 0;
      // Confirm at once so the UI never shows a speed the sim isn't running.
      sendUpdate();
      break;
    case 'cmd': {
      if (!w) return;
      const result = applyCommand(w, msg.cmd);
      post({ type: 'cmdResult', reqId: msg.reqId, result });
      dirty = true;
      sendUpdate();
      break;
    }
    case 'detail': {
      if (!w) return;
      const d = msg.what === 'char' ? charDetail(w, msg.id) : msg.what === 'realm' ? realmDetail(w, msg.id) : msg.what === 'army' ? armyDetail(w, msg.id) : provDetail(w, msg.id);
      post({ type: 'detail', reqId: msg.reqId, data: d });
      break;
    }
    case 'save': {
      if (!w) return;
      const buffer = await serializeWorld(w);
      const r = w.player;
      post(
        { type: 'saved', reqId: msg.reqId, buffer, meta: { realm: r >= 0 ? w.realmName[r] : '', ruler: r >= 0 ? w.charFullName(w.realmRuler[r]) : '', date: dateLabel(w) } },
        [buffer],
      );
      break;
    }
    case 'devFire':
      if (w && w.player >= 0) {
        forceEvent(w, msg.id, w.player);
        dirty = true;
        sendUpdate();
      }
      break;
    case 'step':
      if (w) {
        for (let i = 0; i < msg.days; i++) stepDay(w, tick);
        dirty = true;
        sendUpdate();
      }
      break;
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  handle(e.data).catch((err: Error) => post({ type: 'error', message: err.stack ?? err.message }));
};

function loop(): void {
  const now = performance.now();
  const dt = now - last;
  last = now;
  if (w && started && speed > 0 && !w.gameOver && w.playerQueue.length === 0) {
    // Never bank more than a quarter second of days, so a slow frame cannot cause a burst.
    acc = Math.min(acc + (dt / 1000) * SPEEDS[speed], Math.max(1, SPEEDS[speed] / 4));
    const end = now + STEP_BUDGET_MS;
    while (acc >= 1 && performance.now() < end) {
      stepDay(w, tick);
      acc -= 1;
      daysCounted++;
      dirty = true;
      if (w.playerQueue.length || w.gameOver) {
        acc = 0;
        break;
      }
    }
  }
  if (now - dpsWindow >= 1000) {
    dps = (daysCounted * 1000) / (now - dpsWindow);
    daysCounted = 0;
    dpsWindow = now;
  }
  if (w && started && dirty && now - lastPost >= POST_INTERVAL_MS) sendUpdate();
  setTimeout(loop, 8);
}
loop();
