/** Build-time data validation. Fails the build on any schema or reference error. */
import scenario from '../src/data/scenarios/west.json';
import cultures from '../src/data/cultures.json';
import traits from '../src/data/traits.json';
import events from '../src/data/events/west.json';
import { validateData } from '../src/sim/validate';
import type { CultureData, EventData, ScenarioData, TraitData } from '../src/sim/types';

const errors = validateData(scenario as unknown as ScenarioData, cultures as CultureData[], traits as TraitData[], events as unknown as EventData[]);
if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\nData validation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Data OK: ${scenario.provinces.length} provinces, ${scenario.realms.length} realms, ${cultures.length} cultures, ${traits.length} traits, ${events.length} events.`);
