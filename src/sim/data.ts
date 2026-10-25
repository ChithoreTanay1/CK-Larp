import cultures from '../data/cultures.json';
import traits from '../data/traits.json';
import type { CultureData, EventData, ScenarioData, TraitData } from './types';
import { loadGameData, type GameData } from './setup';

export const SCENARIOS = [
  { id: 'west', name: 'The Long Fall', subtitle: 'Eastern Mediterranean, c. 1150 BCE', available: true },
  { id: 'east', name: 'The Rising Rivers', subtitle: 'Punjab and the Gangetic plain, c. 1100 BCE', available: false },
] as const;

/** Scenario data and event text are lazy-loaded chunks, so the menu loads fast. */
export async function loadScenario(id: string): Promise<GameData> {
  if (id !== 'west') throw new Error(`Scenario ${id} is not available yet`);
  const [scenario, events] = await Promise.all([import('../data/scenarios/west.json'), import('../data/events/west.json')]);
  return loadGameData(scenario.default as unknown as ScenarioData, cultures as CultureData[], traits as TraitData[], events.default as unknown as EventData[]);
}
