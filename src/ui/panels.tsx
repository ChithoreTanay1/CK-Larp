import { useEffect, useState } from 'react';
import type { ArmyDetail, ArmyInfo, CharBrief, CharDetail, DiploRow, PlayerInfo, ProvDetail, RealmDetail } from '../sim/snapshot';
import { UNITS } from '../sim/units';
import type { Command } from '../sim/commands';
import { select, sim, store, useStore } from './store';
import { focusProvince } from './MapView';
import { askConfirm } from './dialog';

const SKILLS = ['Martial', 'Diplomacy', 'Stewardship', 'Intrigue', 'Learning'];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const r1 = (n: number) => Math.round(n);

/** Fetch a detail object from the worker; refetch after commands and as days pass. */
function useDetail<T>(what: 'char' | 'realm' | 'province' | 'army' | 'diplomacy', id: number): T | null {
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
      {sel.kind === 'diplomacy' && <DiplomacyPanel />}
    </div>
  );
}

/** Raid, warning first when the victim is a friend. */
async function raidProvince(d: ProvDetail): Promise<void> {
  const owner = d.topOwner?.name ?? 'them';
  const warn = d.rel.allied
    ? `${owner} is our ally. Raiding them breaks the alliance and our trade, costs 10 prestige and 20 infamy, and they will want revenge.`
    : d.rel.truce
      ? `We swore a truce with ${owner}. Raiding them voids the truce, earns infamy, and they may strike back at once.`
      : d.rel.tradePact
        ? `${owner} trades with us. Raiding them ends the trade pact.`
        : '';
  if (warn && !(await askConfirm({ title: 'Raid a friend?', text: warn, ok: 'Raid anyway', danger: true }))) return;
  run({ c: 'raid', target: d.id });
}

/** Declare war, warning first when it breaks a truce. */
async function warOn(d: ProvDetail, kind: 'conquest' | 'subjugation'): Promise<void> {
  if (d.rel.truce) {
    const owner = d.topOwner?.name ?? 'them';
    const ok = await askConfirm({
      title: 'Break the truce?',
      text: `We swore a truce with ${owner}. Breaking it costs 25 prestige and 10 stability, earns 30 infamy on top of the war's own, and every neighbor will hear of it. Honorable realms nearby may join the war against us.`,
      ok: 'Break the truce',
      danger: true,
    });
    if (!ok) return;
    run({ c: 'declareWar', target: d.id, kind, breakTruce: true });
    return;
  }
  run({ c: 'declareWar', target: d.id, kind });
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
      {d.claim && (
        <p className="small claim-line">
          ⚜ {d.claim.id === me ? 'We hold a claim on this province.' : `${d.claim.name} holds a claim on this province.`}
        </p>
      )}
      <p className="small muted">
        Main settlement: the {SETTLEMENT_NAMES[d.tier]} of {d.name}
        {d.tier === 2 ? ' (a major city: more siege work and a larger garrison)' : ''}
      </p>
      {d.occupier && (
        <div className="siege-box">
          <b className={d.occupier.id === me ? 'good' : 'bad'}>{d.occupier.id === me ? 'Held by our army' : `Occupied by ${d.occupier.name}`}</b>
          <div className="score-bar">
            <div className="good-bg" style={{ width: pct(d.occDays / d.annexDays) }} />
          </div>
          <div className="small muted">
            Held {d.occDays} of {d.annexDays} days. At {d.annexDays} it becomes {d.occupier.name}'s for good, unless the owner's army retakes it first.
          </div>
        </div>
      )}
      {d.besiegers.map((b) => (
        <div className="siege-box" key={b.army}>
          <b>Besieged by {b.realm}</b> <span className="muted small">{b.men} men</span>
          <div className="score-bar">
            <div className="good-bg" style={{ width: pct(b.progress) }} />
          </div>
          <div className="small muted">{b.block ? `No progress: ${b.block}.` : `${pct(b.progress)} done · falls in about ${b.days} days`}</div>
          <button className="link small" onClick={() => select({ kind: 'army', id: b.army })}>
            Show army
          </button>
        </div>
      ))}
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
          <button onClick={() => raidProvince(d)} disabled={raidMonths > 0} title={raidMonths ? `Raiders ready in ${raidMonths} months` : `${d.daysFromCapital} days from our capital`}>
            Raid {raidMonths ? `(${raidMonths} mo)` : ''}
          </button>
          <button onClick={() => warOn(d, 'conquest')} title={`Infamy +${d.rel.infamy}${d.claim?.id === me ? ' (we hold a claim)' : ''}`}>
            {d.rel.truce ? 'Break truce: conquest' : d.claim?.id === me ? 'Press our claim' : 'Conquest war'}
          </button>
          <button onClick={() => warOn(d, 'subjugation')} title="Infamy +5">
            {d.rel.truce ? 'Break truce: subjugate' : 'Subjugation war'}
          </button>
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
      {!d.isPlayer && <Relations d={d} />}
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

const ago = (y: number) => (y < 1 / 12 ? 'just now' : y < 1 ? `${Math.round(y * 12)} mo ago` : `${Math.round(y)} y ago`);

/** Little badges for the ties between us and another realm. */
function RelTags({ r }: { r: Pick<DiploRow, 'allied' | 'tradePact' | 'married' | 'hostile' | 'truceYears' | 'grudge' | 'coalition'> }) {
  return (
    <span className="rel-tags">
      {r.hostile && <span className="tag war">⚔ At war</span>}
      {r.allied && <span className="tag ally">🤝 Allied</span>}
      {r.tradePact && <span className="tag trade">⚖ Trade pact</span>}
      {r.married && <span className="tag kin">💍 Kin</span>}
      {r.truceYears > 0 && <span className="tag truce" title="Declaring war now would break the truce">🕊 Truce {r.truceYears.toFixed(1)}y</span>}
      {r.coalition && <span className="tag war" title="They are in a coalition against us">✊ Coalition</span>}
      {r.grudge > 0 && <span className="tag grudge" title="A grudge for our betrayals. It fades a point a month.">Grudge {r.grudge}</span>}
    </span>
  );
}

const SCHEME_KEYS = ['murder', 'usurp', 'sway', 'incite', 'fabricate', 'steal'] as const;

/** Relations with a foreign realm: why they feel as they do, diplomacy and schemes. */
function Relations({ d }: { d: RealmDetail }) {
  const id = d.id;
  const [mine, setMine] = useState(-1);
  const [theirs, setTheirs] = useState(-1);
  const [claimProv, setClaimProv] = useState(-1);
  const kinds = useStore((s) => s.update?.player?.plotKinds ?? []);
  const scheme = (k: number, prov?: number) => d.ruler && run({ c: 'plot', target: d.ruler.id, kind: SCHEME_KEYS[k], prov });
  const schemeBtn = (k: number, label: string) =>
    kinds[k] && (
      <button onClick={() => scheme(k)} title={`${kinds[k].desc} Costs ${kinds[k].cost} trade goods.`}>
        {label} ({kinds[k].cost})
      </button>
    );
  const open = d.claimable.filter((c) => !c.claimed);
  return (
    <>
      <h4>Relations</h4>
      <div className="opinion-line">
        <span>They think of us</span>
        <div className="opinion-meter" title={`Opinion ${d.opinionOfPlayer} (-100 to 100)`}>
          <i style={{ left: `${50 + d.opinionOfPlayer / 2}%` }} className={d.opinionOfPlayer < 0 ? 'bad-bg' : 'good-bg'} />
        </div>
        <b className={d.opinionOfPlayer < 0 ? 'bad' : 'good'}>{d.opinionOfPlayer > 0 ? '+' : ''}{d.opinionOfPlayer}</b>
      </div>
      <RelTags r={{ allied: d.allied, tradePact: d.tradePact, married: d.married, hostile: d.hostile, truceYears: d.truceYears, grudge: d.grudge, coalition: d.coalition }} />
      <p className="small muted">
        Our strength {d.playerStrength} vs theirs {d.strength} · Their reputation: <span className={d.infamy >= 30 ? 'bad' : ''}>{d.infamyName}</span>
        {d.ourGrudge > 0 && <> · We hold a grudge ({d.ourGrudge})</>}
      </p>
      {d.memories.length > 0 && (
        <ul className="memories">
          {d.memories.map((m, i) => (
            <li key={i}>
              <b className={m.value < 0 ? 'bad' : 'good'}>{m.value > 0 ? '+' : ''}{m.value}</b> {m.text}
              <span className="muted"> · {ago(m.years)}</span>
            </li>
          ))}
        </ul>
      )}
      {d.playerTop && d.liege && d.liege.id !== store.state.update?.player?.realm && <p className="muted small">Part of our own realm.</p>}
      {!d.playerTop && (
        <>
          <h5 className="sub">Diplomacy</h5>
          <div className="actions">
            {d.allied ? (
              <button
                onClick={async () =>
                  (await askConfirm({ title: 'Break the alliance', text: `End our alliance with ${d.name}? They will hold a grudge, and our infamy rises${d.atWar ? ' (more so while they are at war)' : ''}.`, ok: 'Break it', danger: true })) &&
                  run({ c: 'breakAlliance', realm: id })
                }
              >
                Break alliance
              </button>
            ) : (
              <button onClick={() => run({ c: 'propose', type: 'alliance', realm: id })} title={d.verdicts.alliance}>
                Propose alliance {d.verdicts.allianceOk ? '✓' : ''}
              </button>
            )}
            {d.tradePact ? (
              <button
                onClick={async () =>
                  (await askConfirm({ title: 'End the trade pact', text: `Tear up our trade pact with ${d.name}? We lose ${d.pactIncome.toFixed(1)} trade goods a month, they will resent it, and our infamy rises a little.`, ok: 'End it', danger: true })) &&
                  run({ c: 'cancelTrade', realm: id })
                }
              >
                End trade pact
              </button>
            ) : (
              <button disabled={!d.inTradeRange || d.hostile} onClick={() => run({ c: 'propose', type: 'trade', realm: id })} title={d.verdicts.trade}>
                Propose trade pact (+{d.pactIncome.toFixed(1)}/mo) {d.verdicts.tradeOk ? '✓' : ''}
              </button>
            )}
            <button onClick={() => run({ c: 'propose', type: 'vassal', realm: id })} title={d.verdicts.vassal}>
              Demand fealty {d.verdicts.vassalOk ? '✓' : ''}
            </button>
            <button onClick={() => run({ c: 'propose', type: 'hostage', realm: id })} title={d.verdicts.hostage}>
              Demand hostage {d.verdicts.hostageOk ? '✓' : ''}
            </button>
            <button onClick={() => run({ c: 'gift', realm: id })} title="25 trade goods: opinion up, grudges soften">Send gifts</button>
          </div>
          {d.ruler && !d.landless && (
            <>
              <h5 className="sub">Schemes</h5>
              <p className="small muted">One scheme at a time; bribes are paid up front. A discovered scheme earns their hatred and some infamy.</p>
              <div className="actions">
                {schemeBtn(2, 'Sway ruler')}
                {schemeBtn(3, 'Incite unrest')}
                {schemeBtn(5, 'Steal treasure')}
                {schemeBtn(0, 'Murder ruler')}
              </div>
              {kinds[4] && (
                <div className="marry">
                  <select value={claimProv} onChange={(e) => setClaimProv(+e.target.value)}>
                    <option value={-1}>Province to claim…</option>
                    {open.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button disabled={claimProv < 0} onClick={() => scheme(4, claimProv)} title={`${kinds[4].desc} Costs ${kinds[4].cost} trade goods.`}>
                    Fabricate claim ({kinds[4].cost})
                  </button>
                </div>
              )}
              {d.claimable.some((c) => c.claimed) && (
                <p className="small claim-line">
                  ⚜ Our claims: {d.claimable.filter((c) => c.claimed).map((c) => c.name).join(', ')}
                </p>
              )}
            </>
          )}
        </>
      )}
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
          <p className="small muted">Kin by marriage are likelier to ally with us and to answer our calls to arms.</p>
        </>
      )}
    </>
  );
}

const INFAMY_MARKS = [10, 30, 45, 65];

/** Our reputation: infamy, its level, and who has banded together against us. */
function Reputation({ p }: { p: PlayerInfo }) {
  return (
    <div className="reputation">
      <div className="rep-head">
        <span>Reputation</span>
        <b className={p.infamy >= 45 ? 'bad' : p.infamy >= 10 ? '' : 'good'}>{p.infamyName}</b>
        <span className="muted small">infamy {Math.round(p.infamy)}</span>
      </div>
      <div className="infamy-meter">
        <div className="fill" style={{ width: `${Math.min(100, p.infamy)}%` }} />
        {INFAMY_MARKS.map((m) => (
          <i key={m} style={{ left: `${m}%` }} />
        ))}
      </div>
      <p className="small muted">
        {p.infamyDesc} Wars of conquest, broken truces, raids on friends and discovered schemes raise infamy; it fades with years of good faith.
      </p>
      {p.coalition.length > 0 && (
        <p className="small bad">
          ✊ Coalition against us: {p.coalition.map((r) => store.state.realms.get(r)?.name).join(', ')}
        </p>
      )}
    </div>
  );
}

/** All our neighbors at a glance. */
function DiplomacyPanel() {
  const rows = useDetail<DiploRow[]>('diplomacy', 0);
  const p = useStore((s) => s.update?.player ?? null);
  if (!rows || !p) return null;
  return (
    <div>
      <div className="kicker">Diplomacy</div>
      <h2>Our Neighbors</h2>
      <Reputation p={p} />
      {p.tradePacts.length > 0 && (
        <p className="small">
          Trade pacts: {p.tradePacts.length} · +{p.tradePacts.reduce((t, x) => t + x.income, 0).toFixed(1)} trade goods a month
        </p>
      )}
      <table className="diplo">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => select({ kind: 'realm', id: r.id })}>
              <td>
                <span className="swatch" style={{ background: hex(r.color) }} />
                <b>{r.name}</b>
                <div className="muted small">
                  {r.days} days · strength {r.strength}
                  {r.infamyName !== 'Trusted' && <> · {r.infamyName}</>}
                </div>
                <RelTags r={r} />
              </td>
              <td className={`op ${r.opinion < 0 ? 'bad' : 'good'}`} title="Their opinion of us">
                {r.opinion > 0 ? '+' : ''}{r.opinion}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Realms within reach of our capital, nearest first. Click one to deal with it.</p>
    </div>
  );
}

/** The player's own realm: wars, army, vassals, plots, hostages, court actions. */
function MenAtArms() {
  const p = useStore((s) => s.update?.player ?? null);
  if (!p) return null;
  const full = p.maaUsed >= p.maaCap;
  const pay = p.maa.reduce((t, m) => t + m.regiments * m.pay, 0);
  return (
    <div id="men-at-arms">
      <div className="maa-head">
        <h4>Men-at-Arms</h4>
        <span className="maa-cap small" title="Regiments kept / regiments the barracks can hold">
          {p.maaUsed}/{p.maaCap} regiments
        </span>
      </div>
      <div className="maa-pips">
        {Array.from({ length: p.maaCap }, (_, i) => (
          <i key={i} className={i < p.maaUsed ? 'on' : ''} />
        ))}
      </div>
      <p className="small muted">
        Standing regiments of 100 paid soldiers. They march out with every army you raise, fight harder than the levy, and refill after losses
        a little each month. Upkeep: {pay.toFixed(1)} trade goods a month.
      </p>
      <table className="troops maa">
        <tbody>
          {UNITS.map((t, u) => {
            const m = p.maa[u];
            const cost = [m.cost.metal && `${m.cost.metal} metal`, m.cost.trade && `${m.cost.trade} trade`, m.cost.cattle && `${m.cost.cattle} cattle`].filter(Boolean).join(', ');
            return (
              <tr key={t.id} title={t.desc}>
                <td className="army-ico">{UNIT_ICON[u]}</td>
                <td>
                  {t.name}
                  {m.regiments > 0 && (
                    <div className="muted small">
                      {m.ready} ready · {m.fielded} in the field
                    </div>
                  )}
                </td>
                <td className="regs">{m.regiments || ''}</td>
                <td className="row-actions">
                  <button className="mini" disabled={full} title={`Raise a regiment of 100 ${t.name.toLowerCase()}: ${cost}. Then ${m.pay} trade a month.`} onClick={() => run({ c: 'hireMaa', unit: u })}>
                    + Regiment
                  </button>
                  <button
                    className="mini"
                    disabled={!m.regiments}
                    title="Pay off one regiment"
                    onClick={async () => (await askConfirm({ title: 'Dismiss regiment', text: `Pay off a regiment of ${t.name.toLowerCase()}? The men go home and the arms are lost.`, ok: 'Dismiss' })) && run({ c: 'dismissMaa', unit: u })}
                  >
                    −
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="actions">
        <button onClick={() => run({ c: 'expandBarracks' })} title="Room for two more regiments">
          Build barracks (+2 regiments: {p.maaExpand.trade} trade, {p.maaExpand.prestige} prestige)
        </button>
      </div>
    </div>
  );
}

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
      <MenAtArms />
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
                <button onClick={async () => (await askConfirm({ title: 'Surrender', text: `Surrender in ${w.name}? The enemy gets what it went to war for.`, ok: 'Surrender', danger: true })) && run({ c: 'peace', war: w.id, mode: 'surrender' })}>Surrender</button>
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
      <Reputation p={p} />
      {p.tradePacts.length > 0 && (
        <>
          <h4>Trade pacts</h4>
          <div className="chips">
            {p.tradePacts.map((t) => (
              <button key={t.id} className="chip" onClick={() => select({ kind: 'realm', id: t.id })} title="Trade goods a month">
                {t.name} +{t.income.toFixed(1)}
              </button>
            ))}
          </div>
        </>
      )}
      {p.claims.length > 0 && (
        <>
          <h4>Our claims</h4>
          <div className="chips">
            {p.claims.map((c) => (
              <button key={c.id} className="chip" onClick={() => select({ kind: 'province', id: c.id })} title={`Held by ${c.owner}. A war for it earns almost no infamy.`}>
                ⚜ {c.name}
              </button>
            ))}
          </div>
        </>
      )}
      <h4>Schemes</h4>
      {p.plots.length === 0 && <p className="muted small">No scheme under way. Start one from another realm's panel.</p>}
      {p.plots.map((pl) => (
        <div key={pl.id} className="plot-row small">
          <b>{pl.kind}</b> · {pl.target}
          <div className="score-bar" title="Progress">
            <div className="good-bg" style={{ width: `${Math.min(100, pl.progress * 100)}%` }} />
          </div>
          <span className="muted">
            {Math.round(Math.min(1, pl.progress) * 100)}% done · secrecy {Math.round(pl.secrecy * 100)}%{pl.secrecy < 0.35 ? ' (they may find out)' : ''}
          </span>
        </div>
      ))}
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
      {d.matches.length > 0 && <Matches d={d} />}
      {d.canPlot && d.alive && !d.isPlayerFamily && (
        <div className="actions">
          <button onClick={() => run({ c: 'plot', target: d.id, kind: 'murder' })} title="20 trade goods">Plot murder</button>
          <button onClick={() => run({ c: 'plot', target: d.id, kind: 'usurp' })} title="Only against your own liege">Plot usurpation</button>
        </div>
      )}
    </div>
  );
}

/** Find a spouse abroad for one of our family, CK-style. */
function Matches({ d }: { d: CharDetail }) {
  const [open, setOpen] = useState(false);
  const yes = d.matches.filter((m) => m.ok).length;
  return (
    <>
      <h4>Find a match</h4>
      <button onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} {d.matches.length} possible matches ({yes} would accept)
      </button>
      {open && (
        <ul className="plain matches">
          {d.matches.map((m) => (
            <li key={m.id} title={m.reason}>
              <span className={m.ok ? 'good' : 'bad'}>{m.ok ? '✓' : '✗'}</span> <button className="link" onClick={() => select({ kind: 'char', id: m.id })}>{m.name}</button> ({m.age})
              {m.ruler && <span className="tag kin">Ruler</span>} of <button className="link" onClick={() => select({ kind: 'realm', id: m.realm })}>{m.realmName}</button>
              <button className="mini" disabled={!m.ok} onClick={() => run({ c: 'marry', mine: d.id, theirs: m.id, realm: m.realm })}>
                Propose
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
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
const SETTLEMENT_NAMES = ['village', 'town', 'city'];
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
        {a.battle >= 0 ? ' · ⚔ in battle' : a.routed ? ' · falling back' : a.sieging ? ' · besieging' : ''}
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
      {d.battle >= 0 && (
        <div className="siege-box battle">
          <b>⚔ Locked in battle at {d.locName}</b>
          <div className="small muted">The army cannot move until one side breaks. See the battle window for the fighting.</div>
          {mine && (
            <div className="actions">
              <button onClick={() => run({ c: 'retreat', army: id })} title="Break off: the enemy wins the field, but the pursuit is lighter">
                Retreat
              </button>
            </div>
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
              <td>
                {t.name}
                {d.maa[u] > 0 && <div className="maa-tag" title="Men-at-arms among them">⚑ {d.maa[u]} men-at-arms</div>}
              </td>
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
                    disabled={!d.inOwnLand || d.next >= 0 || p.maa[u].ready < 1}
                    title={p.maa[u].ready >= 1 ? `Bring up to ${amount} men-at-arms from the barracks (${p.maa[u].ready} ready)` : 'No men-at-arms of this kind in the barracks. Hire regiments in the realm panel.'}
                    onClick={() => run({ c: 'deployMaa', army: id, unit: u, men: amount })}
                  >
                    ⚑
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
              onClick={async () => {
                if (await askConfirm({ title: 'Disband army', text: 'Disband this army? The levy goes home and can be called up again; men-at-arms return to the barracks.', ok: 'Disband' }))
                  run({ c: 'disbandArmy', army: id }).then((r) => r.ok && select(null));
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
