import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.u32());
    const sb = Array.from({ length: 50 }, () => b.u32());
    const sc = Array.from({ length: 50 }, () => c.u32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('can be restored from its state', () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(1);
    b.s.set(a.s);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it('stays in range', () => {
    const r = new Rng(3);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r.int(5)).toBeLessThan(5);
    }
  });
});
