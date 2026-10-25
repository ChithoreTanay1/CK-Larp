import { useEffect, useRef, useState } from 'react';
import { select, setSpeed, sim, store, toast, togglePause, useStore, type MapMode } from './store';
import { listSaves, putSave, downloadSave } from './saves';
import { focusProvince } from './MapView';

const fmt = (n: number) => (Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(0)}k` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

const MODES: { id: MapMode; label: string }[] = [
  { id: 'political', label: 'Political' },
  { id: 'realms', label: 'Vassals' },
  { id: 'culture', label: 'Culture' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'famine', label: 'Famine' },
  { id: 'drought', label: 'Drought' },
  { id: 'raiderPressure', label: 'Raiders' },
  { id: 'tradeHealth', label: 'Trade' },
  { id: 'ironAdoption', label: 'Iron' },
];

export async function quickSave(name?: string): Promise<void> {
  const { buffer, meta } = await sim.save();
  const slot = { name: name ?? `${meta.realm} — ${meta.date}`, scenario: 'west', ...meta, savedAt: Date.now(), size: buffer.byteLength, buffer };
  await putSave(slot);
  toast(`Saved "${slot.name}" (${(buffer.byteLength / 1024).toFixed(0)} KB).`);
}

export function TopBar() {
  const update = useStore((s) => s.update);
  const speed = useStore((s) => s.speed);
  const mode = useStore((s) => s.mapMode);
  const [menu, setMenu] = useState(false);
  const p = update?.player;
  return (
    <div className="top-bar">
      <div className="date-block">
        <div className="date">{update?.date ?? ''}</div>
        <div className="speeds">
          <button className={speed === 0 ? 'active' : ''} onClick={togglePause} title="Pause (Space)">
            {speed === 0 ? '▶' : '❚❚'}
          </button>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={speed === n ? 'active' : ''} onClick={() => setSpeed(n)} title={`Speed ${n} (key ${n})`}>
              {'›'.repeat(n > 3 ? 3 : n)}
              {n > 3 ? n : ''}
            </button>
          ))}
        </div>
      </div>
      {p && (
        <button className="realm-chip" onClick={() => select({ kind: 'realm', id: p.realm })}>
          <b>{p.realmName}</b>
          <span>{p.ruler.name}, {p.ruler.age}</span>
        </button>
      )}
      {p && (
        <div className="resources">
          <Res icon="🌾" label="Grain" v={p.grain} />
          <Res icon="🐂" label="Cattle" v={p.cattle} />
          <Res icon="⚒" label="Metal" v={p.metal} />
          <Res icon="⚖" label="Trade goods" v={p.trade} />
          <Res icon="✦" label="Prestige" v={p.prestige} />
          <Res icon="⚑" label="Stability" v={p.stability} warn={p.stability < 30} />
          <Res icon="⚔" label={`Levy (manpower ${fmt(p.manpower)})`} v={p.levy} />
        </div>
      )}
      <div className="modes">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => store.set({ mapMode: m.id })}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="menu-wrap">
        <button onClick={() => setMenu((x) => !x)}>☰</button>
        {menu && <GameMenu close={() => setMenu(false)} />}
      </div>
    </div>
  );
}

function Res({ icon, label, v, warn }: { icon: string; label: string; v: number; warn?: boolean }) {
  return (
    <div className={`res ${warn || v < 0 ? 'bad' : ''}`} title={label}>
      <span className="ico">{icon}</span>
      {fmt(v)}
    </div>
  );
}

function GameMenu({ close }: { close: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="game-menu" onMouseLeave={close}>
      <input placeholder="Save name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <button
        onClick={() => {
          quickSave(name || undefined).catch((e: Error) => toast(`Save failed: ${e.message}`, false));
          close();
        }}
      >
        Save game
      </button>
      <button
        onClick={async () => {
          const all = await listSaves();
          if (all[0]) downloadSave(all[0]);
          else toast('Save first, then export.', false);
          close();
        }}
      >
        Export latest save
      </button>
      <button onClick={() => store.set({ showDebug: !store.state.showDebug })}>Toggle debug overlay (F3)</button>
      <button
        onClick={() => {
          if (!confirm('Leave this game? Unsaved progress is lost.')) return;
          setSpeed(0);
          store.set({ phase: 'title', ready: null, update: null, log: [], selection: null });
        }}
      >
        Quit to title
      </button>
    </div>
  );
}

const ROW = 34;

/** Virtualized event log: only visible rows are rendered. */
export function LogPanel() {
  const log = useStore((s) => s.log);
  const startYear = useStore((s) => (s.update ? s.update.yearBce + Math.floor(s.update.day / 360) : 0));
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(200);
  const [open, setOpen] = useState(true);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.clientHeight);
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [log, open]);
  const first = Math.max(0, Math.floor(scroll / ROW) - 4);
  const last = Math.min(log.length, Math.ceil((scroll + height) / ROW) + 4);
  return (
    <div className={`log-panel ${open ? '' : 'closed'}`}>
      <div className="log-head" onClick={() => setOpen((o) => !o)}>
        Chronicle <span className="muted">{log.length}</span>
      </div>
      {open && (
        <div
          className="log-scroll"
          ref={ref}
          onScroll={(e) => {
            const el = e.currentTarget;
            setScroll(el.scrollTop);
            stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW;
          }}
        >
          <div style={{ height: log.length * ROW, position: 'relative' }}>
            {log.slice(first, last).map((e, i) => (
              <div
                key={first + i}
                className={`log-row ${e.kind}`}
                style={{ top: (first + i) * ROW }}
                title={e.text}
                onClick={() => {
                  if (e.prov !== undefined && e.prov >= 0) {
                    focusProvince(e.prov);
                    select({ kind: 'province', id: e.prov });
                  }
                }}
              >
                <span className="log-year">{startYear ? startYear - Math.floor(e.day / 360) : ''}</span>
                {e.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Toast() {
  const t = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!t) return;
    setVisible(true);
    const h = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(h);
  }, [t]);
  if (!t || !visible) return null;
  return <div className={`toast ${t.ok ? '' : 'bad'}`}>{t.text}</div>;
}

export function ChoiceModal() {
  const choice = useStore((s) => s.update?.choice ?? null);
  const queued = useStore((s) => s.update?.queued ?? 0);
  if (!choice) return null;
  return (
    <div className="modal-back">
      <div className={`modal choice ${choice.kind}`}>
        <div className="modal-kicker">{choice.kind === 'proposal' ? 'An envoy arrives' : 'Event'}{queued > 1 ? ` · ${queued - 1} more waiting` : ''}</div>
        <h2>{choice.title}</h2>
        <p className="event-text">{choice.text}</p>
        <div className="options">
          {choice.options.map((o, i) => (
            <button key={i} onClick={() => sim.command({ c: 'choice', uid: choice.uid, option: i })} title={o.tooltip}>
              <b>{o.label}</b>
              {o.tooltip && <small>{o.tooltip}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GameOver() {
  const over = useStore((s) => s.update?.gameOver ?? '');
  if (!over) return null;
  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-kicker">The end of a line</div>
        <h2>Your dynasty has fallen</h2>
        <p className="event-text">{over}</p>
        <div className="options">
          <button onClick={() => store.set({ phase: 'title', ready: null, update: null, log: [], selection: null })}>
            <b>Return to the title screen</b>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Debug overlay: sim timings, entity counts, render stats, and the fire-event dev tool. */
export function DebugOverlay() {
  const show = useStore((s) => s.showDebug);
  const stats = useStore((s) => s.update?.stats);
  const frame = useStore((s) => s.frame);
  const ready = useStore((s) => s.ready);
  const [ev, setEv] = useState('');
  const [days, setDays] = useState(30);
  if (!show || !stats) return null;
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  return (
    <div className="debug">
      <div className="debug-title">Debug</div>
      <table>
        <tbody>
          <tr><td>Day ms (last/avg/max)</td><td>{stats.lastDayMs.toFixed(2)} / {stats.avgDayMs.toFixed(3)} / {stats.maxDayMs.toFixed(2)}</td></tr>
          <tr><td>Month ms (last/max)</td><td>{stats.lastMonthMs.toFixed(2)} / {stats.maxMonthMs.toFixed(2)}</td></tr>
          <tr><td>Year ms</td><td>{stats.lastYearMs.toFixed(2)}</td></tr>
          <tr><td>Days/sec</td><td>{stats.daysPerSec.toFixed(1)}</td></tr>
          <tr><td>Characters (alive/total)</td><td>{stats.chars} / {stats.charsTotal}</td></tr>
          <tr><td>Realms · armies · wars</td><td>{stats.realms} · {stats.armies} · {stats.wars}</td></tr>
          <tr><td>Map frame ms · fps</td><td>{frame.renderMs.toFixed(2)} · {frame.fps}</td></tr>
          {heap !== undefined && <tr><td>UI heap</td><td>{(heap / 1048576).toFixed(1)} MB</td></tr>}
        </tbody>
      </table>
      <div className="debug-row">
        <input list="event-ids" placeholder="event id" value={ev} onChange={(e) => setEv(e.target.value)} />
        <datalist id="event-ids">{ready?.events.map((id) => <option key={id} value={id} />)}</datalist>
        <button onClick={() => ev && sim.send({ type: 'devFire', id: ev })}>Fire</button>
      </div>
      <div className="debug-row">
        <input type="number" value={days} min={1} max={3600} onChange={(e) => setDays(+e.target.value)} />
        <button onClick={() => sim.send({ type: 'step', days })}>Step days</button>
      </div>
    </div>
  );
}

/** Global keyboard shortcuts. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (store.state.phase !== 'playing') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (e.key >= '1' && e.key <= '5') setSpeed(+e.key);
      else if (e.key === 'F3' || e.key === '`') {
        e.preventDefault();
        store.set({ showDebug: !store.state.showDebug });
      } else if (e.key === 'a' || e.key === 'A') {
        cycleArmy();
      } else if (e.key === 'Escape') {
        select(null);
      } else if (e.key === 'F5') {
        e.preventDefault();
        quickSave().catch((err: Error) => toast(`Save failed: ${err.message}`, false));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const UNIT_ICON = ['↑', '➶', '•', '⛨', '☸'];

/** Quick access to every army we have in the field. */
export function ArmiesStrip() {
  const armies = useStore((s) => s.update?.armies);
  const me = useStore((s) => s.update?.player?.realm ?? -1);
  const selected = useStore((s) => s.selectedArmy);
  const mine = (armies ?? []).filter((a) => a.kind === 0 && a.realm === me);
  if (!mine.length) return null;
  return (
    <div className="armies-strip">
      {mine.map((a) => (
        <button
          key={a.id}
          className={`army-chip ${a.id === selected ? 'active' : ''} ${a.sieging ? 'sieging' : ''}`}
          title={`${a.units.map((n, u) => (n ? `${UNIT_ICON[u]} ${n}` : '')).filter(Boolean).join('  ')}${a.manual ? '' : ' · generals command'}`}
          onClick={() => {
            select({ kind: 'army', id: a.id });
            focusProvince(a.loc);
          }}
        >
          <span>{UNIT_ICON[a.main]}</span> {a.men >= 1000 ? `${(a.men / 1000).toFixed(1)}k` : a.men}
          {a.next >= 0 && <span className="muted"> →</span>}
        </button>
      ))}
    </div>
  );
}

/** Select the next of our armies (key A). */
function cycleArmy(): void {
  const s = store.state;
  const me = s.update?.player?.realm ?? -1;
  const mine = (s.update?.armies ?? []).filter((a) => a.kind === 0 && a.realm === me);
  if (!mine.length) return;
  const i = mine.findIndex((a) => a.id === s.selectedArmy);
  const next = mine[(i + 1) % mine.length];
  select({ kind: 'army', id: next.id });
  focusProvince(next.loc);
}
