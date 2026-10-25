import { describe, expect, it } from 'vitest';
import { gameData } from './helpers';
import { SEA } from '../src/sim/mapgen';

describe('map generation', () => {
  it('gives every province pixels, an anchor on itself, and neighbors', async () => {
    const { map: m, scenario } = await gameData();
    expect(m.provinceCount).toBe(scenario.provinces.length);
    for (let p = 0; p < m.provinceCount; p++) {
      expect(m.pixelCount[p], scenario.provinces[p].name).toBeGreaterThan(150);
      expect(m.ids[m.anchorY[p] * m.width + m.anchorX[p]]).toBe(p);
      expect(m.adjOffset[p + 1] - m.adjOffset[p], scenario.provinces[p].name).toBeGreaterThan(0);
    }
  });

  it('connects every province to every other (islands by sea)', async () => {
    const { map: m } = await gameData();
    const P = m.provinceCount;
    for (let t = 0; t < P; t++) for (let f = 0; f < P; f++) expect(m.nextHop[t * P + f]).toBeGreaterThanOrEqual(0);
  });

  it('has symmetric adjacency', async () => {
    const { map: m } = await gameData();
    for (let p = 0; p < m.provinceCount; p++) {
      for (let e = m.adjOffset[p]; e < m.adjOffset[p + 1]; e++) {
        const q = m.adj[e];
        let back = false;
        for (let k = m.adjOffset[q]; k < m.adjOffset[q + 1]; k++) if (m.adj[k] === p) back = true;
        expect(back).toBe(true);
      }
    }
  });

  it('marks islands as coastal and has sea', async () => {
    const { map: m, scenario } = await gameData();
    const crete = scenario.provinces.findIndex((p) => p.name === 'Knossos');
    expect(m.coastal[crete]).toBe(1);
    expect(m.ids.includes(SEA)).toBe(true);
  });
});
