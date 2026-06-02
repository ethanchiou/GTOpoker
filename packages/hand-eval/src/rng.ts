/**
 * Seedable, serializable PRNG for reproducible deals (spec §5.2, §10).
 *
 * Uses mulberry32 (a fast, well-distributed 32-bit generator) seeded by an
 * xmur3 hash of a string/number seed. The whole point is reproducibility: the
 * same seed always yields the same sequence, so a recorded session can be
 * replayed exactly and tests are deterministic. State is a single uint32, so
 * it serializes trivially.
 *
 * This is a *training* tool, not a real-money RNG — the bar is "uniform and
 * reproducible", not "cryptographically unpredictable".
 */

export interface SeededRng {
  /** Next unsigned 32-bit integer. */
  nextU32(): number
  /** Next float in [0, 1). */
  nextFloat(): number
  /** Next integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number
  /** Serialize the generator's internal state. */
  getState(): number
  /** Restore a previously serialized state. */
  setState(state: number): void
}

/** Hash an arbitrary string into a uint32 (xmur3, one output). */
export function hashSeed(seed: string | number): number {
  const str = typeof seed === 'number' ? `${seed}` : seed
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h ^= h >>> 16
  return h >>> 0
}

class Mulberry32 implements SeededRng {
  private a: number

  constructor(state: number) {
    this.a = state >>> 0
  }

  nextU32(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }

  nextFloat(): number {
    return this.nextU32() / 0x100000000
  }

  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new Error(`nextInt requires maxExclusive > 0, got ${maxExclusive}`)
    return Math.floor(this.nextFloat() * maxExclusive)
  }

  getState(): number {
    return this.a >>> 0
  }

  setState(state: number): void {
    this.a = state >>> 0
  }
}

/** Create a generator from a string/number seed. */
export function createRng(seed: string | number): SeededRng {
  return new Mulberry32(hashSeed(seed))
}

/** Create a generator directly from a serialized state (e.g. for replay). */
export function rngFromState(state: number): SeededRng {
  return new Mulberry32(state)
}
