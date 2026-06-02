import { describe, expect, it } from 'vitest'
import { createRng, rngFromState } from './rng'

describe('SeededRng', () => {
  it('is deterministic: same seed → same sequence', () => {
    const a = createRng('hand-42')
    const b = createRng('hand-42')
    const seqA = Array.from({ length: 100 }, () => a.nextU32())
    const seqB = Array.from({ length: 100 }, () => b.nextU32())
    expect(seqA).toEqual(seqB)
  })

  it('differs across seeds', () => {
    const a = createRng('hand-42')
    const b = createRng('hand-43')
    const seqA = Array.from({ length: 20 }, () => a.nextU32())
    const seqB = Array.from({ length: 20 }, () => b.nextU32())
    expect(seqA).not.toEqual(seqB)
  })

  it('nextFloat stays in [0, 1)', () => {
    const rng = createRng('floats')
    for (let i = 0; i < 10_000; i++) {
      const f = rng.nextFloat()
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })

  it('nextInt stays in range and covers the space roughly uniformly', () => {
    const rng = createRng('ints')
    const counts = new Array(6).fill(0)
    for (let i = 0; i < 60_000; i++) {
      const n = rng.nextInt(6)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(6)
      counts[n]++
    }
    // Each bucket should land near 10k; allow generous tolerance.
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(1_000)
  })

  it('round-trips through serialized state', () => {
    const rng = createRng('state')
    for (let i = 0; i < 10; i++) rng.nextU32()
    const snapshot = rng.getState()
    const next = rng.nextU32()

    const restored = rngFromState(snapshot)
    expect(restored.nextU32()).toBe(next)
  })

  it('nextInt rejects non-positive bounds', () => {
    const rng = createRng('x')
    expect(() => rng.nextInt(0)).toThrow()
  })
})
