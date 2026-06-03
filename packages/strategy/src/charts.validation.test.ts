import { describe, expect, it } from 'vitest'
import rawManifest from '../../../data/preflop-charts/6max_100bb_v1/manifest.json'
import { ALL_HAND_CLASSES } from './hand-class'
import { compileSpot } from './preflop-chart'
import { SEED_CHART } from './seed-chart'

/**
 * CI schema-validation for the preflop chart data (spec §6.3): the JSON must
 * load, every spot must expand to all 169 hand classes with per-cell frequencies
 * summing to ~1, every action id must be legal, and every referenced raise size
 * must be a plausible 100bb size. This is the guardrail that keeps swapped-in
 * data honest.
 */

const isLegalActionId = (id: string): boolean =>
  id === 'fold' || id === 'check' || id === 'call' || id === 'allIn' || /^raiseTo:\d+(\.\d+)?$/.test(id)

describe('preflop chart data validation', () => {
  it('has well-formed manifest metadata', () => {
    expect(typeof rawManifest.version).toBe('string')
    expect(['low', 'medium', 'high']).toContain(rawManifest.confidence)
    expect(rawManifest.spots.length).toBeGreaterThan(0)
  })

  it('loads into a typed chart set with unique spot ids', () => {
    const ids = SEED_CHART.spots.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('compiles every spot to all 169 classes with frequencies summing to 1 and legal ids', () => {
    for (const spot of SEED_CHART.spots) {
      const compiled = compileSpot(spot) // throws on range overlap > 1
      expect(Object.keys(compiled.grid).length, spot.id).toBe(169)
      for (const cls of ALL_HAND_CLASSES) {
        const row = compiled.grid[cls]!
        const sum = row.reduce((s, a) => s + a.frequency, 0)
        expect(sum, `${spot.id} ${cls}`).toBeCloseTo(1, 6)
        for (const a of row) {
          expect(a.frequency).toBeGreaterThan(0)
          expect(a.frequency).toBeLessThanOrEqual(1)
          expect(isLegalActionId(a.actionId), `${spot.id} ${a.actionId}`).toBe(true)
        }
      }
    }
  })

  it('references only plausible 100bb raise sizes', () => {
    for (const spot of SEED_CHART.spots) {
      for (const action of spot.actions) {
        const m = /^raiseTo:(\d+(?:\.\d+)?)$/.exec(action.id)
        if (!m) continue
        const sizeBb = Number(m[1])
        expect(sizeBb, `${spot.id} ${action.id}`).toBeGreaterThanOrEqual(2)
        expect(sizeBb, `${spot.id} ${action.id}`).toBeLessThanOrEqual(100)
      }
    }
  })
})
