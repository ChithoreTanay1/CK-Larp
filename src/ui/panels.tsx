import { useEffect, useState } from 'react';
import type { ArmyDetail, ArmyInfo, CharBrief, CharDetail, ProvDetail, RealmDetail } from '../sim/snapshot';
import { UNITS } from '../sim/units';
import type { Command } from '../sim/commands';
import { select, sim, store, useStore } from './store';
import { focusProvince } from './MapView';

const SKILLS = ['Martial', 'Diplomacy', 'Stewardship', 'Intrigue', 'Learning'];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const r1 = (n: number) => Math.round(n);

/** Fetch a detail object from the worker; refetch after commands and as days pass. */
function useDetail<T>(what: 'char' | 'realm' | 'province' | 'army', id: number): T | null {
  const version = useStore((s) => s.detailVersion);
  // Refetch roughly every in-game week while the game runs.
  const week = useStore((s) => (s.update ? Math.floor(s.update.day / 7) : 0));
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    (sim.detail as (w: string, id: number) => Promise<unknown>)(what, id).then((d) => live && setData(d as T));
    return () => {
      live = false;
    };
  }, [what, id, version, week]);
  return data;
}

const run = (cmd: Command) => sim.command(cmd);

function CharLink({ c }: { c: CharBrief | null }) {
  if (!c) return <span className="muted">—</span>;
  return (
    <button className={`link char ${c.alive ? '' : 'dead'}`} onClick={() => select({ kind: 'char', id: c.id })}>
      {c.name}
      <span className="muted"> {c.alive ? c.age : '†'}</span>
    </button>
  );
}

function RealmLink({ id, name }: { id: number; name: string }) {
  return (
    <button className="link" onClick={() => select({ kind: 'realm', id })}>
      {name}
    </button>
  );
}

export function SidePanel() {
  const sel = useStore((s) => s.selection);
  const phase = useStore((s) => s.phase);
  if (phase !== 'playing' || !sel) return null;
  return (
    <div className="side-panel">
      <button className="close" onClick={() => select(null)}>✕</button>
      {sel.kind === 'province' && <ProvincePanel id={sel.id} />}
      {sel.kind === 'realm' && <RealmPanel id={sel.id} />}
      {sel.kind === 'char' && <CharPanel id={sel.id} />}
      {sel.kind === 'army' && <ArmyPanel id={sel.id} />}
    </div>
  );
}

function ProvincePanel({ id }: { id: number }) {
  const d = useDetail<ProvDetail>('province', id);
  const me = useStore((s) => s.update?.player?.realm ?? -1);
  const raidMonths = useStore((s) => s.update?.player?.raidReadyMonths ?? 0);
  if (!d) return null;
  const mine = d.topOwner && me >= 0 && d.topOwner.id === store.state.update?.player?.realm;
  return (
    <div>
      <div className="kicker">{d.region} · {d.terrain}{d.coastal ? ' · coast' : ''}</div>
      <h2>{d.name}</h2>
      {d.owner && (
        <p>
          Held by <RealmLink id={d.owner.id} name={d.owner.name} />
          {d.topOwner && d.topOwner.id !== d.owner.id && (
            <>
              , vassal of <RealmLink id={d.topOwner.id} name={d.topOwner.name} />
            </>
          )}
        </p>
      )}
      {d.occupier && <p className="bad">Occupied by {d.occupier.name}</p>}
      <div className="stats-grid">
        <Stat k="Population" v={`${(d.pop * 1000).toFixed(0)}`} />
        <Stat k="Development" v={d.develop} />
        <Stat k="Grain/mo" v={d.grain.toFixed(1)} />
        <Stat k="Cattle/mo" v={d.cattle.toFixed(1)} />
        <Stat k="Ore" v={d.ore} />
        <Stat k="Trade" v={d.trade} />
        <Stat k="Unrest" v={`${r1(d.unrest)}%`} bad={d.unrest > 50} />
        <Stat k="Raided" v={d.raided ? `${d.raided} mo` : 'no'} bad={d.raided > 0} />
      </div>
      {me >= 0 && !mine && d.owner && (
        <div className="actions">
          <button onClick={() => run({ c: 'raid', target: id })} disabled={raidMonths > 0} title={raidMonths ? `Raiders ready in ${raidMonths} months` : `${d.daysFromCapital} days from our capital`}>
            Raid {raidMonths ? `(${raidMonths} mo)` : ''}
          </button>
          <button onClick={() => run({ c: 'declareWar', target: id, kind: 'conquest' })}>Conquest war</button>
          <button onClick={() => run({ c: 'declareWar', target: id, kind: 'subjugation' })}>Subjugation war</button>
        </div>
      )}
      {mine && !d.occupier && (
        <div className="actions">
          <button onClick={() => run({ c: 'raiseArmy', at: id }).then(selectCreated)}>Raise levy here</button>
        </div>
      )}
      <h4>Walls</h4>
      <p className="small">
        <span className="fort-tag">{FORT_NAMES[d.fort]}</span>
        {d.fortBuild > 0 && <> · builders at work, {d.fortBuild} months left</>}
        <br />
        <span className="muted">
          To besiege: at least {d.siegeMen} men, {d.siegeNeed} days of siege work at full pace (walls slow every day). Garrison strength {d.garrison}.
        </span>
      </p>
      {d.owner && d.owner.id === me && !d.occupier && d.fort < 3 && !d.fortBuild && (
        <div className="actions">
          <button onClick={() => run({ c: 'buildFort', prov: id })} title={`${d.fortCost.trade} trade goods, ${d.fortCost.metal} metal, ${d.fortCost.months} months`}>
            {d.fort ? 'Raise the walls' : 'Build walls'} ({d.fortCost.trade} trade, {d.fortCost.metal} metal, {d.fortCost.months} mo)
          </button>
        </div>
      )}
      <h4>Neighbours</h4>
      <div className="chips">
        {d.neighbors.map((n) => (
          <button
            key={n.id}
            className="chip"
            onClick={() => {
              focusProvince(n.id);
              select({ kind: 'province', id: n.id });
            }}
          >
            {n.sea ? '⛵ ' : ''}
            {n.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ k, v, bad }: { k: string; v: string | number; bad?: boolean }) {
  return (
    <div className={`stat ${bad ? 'bad' : ''}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function RealmPanel({ id }: { id: number }) {
  const d = useDetail<RealmDetail>('realm', id);
  const [mine, setMine] = useState(-1);
  const [theirs, setTheirs] = useState(-1);
  if (!d) return <p className="muted">This realm is no more.</p>;
  const realms = store.state.realms;
  const color = realms.get(id)?.color ?? 0x888888;
  return (
    <div>
      <div className="kicker">{d.culture} · {d.law}{d.landless ? ' · landless' : ''}</div>
      <h2 style={{ borderLeft: `6px solid ${hex(color)}`, paddingLeft: 8 }}>{d.name}</h2>
      <p>
        Ruler: <CharLink c={d.ruler} />
        <br />
        Heir: <CharLink c={d.heir} />
      </p>
      {d.liege && (
        <p>
          Vassal of <RealmLink id={d.liege.id} name={d.liege.name} />
        </p>
      )}
      <div className="stats-grid">
        <Stat k="Provinces" v={d.provinces} />
        <Stat k="Levy" v={d.levy} />
        <Stat k="Strength" v={d.strength} />
        <Stat k="Stability" v={r1(d.stability)} bad={d.stability < 30} />
        <Stat k="Prestige" v={r1(d.prestige)} />
        <Stat k="Grain" v={r1(d.grain)} />
        <Stat k="Trade" v={r1(d.trade)} />
        <Stat k="Metal" v={r1(d.metal)} />
      </div>
      {!d.isPlayer && (
        <>
          <h4>Relations</h4>
          <p className="small">
            They think of us: <b className={d.opinionOfPlayer < 0 ? 'bad' : 'good'}>{d.opinionOfPlayer}</b> · Our strength {d.playerStrength} vs theirs {d.strength}
            {d.allied && <> · <span className="good">Allied</span></>}
            {d.married && <> · Kin by marriage</>}
            {d.hostile && <> · <span className="bad">At war</span></>}
            {d.truceYears > 0 && <> · Truce {d.truceYears.toFixed(1)}y</>}
          </p>
          {!d.playerTop && (
            <div className="actions">
              <button disabled={d.allied} onClick={() => run({ c: 'propose', type: 'alliance', realm: id })} title={d.verdicts.alliance}>
                Propose alliance {d.verdicts.allianceOk ? '✓' : ''}
              </button>
              <button onClick={() => run({ c: 'propose', type: 'vassal', realm: id })} title={d.verdicts.vassal}>
                Demand fealty {d.verdicts.vassalOk ? '✓' : ''}
              </button>
              <button onClick={() => run({ c: 'propose', type: 'hostage', realm: id })} title={d.verdicts.hostage}>
                Demand hostage {d.verdicts.hostageOk ? '✓' : ''}
              </button>
              <button onClick={() => run({ c: 'gift', realm: id })} title="25 trade goods">Send gifts</button>
              {d.allied && <button onClick={() => run({ c: 'breakAlliance', realm: id })}>Break alliance</button>}
              {d.ruler && <button onClick={() => run({ c: 'plot', target: d.ruler!.id, kind: 'murder' })} title="20 trade goods in bribes">Plot murder of ruler</button>}
            </div>
          )}
          {d.playerTop && d.liege && d.liege.id !== store.state.update?.player?.realm && <p className="muted small">Part of our own realm.</p>}
          {d.eligible.length > 0 && d.myEligible.length > 0 && (
            <>
              <h4>Arrange a marriage</h4>
              <div className="marry">
                <select value={mine} onChange={(e) => setMine(+e.target.value)}>
                  <option value={-1}>Our side…</option>
                  {d.myEligible.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.female ? 'F' : 'M'} {c.age})</option>
                  ))}
                </select>
                <select value={theirs} onChange={(e) => setTheirs(+e.target.value)}>
                  <option value={-1}>Their side…</option>
                  {d.eligible.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.female ? 'F' : 'M'} {c.age})</option>
                  ))}
                </select>
                <button disabled={mine < 0 || theirs < 0} onClick={() => run({ c: 'marry', mine, theirs, realm: id })}>Propose</button>
              </div>
            </>
          )}
        </>
      )}
      {d.isPlayer && <MyRealm />}
      {d.vassals.length > 0 && (
        <>
          <h4>Vassals</h4>
          <ul className="plain">
            {d.vassals.map((v) => (
              <li key={v.id}>
                <RealmLink id={v.id} name={v.name} /> <span className={v.loyalty < 30 ? 'bad' : 'muted'}>loyalty {v.loyalty}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The player's own realm: wars, army, vassals, plots, hostages, court actions. */
function MyRealm() {
  const p = useStore((s) => s.update?.player ?? null);
  const wars = useStore((s) => s.update?.wars);
  const armies = useStore((s) => s.update?.armies);
  if (!p) return null;
  const myWars = (wars ?? []).filter((w) => w.side !== 0);
  const myArmies = (armies ?? []).filter((a) => a.kind === 0 && a.realm === p.realm);
  return (
    <div className="my-realm">
      <h4>Court</h4>
      <div className="actions">
        <button onClick={() => run({ c: 'endowTemple' })} title="30 trade goods: +stability, +prestige">Endow temple</button>
        <button onClick={() => run({ c: 'feast' })} title="25 grain: +vassal loyalty">Hold a feast</button>
        {p.liege >= 0 && <button onClick={() => run({ c: 'rebel' })}>Declare independence</button>}
      </div>
      {p.liege >= 0 && (
        <p className="small">
          We serve {store.state.realms.get(p.liege)?.name}. Our loyalty: {r1(p.loyalty)}
        </p>
      )}
      <h4>Armies</h4>
      <p className="small muted">
        In the field: {r1(p.fielded)} men · levy left {r1(p.availableLevy)} · paid retinue {r1(p.retinueCap - p.availableRetinue)}/{r1(p.retinueCap)}
      </p>
      {myArmies.map((a) => (
        <ArmyRow key={a.id} a={a} />
      ))}
      <div className="actions">
        <button disabled={p.availableLevy < 80} onClick={() => run({ c: 'raiseArmy' })} title="Spearmen, bowmen and slingers from the farms, gathered at the capital">
          Raise levy at capital ({r1(p.availableLevy)})
        </button>
        <button disabled={p.availableLevy < 160} onClick={() => run({ c: 'raiseArmy', men: p.availableLevy / 2 })}>
          Raise half
        </button>
      </div>
      <h4>Wars</h4>
      {myWars.length === 0 && <p className="muted small">At peace.</p>}
      {myWars.map((w) => {
        const ours = w.side === 1 ? w.score : -w.score;
        return (
          <div key={w.id} className="war">
            <b>{w.name}</b>
            <div className="score-bar">
              <div style={{ width: `${50 + ours / 2}%` }} className={ours >= 0 ? 'good-bg' : 'bad-bg'} />
            </div>
            <span className="small">War score {r1(ours)}% · {w.months} months</span>
            {w.leader && (
              <div className="actions">
                <button onClick={() => run({ c: 'peace', war: w.id, mode: 'demand' })}>Demand terms</button>
                <button onClick={() => run({ c: 'peace', war: w.id, mode: 'white' })}>Offer white peace</button>
                <button onClick={() => confirm('Surrender this war?') && run({ c: 'peace', war: w.id, mode: 'surrender' })}>Surrender</button>
              </div>
            )}
          </div>
        );
      })}
      {p.allies.length > 0 && (
        <>
          <h4>Allies</h4>
          <div className="chips">
            {p.allies.map((a) => (
              <button key={a} className="chip" onClick={() => select({ kind: 'realm', id: a })}>
                {store.state.realms.get(a)?.name}
              </button>
            ))}
          </div>
        </>
      )}
      {p.plots.length > 0 && (
        <>
          <h4>Plots</h4>
          {p.plots.map((pl) => (
            <div key={pl.id} className="small">
              {pl.kind} {pl.target}: {r1(pl.progress)}% done, secrecy {r1(pl.secrecy)}
            </div>
          ))}
        </>
      )}
      {p.hostages.length > 0 && (
        <>
          <h4>Hostages at our court</h4>
          {p.hostages.map((h) => (
            <div key={h.id} className="small">
              <CharLink c={h} /> <button className="link" onClick={() => run({ c: 'releaseHostage', char: h.id })}>release</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CharPanel({ id }: { id: number }) {
  const d = useDetail<CharDetail>('char', id);
  const ready = useStore((s) => s.ready);
  if (!d || !ready) return null;
  return (
    <div>
      <div className="kicker">{d.dynasty} · {d.culture}</div>
      <h2 className={d.alive ? '' : 'dead'}>{d.name}</h2>
      <p>
        {d.alive ? `Age ${d.age}` : d.death}
        {d.rulesName && <> · Ruler of <b>{d.rulesName}</b></>}
        {d.realm && !d.rulesName && <> · at the court of <RealmLink id={d.realm.id} name={d.realm.name} /></>}
        {d.hostageAt && <> · <span className="bad">hostage at {d.hostageAt}</span></>}
      </p>
      <div className="traits">
        {d.traits.map((t) => (
          <span key={t} className={`trait ${ready.traits[t].kind}`} title={ready.traits[t].desc}>
            {ready.traits[t].name}
          </span>
        ))}
      </div>
      <div className="stats-grid">
        {SKILLS.map((s, i) => (
          <Stat key={s} k={s} v={d.skills[i]} />
        ))}
        <Stat k="Health" v={Math.round(d.health)} bad={d.health < 25} />
      </div>
      <h4>Family</h4>
      <FamilyTree d={d} />
      {d.canPlot && d.alive && !d.isPlayerFamily && (
        <div className="actions">
          <button onClick={() => run({ c: 'plot', target: d.id, kind: 'murder' })} title="20 trade goods">Plot murder</button>
          <button onClick={() => run({ c: 'plot', target: d.id, kind: 'usurp' })} title="Only against your own liege">Plot usurpation</button>
        </div>
      )}
    </div>
  );
}

function FamilyTree({ d }: { d: CharDetail }) {
  return (
    <div className="tree">
      <div className="tree-row">
        <CharLink c={d.father} />
        <span className="muted">&amp;</span>
        <CharLink c={d.mother} />
      </div>
      <div className="tree-line" />
      <div className="tree-row self">
        <b>{d.name}</b>
        {d.spouse && (
          <>
            <span className="muted">⚭</span>
            <CharLink c={d.spouse} />
          </>
        )}
      </div>
      {d.siblings.length > 0 && (
        <div className="tree-sub">
          <span className="muted">Siblings: </span>
          {d.siblings.map((s) => (
            <CharLink key={s.id} c={s} />
          ))}
        </div>
      )}
      {d.children.length > 0 && (
        <>
          <div className="tree-line" />
          <div className="tree-row children">
            {d.children.map((c) => (
              <CharLink key={c.id} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const UNIT_ICON = ['↑', '➶', '•', '⛨', '☸'];
const FORT_NAMES = ['No walls', 'Palisade (fort 1)', 'Stone walls (fort 2)', 'Citadel (fort 3)'];
const pct = (n: number) => `${Math.round(n * 100)}%`;

function selectCreated(r: { ok: boolean; id?: number }): void {
  if (r.ok && r.id !== undefined) select({ kind: 'army', id: r.id });
}

function costText(u: number, men: number): string {
  const t = UNITS[u], k = men / 100;
  const parts = [t.costMetal && `${Math.round(t.costMetal * k)} metal`, t.costTrade && `${Math.round(t.costTrade * k)} trade`, t.costCattle && `${Math.round(t.costCattle * k)} cattle`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'free';
}

/** One line per army in the realm panel. */
function ArmyRow({ a }: { a: ArmyInfo }) {
  const names = store.state.ready?.provinceNames ?? [];
  return (
    <div className="army-row" onClick={() => select({ kind: 'army', id: a.id })}>
      <span className="army-ico">{UNIT_ICON[a.main]}</span>
      <b>{a.men}</b>
      <span className="muted">
        {names[a.loc]}
        {a.dest !== a.loc ? ` → ${names[a.dest]}` : ''}
        {a.sieging ? ' · besieging' : ''}
        {a.manual ? '' : ' · generals'}
      </span>
    </div>
  );
}

/** One of the player's armies: composition, orders, recruitment, commander. */
function ArmyPanel({ id }: { id: number }) {
  const d = useDetail<ArmyDetail>('army', id);
  const p = useStore((s) => s.update?.player ?? null);
  const [amount, setAmount] = useState(100);
  if (!d || !p) return <p className="muted">This army is no more.</p>;
  const mine = d.realm === p.realm && d.kind === 0;
  const realm = store.state.realms.get(d.realm);
  const halves = d.units.map((n) => Math.floor(n / 2));
  return (
    <div>
      <div className="kicker">
        {realm?.name} · {d.kind === 0 ? 'army' : d.kind === 1 ? 'raiders' : 'sea raiders'}
      </div>
      <h2>
        <span className="army-ico big">{UNIT_ICON[d.main]}</span> {d.men} men
      </h2>
      <p className="small">
        At <b>{d.locName}</b>
        {d.dest !== d.loc || d.next >= 0 ? (
          <>
            , marching to <b>{d.destName}</b> ({d.daysLeft} days)
          </>
        ) : (
          ', standing'
        )}
        {d.sieging && <> · siege {pct(d.siege)}</>}
      </p>
      {d.next < 0 && !['not besieging', 'not at war with the owner', 'already taken'].includes(d.siegeBlock) && (
        <div className="siege-box">
          <b>Siege of {d.locName}</b> <span className="fort-tag">{FORT_NAMES[d.fort]}</span>
          {d.siegeBlock ? (
            <div className="bad small">No progress: {d.siegeBlock}.</div>
          ) : (
            <>
              <div className="score-bar">
                <div className="good-bg" style={{ width: pct(d.siege) }} />
              </div>
              <div className="small">
                {pct(d.siege)} done · about {d.siegeDays} more days{d.fort > 0 ? ' · the camps lose men to sickness and sallies' : ''}
              </div>
              {mine && (
                <div className="actions">
                  <button onClick={() => run({ c: 'assault', army: id })} title="Storm the walls now. Bloody either way; easier the longer the siege has run. Bronze warriors climb best, chariots not at all.">
                    Storm the walls ({pct(d.assaultOdds)} chance)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="stats-grid">
        <Stat k="Strength" v={d.power} />
        <Stat k="Morale" v={pct(d.morale)} bad={d.morale < 0.5} />
        <Stat k="Equipment" v={pct(d.quality)} bad={d.quality < 0.6} />
        <Stat k="Pace" v={d.pace <= 0.85 ? 'fast' : d.pace >= 1.1 ? 'slow' : 'normal'} />
      </div>

      <h4>Troops</h4>
      <table className="troops">
        <tbody>
          {UNITS.map((t, u) => (
            <tr key={t.id} title={t.desc}>
              <td className="army-ico">{UNIT_ICON[u]}</td>
              <td>{t.name}</td>
              <td className="num">{d.units[u]}</td>
              <td className="bar-cell">
                <div className="unit-bar" style={{ width: pct(d.units[u] / Math.max(1, d.men)) }} />
              </td>
              {mine && (
                <td className="row-actions">
                  <button
                    className="mini"
                    disabled={!d.inOwnLand || d.next >= 0}
                    title={`Recruit ${amount} ${t.name.toLowerCase()}: ${costText(u, amount)}${t.levy ? ', from the levy' : ', paid retinue'}`}
                    onClick={() => run({ c: 'recruit', army: id, unit: u, men: amount })}
                  >
                    +{amount}
                  </button>
                  <button
                    className="mini"
                    disabled={d.units[u] < 50 || d.units[u] >= d.men - 1 || d.next >= 0}
                    title={`Detach the ${t.name.toLowerCase()} as a separate army`}
                    onClick={() => run({ c: 'splitArmy', army: id, units: UNITS.map((_, k) => (k === u ? d.units[u] : 0)) }).then(selectCreated)}
                  >
                    ⇱
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {mine && (
        <div className="recruit-amount small">
          Recruit in batches of{' '}
          {[50, 100, 250, 500].map((n) => (
            <button key={n} className={`mini ${amount === n ? 'active' : ''}`} onClick={() => setAmount(n)}>
              {n}
            </button>
          ))}
          <div className="muted">{d.inOwnLand ? `Levy left: ${r1(p.availableLevy)} · room for paid warriors: ${r1(p.availableRetinue)}` : 'Recruits join only in our own land.'}</div>
        </div>
      )}

      <h4>Commander</h4>
      {d.leader ? (
        <p className="small">
          <CharLink c={d.leader} /> · martial {d.leaderMartial}
        </p>
      ) : (
        <p className="small muted">No commander: a captain leads (martial 4).</p>
      )}
      {mine && (
        <select
          value={-1}
          onChange={(e) => +e.target.value >= 0 && run({ c: 'setCommander', army: id, char: +e.target.value })}
        >
          <option value={-1}>Appoint a commander…</option>
          {p.commanders.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (martial {c.martial}){c.leads >= 0 ? (c.leads === id ? ' · leading this army' : ' · leads another army') : ''}
            </option>
          ))}
        </select>
      )}

      {mine && (
        <>
          <h4>Orders</h4>
          <p className="small muted">Right-click a province on the map to march there. Click the army marker again to cycle through a stack.</p>
          <div className="actions">
            {d.manual ? (
              <button onClick={() => run({ c: 'armyAuto', army: id })} title="The generals chase enemies, besiege and defend on their own">
                Let generals command
              </button>
            ) : (
              <button onClick={() => run({ c: 'haltArmy', army: id })} title="Take personal command; the army stops and waits for orders">
                Take command
              </button>
            )}
            {(d.next >= 0 || d.dest !== d.loc) && <button onClick={() => run({ c: 'haltArmy', army: id })}>Halt</button>}
            <button onClick={() => focusProvince(d.loc)}>Show on map</button>
            <button disabled={d.next >= 0 || d.men < 100} onClick={() => run({ c: 'splitArmy', army: id, units: halves }).then(selectCreated)}>
              Split in half
            </button>
            {d.mergeable.map((m) => (
              <button key={m.id} onClick={() => run({ c: 'mergeArmies', army: id, other: m.id })}>
                Merge with army of {m.men}
              </button>
            ))}
            <button
              onClick={() => {
                if (confirm('Disband this army? The men go home and can be called up again.')) run({ c: 'disbandArmy', army: id }).then((r) => r.ok && select(null));
              }}
            >
              Disband
            </button>
          </div>
        </>
      )}
    </div>
  );
}
