import { useEffect, useState } from 'react';
import { SCENARIOS } from '../sim/data';
import { sim, store, toast, useStore } from './store';
import { focusProvince } from './MapView';
import { deleteSave, downloadSave, listSaves, pickFile, type SaveSlot } from './saves';

export function loadBuffer(buffer: ArrayBuffer, scenario = 'west'): void {
  store.set({ phase: 'loading' });
  sim.send({ type: 'load', scenario, buffer }, [buffer]);
}

export function TitleScreen() {
  const [saves, setSaves] = useState<SaveSlot[]>([]);
  const [scenario, setScenario] = useState('west');
  useEffect(() => {
    listSaves().then(setSaves, () => setSaves([]));
  }, []);

  const start = () => {
    store.set({ phase: 'loading' });
    sim.send({ type: 'newGame', scenario, seed: (Math.random() * 2 ** 31) | 0 });
  };

  return (
    <div className="title-screen">
      <div className="title-card">
        <h1>Ashes &amp; Iron</h1>
        <p className="subtitle">Dynasties at the end of the Bronze Age</p>
        <h3>Scenario</h3>
        <div className="scenarios">
          {SCENARIOS.map((s) => (
            <button key={s.id} className={`scenario ${scenario === s.id ? 'active' : ''}`} disabled={!s.available} onClick={() => setScenario(s.id)}>
              <b>{s.name}</b>
              <span>{s.subtitle}</span>
              {!s.available && <small>Coming later</small>}
            </button>
          ))}
        </div>
        <button className="primary big" onClick={start}>
          New game
        </button>
        <h3>Continue</h3>
        {saves.length === 0 && <p className="muted">No saved games yet.</p>}
        <ul className="save-list">
          {saves.map((s) => (
            <li key={s.name}>
              <button className="link" onClick={() => loadBuffer(s.buffer.slice(0), s.scenario)}>
                <b>{s.name}</b> <span className="muted">{s.realm} · {s.date}</span>
              </button>
              <button className="icon" title="Export to file" onClick={() => downloadSave(s)}>⇩</button>
              <button
                className="icon"
                title="Delete"
                onClick={() => {
                  if (!confirm(`Delete save "${s.name}"?`)) return;
                  deleteSave(s.name).then(() => listSaves().then(setSaves));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={async () => {
            const buf = await pickFile();
            if (buf) loadBuffer(buf);
            else toast('No file chosen.', false);
          }}
        >
          Import save file…
        </button>
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="title-screen">
      <div className="loading">Shaping the world…</div>
    </div>
  );
}

export function PickScreen() {
  const ready = useStore((s) => s.ready);
  const pick = useStore((s) => s.pickRealm);
  const realms = useStore((s) => s.realms);
  if (!ready) return null;
  const chosen = pick >= 0 ? realms.get(pick) : undefined;
  const featured = ready.featured.find((f) => f.realm === pick);
  return (
    <div className="pick-panel">
      <h2>{ready.scenarioName}</h2>
      <p className="muted">{ready.scenarioDescription}</p>
      <h3>Featured rulers</h3>
      <div className="featured">
        {ready.featured.map((f) => (
          <button key={f.realm} className={pick === f.realm ? 'active' : ''} onClick={() => {
              const cap = realms.get(f.realm)?.capital ?? -1;
              store.set({ pickRealm: f.realm, selectedProvince: cap });
              if (cap >= 0) focusProvince(cap);
            }}>
            <b>{f.name}</b>
            <small>{f.culture}</small>
          </button>
        ))}
      </div>
      <p className="muted small">Or click any realm on the map.</p>
      {chosen && (
        <div className="pick-detail">
          <h3 style={{ color: `#${chosen.color.toString(16).padStart(6, '0')}` }}>{chosen.name}</h3>
          <p>
            Ruled by <b>{chosen.rulerName}</b>. {chosen.provinces} province{chosen.provinces === 1 ? '' : 's'}.
          </p>
          {featured && <p className="pitch">{featured.pitch}</p>}
          {chosen.landless && <p className="bad">A landless band: you will have to win land by the sword.</p>}
          <button
            className="primary big"
            onClick={() => {
              sim.send({ type: 'start', realm: chosen.id });
              if (chosen.capital >= 0) focusProvince(chosen.capital);
              store.set({ phase: 'playing', selection: { kind: 'realm', id: chosen.id }, selectedProvince: -1 });
            }}
          >
            Play as {chosen.name}
          </button>
        </div>
      )}
      <button className="link" onClick={() => store.set({ phase: 'title', ready: null })}>
        ← Back
      </button>
    </div>
  );
}
