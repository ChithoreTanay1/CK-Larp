import { loadScenario } from '../src/sim/data';
import type { GameData } from '../src/sim/setup';

let cached: GameData | null = null;

export async function gameData(): Promise<GameData> {
  cached ??= await loadScenario('west');
  return cached;
}
