# Ashes & Iron

A dynasty grand-strategy game set at the end of the Bronze Age. It runs in the browser. See [game.md](game.md) for the full design.

This repository holds the **Tier 1 prototype**:
- **Scenario:** *The Long Fall*, the Eastern Mediterranean in 1150 BCE.
- **Map:** 130 procedurally shaped provinces in 7 regions, with 79 realms.
- **Events:** 60 data-driven events.
- **Systems:** characters and succession, war and sieges, raids and the Sea Peoples, diplomacy and marriage, plots, the regional pressure model, and AI.

## Running

```sh
npm install
npm run dev        # play at http://localhost:5173
npm run build      # validate data, typecheck, production build
npm test           # vitest suite
npm run bench      # headless 100-year benchmark with tick budgets (--years N --seed S)
npm run validate   # schema/reference validation of all game data
npm run fire-event -- <event_id> [realm_id] [option]   # dev tool: force an event headlessly
```

## Playing

- **Start:** choose a featured ruler or click any realm on the map, then press *Play*.
- **Time:** `Space` pauses. Keys `1`–`5` set the speed. The game pauses itself when an event or envoy needs an answer.
- **Map:** click a province, realm or character to open its panel. Diplomacy, wars, raids, marriages and plots start from those panels.
- **Armies:** an army mixes five troop types.
  - **Spearmen, bowmen and slingers** are levied from the farms, up to the realm's levy.
  - **Bronze warriors and chariots** are paid professionals. They cost metal, trade goods and cattle (horses), and are capped by a retinue of 30% of the levy.
- **Terrain and counters:** terrain matters, so chariots dominate plains and steppe but are useless in the mountains, and bowmen and slingers like high ground. Spears blunt a chariot charge.
- **Raising armies:** raise levies at the capital or in any of your provinces. You can keep several armies in the field.
- **Commanding armies:** click an army marker, its chip under the top bar, or press `A` to cycle armies. Then right-click a province to march there. From the army panel you can:
  - recruit or detach troop types, split an army in half, or merge armies in the same province;
  - appoint a commander from your court, whose martial skill adds to strength;
  - halt, hand the army to the generals' AI, or disband it.
- **Saving:** `F5` quicksaves. The ☰ menu saves with a name, exports a `.aisave` file, or toggles the debug overlay (`F3`).
- **Game over:** you play your dynasty, not a realm. When your ruler dies the heir takes over. The game ends only when your dynasty holds no throne.

## Architecture

```
src/sim/      deterministic simulation; never imports from ui/ or render/
  world.ts      struct-of-arrays state (typed arrays, integer ids)
  tick.ts       daily / monthly / yearly tiers, staggered AI, detail levels by region
  systems/      characters, succession, realms, economy, pressure, war, military,
                diplomacy, plots
  ai/           strategic goals and army movement
  events/       JSON events compiled to closures, indexed by trigger
  commands.ts   validated player commands (the UI is never trusted)
  snapshot.ts   diffs and detail views sent to the UI
  save.ts       binary saves: raw typed arrays + JSON header, gzip
src/worker/   Web Worker host and its message protocol
src/render/   PixiJS map: terrain layer, palette-recolored political layer, markers
src/ui/       React UI with a small slice-subscription store
src/data/     scenario, cultures, traits, events (JSON)
scripts/      validate-data, bench, fire-event, map-preview
tests/        RNG, map generation, data, determinism, save round-trip, succession
```

- **Determinism:** one seeded RNG drives the whole simulation.
- **Saves:** a save stores the typed arrays and RNG state as-is. The map is not stored; it is regenerated from the scenario seed. A loaded game continues exactly as the original would (tested).

## Performance

The headless benchmark runs 100 years on one core:
- **Day tick:** about 0.15 ms on average, p99 under 1 ms.
- **Month tick:** at most about 15 ms.
- **Heap:** about 16 MB.

The budgets are 5 ms for a day tick and 30 ms for a month tick.
