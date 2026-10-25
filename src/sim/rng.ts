/**
 * Deterministic seeded RNG (sfc32). State lives in a Uint32Array so it can be
 * saved/restored byte-for-byte, which keeps saves and bug reproductions exact.
 */
export class Rng {
  readonly s = new Uint32Array(4);

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // splitmix32 to spread the seed across the state words
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
    for (let i = 0; i < 12; i++) this.u32();
  }

  u32(): number {
    const s = this.s;
    const a = s[0], b = s[1], c = s[2], d = s[3];
    const t = (((a + b) >>> 0) + d) >>> 0;
    s[3] = (d + 1) >>> 0;
    s[0] = b ^ (b >>> 9);
    s[1] = (c + (c << 3)) >>> 0;
    const r = (c << 21) | (c >>> 11);
    s[2] = (r + t) >>> 0;
    return t;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}
