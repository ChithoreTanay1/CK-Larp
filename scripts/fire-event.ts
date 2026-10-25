/**
 * Dev tool: fire any event on demand and print what the player would see.
 * Usage: npm run fire-event -- <event_id> [realm_id] [option]
 *   e.g. npm run fire-event -- black_ships tyre 2
 * With an option index, the option is applied and the realm's state before/after is shown.
 */
import { loadScenario } from '../src/sim/data';
import { createWorld, setPlayer } from '../src/sim/setup';
import { forceEvent, resolveChoice, getEventDb } from '../src/sim/events/runner';

const [id, realmKey = 'mycenae', opt] = process.argv.slice(2);
const data = await loadScenario('west');
if (!id) {
  console.log('Events:\n' + data.events.events.map((e) => `  ${e.data.id.padEnd(28)} ${e.data.trigger}`).join('\n'));
  process.exit(0);
}
const w = createWorld(data, 1);
const realm = w.realmName.findIndex((n, i) => w.realmAlive[i] && (n.toLowerCase() === realmKey.toLowerCase() || data.scenario.realms[i]?.id === realmKey));
if (realm < 0) throw new Error(`No realm ${realmKey}`);
setPlayer(w, realm);
w.playerQueue.length = 0;
if (!getEventDb()?.byId.has(id)) throw new Error(`No event ${id}`);
forceEvent(w, id, realm);
const q = w.playerQueue[0];
console.log(`\n== ${q.title} ==\n${q.text}\n`);
q.options.forEach((o, i) => console.log(`  [${i}] ${o.label}   (${o.tooltip})`));
if (opt !== undefined) {
  const snap = () => ({ grain: w.realmGrain[realm], cattle: w.realmCattle[realm], metal: w.realmMetal[realm], trade: w.realmTrade[realm], prestige: w.realmPrestige[realm], stability: w.realmStability[realm] });
  const before = snap();
  resolveChoice(w, q.uid, Number(opt));
  const after = snap();
  console.log(`\nApplied option ${opt}:`);
  for (const k of Object.keys(before) as (keyof typeof before)[]) if (before[k] !== after[k]) console.log(`  ${k}: ${before[k].toFixed(1)} -> ${after[k].toFixed(1)}`);
}
