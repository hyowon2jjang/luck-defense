/**
 * Seeded PRNG (mulberry32).
 *
 * Every random draw in the game must go through this. Math.random() is banned
 * in `core/` — determinism is what makes replays, bug reproduction and the
 * headless balance simulator possible.
 */
export class Rng {
  private state: number

  constructor(public readonly seed: number) {
    this.state = seed >>> 0
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Snapshot for save/replay. */
  serialize(): { seed: number; state: number } {
    return { seed: this.seed, state: this.state }
  }

  static deserialize(data: { seed: number; state: number }): Rng {
    const rng = new Rng(data.seed)
    rng.state = data.state >>> 0
    return rng
  }
}
