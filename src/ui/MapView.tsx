import { useEffect, useRef, useState } from 'react';
import { MapRenderer } from '../render/mapRenderer';
import { buildPalette } from '../render/palette';
import { select, sim, store, topRealm, useStore } from './store';

let renderer: MapRenderer | null = null;
/** Lets other components pan the map. */
export function focusProvince(p: number): void {
  renderer?.centerOn(p);
}

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const ready = useStore((s) => s.ready);
  const mapVersion = useStore((s) => s.mapVersion);
  const realmsVersion = useStore((s) => s.realmsVersion);
  const mode = useStore((s) => s.mapMode);
  const selected = useStore((s) => s.selectedProvince);
  const pickRealm = useStore((s) => s.pickRealm);
  const phase = useStore((s) => s.phase);
  const update = useStore((s) => s.update);
  const selectedArmy = useStore((s) => s.selectedArmy);
  const [inited, setInited] = useState(0);
  const [hover, setHover] = useState<{ p: number; x: number; y: number } | null>(null);
  const lastPressure = useRef('');

  useEffect(() => {
    if (!ready || !host.current) return;
    const r = new MapRenderer({
      onClick: (p, button) => {
        const s = store.state;
        const armies = s.update?.armies ?? [];
        // Right click with an army selected: move it.
        if (button === 2) {
          if (s.selectedArmy >= 0 && p >= 0) {
            sim.command({ c: 'moveArmy', army: s.selectedArmy, dest: p });
          }
          return;
        }
        if (s.phase === 'playing' && renderer) {
          const bounds = renderer.app.canvas.getBoundingClientRect();
          const x = lastPointer.x - bounds.left, y = lastPointer.y - bounds.top;
          const own = armies.filter((a) => a.kind === 0 && a.realm === s.update?.player?.realm);
          // Clicking a stack again cycles through our armies in it.
          let a = renderer.armyAt(x, y, own.filter((o) => o.id !== s.selectedArmy));
          if (a < 0) a = renderer.armyAt(x, y, own);
          if (a >= 0) {
            select({ kind: 'army', id: a });
            return;
          }
        }
        if (p < 0) {
          select(null);
          return;
        }
        if (s.phase === 'pick') {
          const o = s.owner[p];
          store.set({ pickRealm: o >= 0 ? topRealm(o) : -1, selectedProvince: p });
          return;
        }
        select({ kind: 'province', id: p });
      },
      onHover: (p, x, y) => setHover(p >= 0 ? { p, x, y } : null),
      onFrame: (ms) => {
        const f = store.state.frame;
        frames++;
        const now = performance.now();
        if (now - frameWindow > 1000) {
          store.set({ frame: { fps: Math.round((frames * 1000) / (now - frameWindow)), ms: f.ms, renderMs: ms } });
          frames = 0;
          frameWindow = now;
        }
      },
    });
    let frames = 0, frameWindow = performance.now();
    const lastPointer = { x: 0, y: 0 };
    const track = (e: PointerEvent) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
    };
    window.addEventListener('pointerdown', track, true);
    let alive = true;
    r.init(host.current, ready.map).then(() => {
      if (!alive) return;
      renderer = r;
      // A loaded game starts on the player's capital.
      const me = store.state.update?.player?.realm ?? -1;
      const cap = me >= 0 ? store.state.realms.get(me)?.capital ?? -1 : -1;
      if (store.state.phase === 'playing' && cap >= 0) r.centerOn(cap);
      setInited((n) => n + 1);
    });
    return () => {
      alive = false;
      window.removeEventListener('pointerdown', track, true);
      if (renderer === r) renderer = null;
      r.destroy();
    };
  }, [ready]);

  // Political layer: recolor when ownership, realms, mode or selection change.
  useEffect(() => {
    if (!renderer || !ready) return;
    const s = store.state;
    const pressure = s.update?.pressure ?? null;
    const highlight = new Uint8Array(ready.map.provinceCount);
    const focusRealm = phase === 'pick' ? pickRealm : s.update?.player?.realm ?? -1;
    if (focusRealm >= 0) for (let p = 0; p < highlight.length; p++) if (s.owner[p] >= 0 && topRealm(s.owner[p]) === focusRealm) highlight[p] = 1;
    renderer.recolor(
      buildPalette({ mode, owner: s.owner, occupier: s.occupier, region: ready.map.region, realms: s.realms, cultureHue: ready.cultures.map((c) => c.hue), pressure, top: topRealm }),
      selected,
      highlight,
    );
    lastPressure.current = pressure ? pressure.join(',') : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inited, mapVersion, realmsVersion, mode, selected, pickRealm, phase, ready, update?.player?.realm]);

  // Pressure modes also follow the monthly pressure values.
  useEffect(() => {
    if (!renderer || !ready || !update || mode === 'political' || mode === 'realms' || mode === 'culture' || mode === 'terrain') return;
    const key = update.pressure.join(',');
    if (key === lastPressure.current) return;
    lastPressure.current = key;
    const s = store.state;
    renderer.recolor(
      buildPalette({ mode, owner: s.owner, occupier: s.occupier, region: ready.map.region, realms: s.realms, cultureHue: ready.cultures.map((c) => c.hue), pressure: update.pressure, top: topRealm }),
      selected,
    );
  }, [update, mode, ready, selected]);

  // Labels and capitals: per top-level realm.
  useEffect(() => {
    if (!renderer || !ready) return;
    const s = store.state;
    const P = ready.map.provinceCount;
    const acc = new Map<number, { x: number; y: number; n: number }>();
    for (let p = 0; p < P; p++) {
      const o = s.owner[p];
      if (o < 0) continue;
      const t = topRealm(o);
      const a = acc.get(t) ?? { x: 0, y: 0, n: 0 };
      a.x += ready.map.anchorX[p];
      a.y += ready.map.anchorY[p];
      a.n++;
      acc.set(t, a);
    }
    const labels: { text: string; x: number; y: number; size: number }[] = [];
    for (const [t, a] of acc) {
      const realm = s.realms.get(t);
      if (!realm || a.n < 2) continue;
      labels.push({ text: realm.name, x: a.x / a.n, y: a.y / a.n, size: Math.min(26, 8 + Math.sqrt(a.n) * 3.2) });
    }
    renderer.setLabels(labels);
    const me = s.update?.player?.realm ?? -1;
    const caps: { x: number; y: number; color: number; mine: boolean }[] = [];
    for (const r of s.realms.values()) {
      if (r.landless || r.capital < 0) continue;
      caps.push({ x: ready.map.anchorX[r.capital], y: ready.map.anchorY[r.capital], color: r.color, mine: r.id === me });
    }
    renderer.setCapitals(caps);
    renderer.setForts(s.fort);
  }, [inited, mapVersion, realmsVersion, ready, update?.player?.realm]);

  // Armies follow every update.
  useEffect(() => {
    if (!renderer || !update) return;
    const s = store.state;
    const me = update.player?.realm ?? -1;
    renderer.setArmies(update.armies, (r) => s.realms.get(r)?.color ?? 0x333333, (r) => r === me, selectedArmy);
    renderer.setBattles(
      update.battles.map((b) => b.loc),
      new Set(update.battles.filter((b) => b.playerSide).map((b) => b.loc)),
    );
  }, [update, inited, selectedArmy]);

  // Route of the selected army.
  useEffect(() => {
    if (!renderer) return;
    if (selectedArmy < 0) {
      renderer.setRoute(null, []);
      return;
    }
    let live = true;
    sim.detail('army', selectedArmy).then((d) => {
      if (!live || !renderer) return;
      if (!d) {
        renderer.setRoute(null, []);
        select(null);
        return;
      }
      renderer.setRoute(renderer.armyPos(d.id), d.route);
    });
    return () => {
      live = false;
    };
  }, [update, inited, selectedArmy]);

  const s = store.state;
  const hp = hover?.p ?? -1;
  const hoverOwner = hp >= 0 ? s.owner[hp] : -1;
  return (
    <div className="map-host" ref={host}>
      {hover && ready && (
        <div className="map-tip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          <b>{ready.provinceNames[hp]}</b>
          <span>{ready.regions[ready.map.region[hp]]?.name}</span>
          {hoverOwner >= 0 && <span>{s.realms.get(hoverOwner)?.name}{topRealm(hoverOwner) !== hoverOwner ? ` (under ${s.realms.get(topRealm(hoverOwner))?.name})` : ''}</span>}
          {s.occupier[hp] >= 0 && <span className="bad">Occupied by {s.realms.get(s.occupier[hp])?.name}</span>}
        </div>
      )}
    </div>
  );
}
