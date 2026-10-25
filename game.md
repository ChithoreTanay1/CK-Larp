# Working Title: Ashes & Iron

A grand strategy game set after the Bronze Age Collapse (~1150 BCE). Character-driven, dynasty-focused, browser-first, later wrapped as a standalone app.

**Core fantasy:** you are a ruler (and then your heirs) in a world that is either falling apart or being born.

> Original design. Mechanics are generic grand-strategy ideas (characters, dynasties, vassals, events), built from scratch.

---

## 1. Pillars

1. **Believable, not true.** Anchored in real pressures (drought, iron, migration), with generated rulers and events. Labeled as fictionalized.
2. **Pick a region, the world builds around it.** One engine, multiple scenarios.
3. **Dynasty over nation.** You play a family across generations.
4. **Performance is a feature.** Every system has a budget (see section 9).
5. **Content over code.** Events and characters carry the game.

---

## 2. Scope Tiers

| Tier | Team / time | Content |
|---|---|---|
| **1. Prototype** | Solo, 2-4 months | 100-200 provinces, 1 scenario, ~50 events, basic war/marriage/succession |
| **2. Playable** | Solo, 1-2 years | 400-600 provinces, 2 scenarios, 200-400 events, collapse system, plots |
| **3. Full** | Team, 3-5 years | 1,500+ provinces, deep religion/culture, thousands of events |

**Build Tier 1 first. Do not design for Tier 3 yet.**

---

## 3. The Two Scenarios

### West: "The Long Fall" (decline arc)
- **Region:** Aegean, Anatolia, Levant, Egypt, Cyprus.
- **Start:** ~1150 BCE. Palaces are burned or abandoned, the Hittite state is gone, Sea Peoples are settling, Egypt is shrinking.
- **Player goal:** survive, rebuild, and become the next power (Phoenician city, Philistine lord, Assyrian-style conqueror, Egyptian priest-king, Aegean warlord).
- **Pressures:** famine, raiders, trade collapse, bronze shortage, rebellion of unpaid soldiers.
- **Flavor mechanics:** palace-economy failure, tin/copper trade routes, early iron, sea raiding, temple vs. crown power.

### East: "The Rising Rivers" (rise arc)
- **Region:** Punjab, Sarasvati basin, Gangetic plain.
- **Start:** ~1200-1000 BCE (fictionalized). Late Harappan decline, tribal confederations, horses and cattle, early iron in the east.
- **Player goal:** turn a tribe (jana) into a kingdom (janapada) and keep it together across generations.
- **Pressures:** drying rivers, cattle raids, rival tribes, ritual legitimacy, forest clearing eastward.
- **Flavor mechanics:**
  - **Wealth is cattle**, not gold.
  - **Legitimacy from ritual:** the purohita (priest) and big sacrifices (rajasuya, ashvamedha-style) raise prestige and cost huge resources.
  - **Assemblies** (sabha, samiti) limit the raja; ignore them and loyalty drops.
  - **Tribe-to-kingdom conversion** is the main progression: settle land, tax grain, appoint officials.

**Authenticity rules for the East**
- Use tribal names loosely (Bharata, Puru, Yadu, Anu, Druhyu, Kuru, Panchala), but **generate rulers and events**. No fixed plot.
- Allow history to diverge. Test: "could this plausibly have happened?"
- Show an in-game note that this is fictionalized, since dating and migration are debated.

### The Middle (bridge, low detail by default)
Elam, Assyria, Iranian plateau, BMAC, Gandhara. Carries trade (tin, lapis, horses), migration, and ideas. No known direct contact between West and East, so link them through **trade goods and migrating peoples**, never through a shared plot.

### Region pick
At start the player chooses West or East. The chosen region runs at **full detail**. Everything else runs at **reduced detail** (see section 9, LOD simulation).

---

## 4. Core Systems

**Characters**
- Traits (about 30-50 at first), skills, age, health, family tree
- Birth, marriage, heirs, death, with simple inheritance rules per culture

**Realm**
- Provinces owned by rulers, vassals pay tribute and levy troops
- Succession law: West (eldest-heavy or elective, varies), East (tribal choice plus ritual approval)

**Economy (keep it simple)**
- 3-5 resources: grain, cattle, metal (bronze/tin/iron), trade goods, prestige
- Per-province output computed monthly, not daily

**War**
- Armies move on the province graph; battles resolve with a few modifiers plus randomness
- Raiding is a first-class action (cheap, risky, high reward)

**Diplomacy**
- Marriage, alliance, tribute, vassalage, hostage-taking

**Plots**
- Murder, usurp, rebel, with a secrecy meter and a discovery roll

**Collapse and Pressure System (the signature mechanic)**
A world-level and regional **pressure model** drives the era:
- Variables: `drought`, `famine`, `raiderPressure`, `tradeHealth`, `ironAdoption`, `legitimacy`
- Slow-moving values per region, updated monthly, that **bias event chances and AI decisions**
- Example: high drought and low tradeHealth makes famine events, migration, and rebellion more likely
- This is cheap to compute and creates the "everything is changing" feel

**Events**
- Data-driven (JSON/YAML): trigger, conditions, weight, options, effects
- Indexed by trigger type so you never scan all events every tick
- Target: 50 events (Tier 1), 200-400 (Tier 2)

---

## 5. AI Design

The AI is the hardest part. Keep it **cheap, staggered, and good enough**.

**Layers**
1. **Strategic AI (realm level):** picks a goal every N months, such as expand, consolidate, defend, or recover. Uses a utility score, not search.
2. **Character AI (person level):** weighted random choices from trait-based scores (ambitious characters plot more, etc.).
3. **Military AI:** simple rules (gather, move toward target, retreat if outmatched). No deep lookahead.
4. **Event AI:** picks event options by trait weights.

**Rules**
- **Utility scoring:** each possible action gets a score from a few weighted factors. Pick the best, or sample from the top few for variety.
- **Staggering:** each AI ruler has an `aiOffset`. On any given day only ~1/30 of rulers run strategic thinking. Costs are spread evenly across ticks.
- **LOD:** far-away or minor rulers think less often (quarterly or yearly) with simpler rules.
- **No per-tick allocation** inside AI code. Reuse scratch arrays.
- **Deterministic seeded RNG**, so bugs reproduce and saves stay consistent.
- Don't aim for "smart." Aim for "believable and reactive to pressures."

---

## 6. Tech Stack

**Free, browser-first**
- TypeScript, Vite, VS Code, Git/GitHub
- **React** for UI panels (character window, events, diplomacy)
- **PixiJS** (WebGL) for the map
- **Web Worker** for the simulation
- **IndexedDB** for saves (plus JSON export/import)
- Art: Krita/GIMP/Inkscape. Audio: Audacity/LMMS. Hosting: itch.io, GitHub Pages.

**Standalone app later:** wrap with **Tauri** (small) or **Electron** (easier). Paid only when shipping (Steam fee, code signing).

---

## 7. Architecture

```
/src
  /sim          <- pure TypeScript, no DOM, runs in the worker
    world.ts       world state (typed arrays)
    tick.ts        daily / monthly / yearly schedulers
    ai/            strategic, character, military
    systems/       economy, war, diplomacy, plots, pressure
    events/        loader, trigger index, effects
    rng.ts         seeded RNG
  /render       <- PixiJS map, overlays
  /ui           <- React panels
  /data         <- JSON: provinces, cultures, traits, events, scenarios
  /worker       <- message bridge between sim and UI
```

**Rules**
- `/sim` never imports from `/ui` or `/render`. This keeps it testable and portable.
- UI and sim talk through **commands** (UI to sim) and **snapshots/diffs** (sim to UI).
- Scenarios are data files. Adding a region means adding data, not code.

---

## 8. Data Model (performance-friendly)

Use **flat typed arrays (struct-of-arrays)** instead of objects, keyed by integer IDs.

```ts
// Provinces
provinceOwner:   Int32Array   // ruler ID per province
provinceGrain:   Float32Array
provinceCattle:  Float32Array
provinceDevelop: Uint8Array
provinceAdj:     Int32Array   // CSR adjacency (offsets + neighbors)

// Characters
charAge:     Uint8Array
charHealth:  Uint8Array
charTraits:  Uint32Array      // bitmask (up to 32 traits) or multiple masks
charFather:  Int32Array
charMother:  Int32Array
charRealm:   Int32Array
```

**Why:** typed arrays are contiguous in memory, GC-free, fast to iterate, trivially serializable, and can be shared with the render thread. Strings (names, text) live in lookup tables, referenced by ID.

---

## 9. Optimization Plan (the important part)

### Budgets (targets, to be measured)
| Thing | Budget |
|---|---|
| Frame time | <= 16 ms (60 fps), aim for 8 ms |
| One sim day tick | <= 5 ms at normal speed, even on mid hardware |
| Monthly heavy tick | <= 30 ms, split across frames if needed |
| Memory | < 300 MB total |
| Initial load | < 3 s on broadband |

Profile from **day one**. Do not "optimize later."

### Simulation
1. **Tick tiers:** daily (movement, combat), monthly (economy, AI strategy), yearly (aging checks, long-term pressure).
2. **Staggered updates:** spread AI and character updates by ID offset so no single tick spikes.
3. **LOD simulation:** the player's region is full detail. Other regions use simplified rules (fewer events, coarse economy, yearly AI). Promote an area to full detail when the player's influence reaches it.
4. **Dirty flags:** only recompute things (borders, income, supply) when their inputs changed.
5. **Event indexing:** index events by trigger type and check only relevant ones, with cheap conditions first.
6. **Precompute static data:** adjacency lists, distances, pathfinding hints. Cache A* results per (from, to) and invalidate on ownership change.
7. **No allocation in hot loops.** Reuse arrays and avoid `map/filter/spread` inside ticks. This prevents garbage-collection stutter.
8. **Run in a Web Worker.** Sim never blocks rendering.

### Worker / UI communication
- Send **diffs**, not full state: only changed provinces and characters per tick.
- Batch updates (one message per frame, not per change).
- Consider `SharedArrayBuffer` for read-only map state (needs cross-origin isolation headers), but start with transferable typed arrays and upgrade if profiling says so.
- UI requests details on demand (opening a character panel asks the worker for that character).

### Rendering
1. **Province bitmap:** each province is a unique color in an offscreen image. Click detection is a single pixel lookup, with no polygon hit-testing.
2. **Layered rendering:** static terrain layer (drawn once), dynamic overlay layer (borders, owners), and a UI layer. Redraw only the layers that changed.
3. **Recolor via palette/texture,** not by redrawing polygons, when ownership changes.
4. **Sprite batching** for armies and icons, with object pooling. Cull anything off-screen.
5. **Render on demand:** don't redraw at 60 fps when nothing moved. Idle map equals zero GPU work.
6. **Texture atlas** for all icons, to cut draw calls.

### UI
- React panels: use `memo`, avoid re-rendering the whole tree on every tick. Subscribe components to specific slices.
- **Virtualize long lists** (character lists, event logs).
- Update UI at ~10 Hz max for numbers, not every tick.

### Data and loading
- Lazy-load scenario data; compress assets (WebP/AVIF, audio at sensible bitrates).
- Keep event text in separate chunks per region.
- Saves: serialize typed arrays directly (binary), compressed with `CompressionStream`. Far smaller and faster than giant JSON.

### Discipline
- Add an **in-game debug overlay**: tick time, frame time, entity counts, memory.
- Write a **headless benchmark** that runs 100 years of sim with no rendering and reports timings. Run it after every system change. Regressions fail the build.

---

## 10. Content Pipeline

- Events, traits, cultures, and scenarios in **JSON/YAML**, validated by a schema at build time (catches typos before runtime).
- Event template:

```yaml
id: drought_famine_01
trigger: monthly
region_tags: [any]
conditions:
  - pressure.drought > 0.6
  - province.grain < 20
weight: 3
text: "The rains fail again..."
options:
  - label: "Open the granaries"
    effects: [grain -30, loyalty +10]
  - label: "Let the weak go hungry"
    effects: [loyalty -15, prestige -5]
```

- A **dev tool** (even a simple script) to fire any event on demand for testing.

---

## 11. Roadmap

**Phase 0 (week 1-2): Skeleton**
Vite + TS + PixiJS + worker. Draw a 100-province map, click to select, run an empty tick loop with a debug overlay.

**Phase 1 (month 1-2): Core loop**
Characters (birth, marriage, death), one realm, simple economy, succession. Save/load.

**Phase 2 (month 2-3): Conflict**
Armies, war, raiding, vassals, basic diplomacy. Simple AI.

**Phase 3 (month 3-4): Pressure and events**
Pressure model, 50 events, first complete scenario (**start with the one you find easier to write**). Benchmark and optimize.

**Phase 4 (month 5+): Second scenario**
Add the other region as data plus scenario-specific mechanics (cattle/ritual for East, palace-collapse/iron for West).

**Phase 5: Wrap and polish**
Tauri/Electron wrapper, UI polish, audio, playtests, itch.io demo.

---

## 12. Risks (honest list)

- **AI quality** may take more iteration than expected. Mitigation: staggered, utility-based, simple first.
- **Content volume** is the real bottleneck. Mitigation: ship fewer, better events; use templates and generated variants.
- **Scope creep.** Every new system multiplies testing. Mitigation: hold to the tier plan.
- **Vedic-era sources are thin.** Mitigation: fictionalize openly, anchor on environmental pressures.
- **Performance drift.** Mitigation: budgets, benchmark, debug overlay from day one.
- **Browser limits** (memory, no threads beyond workers). Mitigation: typed arrays, LOD, diff messaging.

---

## 13. Immediate Next Steps

1. Decide the **first scenario** to build (recommend: whichever you can write 50 good events for).
2. Set up the Phase 0 skeleton.
3. Make the province map (start with ~100 provinces).
4. Write the benchmark harness **before** the first real system.
5. Write the first 10 events to test the pipeline.
