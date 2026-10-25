/**
 * Headless benchmark: runs the simulation with no rendering and reports tick timings
 * against the budgets in game.md. Exits non-zero when a budget is blown, so it can
 * gate CI. Usage: npm run bench [-- --years 100 --seed 7]
 */
import { loadScenario } from '../src/sim/data';
import { createWorld } from '../src/sim/setup';
import { stepDay, newStats } from '../src/sim/tick';
import { DAYS_PER_YEAR } from '../src/sim/world';

const args = process.argv.slice(2);
const arg = (k: string, d: number) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const years = arg('years', 100);
const seed = arg('seed', 7);

const BUDGET_AVG_DAY_MS = 5;
const BUDGET_MONTH_MS = 30;

const t0 = performance.now();
const data = await loadScenario('west');
const tLoad = performance.now() - t0;
const w = createWorld(data, seed);
const stats = newStats();
const samples: number[] = [];
const t1 = performance.now();
for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
  const s = performance.now();
  stepDay(w, stats);
  samples.push(performance.now() - s);
  if ((d + 1) % (DAYS_PER_YEAR * 10) === 0) {
    let realms = 0, wars = 0, armies = 0;
    for (let r = 0; r < w.R; r++) realms += w.realmAlive[r];
    for (let i = 0; i < w.warActive.length; i++) wars += w.warActive[i];
    for (let i = 0; i < w.armyActive.length; i++) armies += w.armyActive[i];
    console.log(`  year ${w.year} (${w.yearBce} BCE): realms ${realms}, chars alive ${w.aliveCount}/${w.charCount}, wars ${wars}, armies ${armies}`);
  }
}
const total = performance.now() - t1;
samples.sort((a, b) => a - b);
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
const p99 = samples[Math.floor(samples.length * 0.99)];
const max = samples[samples.length - 1];
console.log(`\nload+mapgen ${tLoad.toFixed(0)} ms, ${years} years in ${(total / 1000).toFixed(2)} s`);
console.log(`day tick: avg ${avg.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${max.toFixed(2)} ms`);
console.log(`month tick: max ${stats.maxMonthMs.toFixed(2)} ms`);
const mem = process.memoryUsage();
console.log(`heap ${(mem.heapUsed / 1e6).toFixed(1)} MB, rss ${(mem.rss / 1e6).toFixed(1)} MB`);

let fail = false;
if (avg > BUDGET_AVG_DAY_MS) {
  console.error(`FAIL: average day tick ${avg.toFixed(2)} ms exceeds ${BUDGET_AVG_DAY_MS} ms`);
  fail = true;
}
if (stats.maxMonthMs > BUDGET_MONTH_MS) {
  console.error(`FAIL: monthly tick ${stats.maxMonthMs.toFixed(2)} ms exceeds ${BUDGET_MONTH_MS} ms`);
  fail = true;
}
if (fail) process.exit(1);
console.log('All budgets met.');
