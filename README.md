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
- **Time:** `Space` pauses and resumes. Keys `1`–`5` set the speed: 1, 3, 10, 30 and 100 days per second. When an event or envoy needs an answer, time stops ("Waiting for your decision"). It resumes at the same speed once you answer.
- **Map:** click a province, realm or character to open its panel. Diplomacy, wars, raids, marriages and plots start from those panels.
- **Armies:** an army mixes five troop types.
  - **Spearmen, bowmen and slingers** are levied from the farms, up to the realm's levy.
  - **Bronze warriors and chariots** are paid professionals. They cost metal, trade goods and cattle (horses), and are capped by a retinue of 30% of the levy.
- **Terrain and counters:** terrain matters, so chariots dominate plains and steppe but are useless in the mountains, and bowmen and slingers like high ground. Spears blunt a chariot charge.
- **Men-at-arms:** like CK3, you can keep standing regiments of 100 paid soldiers of any troop type. Open them with the *⚑ Men-at-Arms* button in the top bar.
  - *+ Regiment* hires one for metal, trade goods and, for chariots, cattle. Every regiment then costs trade goods each month.
  - Men-at-arms march out with every army you raise, without using up the levy. Each one fights about 40% harder than a levy man and is better equipped.
  - The ⚑ button in an army's troop table brings more of them from the barracks. When an army is disbanded, they return to the barracks.
  - Lost men-at-arms are replaced a fifth of a regiment at a time each month, for metal.
  - The barracks cap how many regiments you can keep. *Build barracks* adds room for two more, for trade goods and prestige.
- **Raising armies:** raise levies at the capital or in any of your provinces. You can keep several armies in the field.
  - Men lost in battle come back slowly, about 2.5% of the levy a month. Once every army of yours is disbanded, the levy refills much faster, about 12% a month, so you can raise a full host again within a year.
- **Commanding armies:** click an army marker, its chip under the top bar, or press `A` to cycle armies. Then right-click a province to march there. From the army panel you can:
  - recruit or detach troop types, split an army in half, or merge armies in the same province;
  - appoint a commander from your court, whose martial skill adds to strength;
  - halt, hand the army to the generals' AI, or disband it.
  - Your armies, including the levy raised when a war starts, move only on your orders, unless you choose *Let generals command*.
- **Battles:** hostile armies that meet always fight, whether one marches into a province the other holds or they meet head-on on a road.
  - A battle lasts several days. Each day both sides lose men and morale until one breaks, which happens at low morale or after losing three quarters of its men.
  - Crossed swords mark every battle on the map. A battle window opens for yours, showing men, losses, morale and which way the fight is going.
  - *Retreat* breaks off a battle: the enemy wins the field, but the pursuit is lighter.
  - Beaten armies fall back for about two weeks and can't be caught again during that time. Morale recovers with rest, faster on home ground.
- **Your armies on the map:** your armies are red shields with a gold pennant and a gold head count, drawn above everything else. Armies in the same province stand side by side.
- **Settlements:** every province has a main settlement, a village, town or city. Every realm's capital, every citadel and every rich center is a walled city, marked and named on the map. Cities need more siege work and have larger garrisons.
- **Sieges and conquest:** a host standing in an enemy province besieges its settlement.
  - An orange ring around the settlement shows the siege works filling up. A siege window shows your men against the garrison, the days left and a *Storm* button with your odds.
  - When the settlement falls, the province is occupied. Hold it for **30 days** and it becomes yours for good, even while the war goes on. A gold ring and flag count the days, and the *Held land* window lists every province you hold. If the province was what the war was fought for, the war is won.
  - The owner can save it only by marching an army back in before the 30 days are up. The same rule applies to your own land.
- **Walls and sieges:** provinces have walls from 0 to 3: none, palisade, stone walls, citadel. Famous citadels such as Mycenae, Troy (Wilusa), Hattusa, Tyre and Babylon start at 3, and every capital has at least a palisade.
  - Each level adds a long stretch of siege work, slows every day of it, and raises the men needed to invest the place (250 + 375 per level: 625 behind a palisade, 1,000 against stone walls, 1,375 against a citadel). Smaller armies make no progress.
  - Besiegers lose men to sickness and sallies.
  - With 3,000 men a siege takes about 18 days with no walls, 55 behind a palisade, 110 against stone walls and about 200 against a citadel.
  - Walls also help defenders in battle and against raids.
  - Any time during a siege you can *storm the walls*. The panel shows your odds. Storming is bloody and gets easier the longer the siege has run. Bronze warriors climb best; chariots can't. A stormed place loses a wall level.
  - Build or raise walls in your own provinces for trade goods and metal; the work takes months. AI realms fortify their capitals too.
- **Diplomacy:** the *🕊 Diplomacy* button in the top bar lists every realm within reach, nearest first, with its opinion of you and your ties. Click one to open its panel, which shows its opinion and the reasons for it ("They raided us while we were allies −60").
  - **Alliances** are defensive pacts. When an ally is attacked, you get a *call to arms*. Refusing a defensive call ends the alliance, costs 15 prestige, and leaves a grudge. When you attack, allies who like you join; the rest refuse.
  - **Trade pacts** earn both partners trade goods every month and slowly warm relations. A realm can keep 1 pact, plus 1 more for every 3 provinces, up to 5. War, raids, or tearing up a pact end it, and the partner resents it.
  - **Marriage:** kin are likelier to ally and to answer calls to arms, and attacking kin costs prestige. A family member's panel has *Find a match*, which lists possible spouses at nearby courts and whether each court would accept.
  - **Truces** last 5 years after a war. You can break one, but it costs 25 prestige, 10 stability and 30 infamy. Every neighbor hears of it, and honorable realms may join the war against you.
- **Betrayal and revenge:** the AI remembers.
  - These count as betrayals: raiding an ally, raiding during a truce, raiding a trade partner, tearing up a pact, breaking an alliance, and abandoning an ally.
  - Each one costs you opinion with the victim and earns its grudge. Grudges fade a point a month.
  - A strong victim declares a war of vengeance; a weak one looks for allies among your enemies or pays you back with schemes.
  - When it is done to you, you choose: swear vengeance (a war that earns no infamy), demand reparations, or let it pass.
- **Reputation (infamy):** it rises with wars of conquest, broken truces, raids on friends, and discovered schemes, and fades over the years.
  - High infamy makes every deal harder.
  - From *Infamous* (45) your neighbors form a coalition and ally with each other against you.
  - At *Pariah* (65) the coalition may march on you together.
- **Schemes:** one at a time, started from a realm's panel; bribes are paid up front.
  - *Sway* raises their opinion of you and softens grudges. *Incite unrest* costs them stability and stirs revolt. *Steal treasure* takes trade goods and metal. *Murder* kills their ruler.
  - *Fabricate claim* forges a claim on one of their provinces. A war for a claimed province earns almost no infamy.
  - Secrecy falls as the scheme runs. A discovered scheme earns the victim's hatred and some infamy.
  - AI rulers with grudges scheme too.
- **Saving:** `F5` quicksaves. The ☰ menu saves with a name, exports a `.aisave` file, or toggles the debug overlay (`F3`).
- **Game over:** you play your dynasty, not a realm. When your ruler dies the heir takes over. The game ends only when your dynasty holds no throne.

## Architecture

```
src/sim/      deterministic simulation; never imports from ui/ or render/
  world.ts      struct-of-arrays state (typed arrays, integer ids)
  tick.ts       daily / monthly / yearly tiers, staggered AI, detail levels by region
  systems/      characters, succession, realms, economy, pressure, war, military,
                relations (trade pacts, grudges, infamy, betrayals, coalitions),
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
