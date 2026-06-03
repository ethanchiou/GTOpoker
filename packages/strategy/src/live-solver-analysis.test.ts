import { describe, expect, it } from 'vitest'
import {
  analyzeActionRow,
  bestActionByEv,
  isAggressiveActionId,
  postflopSizePresets,
  raiseToBb,
} from './live-solver-analysis'
import type { ActionFrequency } from './types'

describe('postflopSizePresets', () => {
  it('maps flop preset fractions to first-in bet-to chip amounts', () => {
    const presets = postflopSizePresets({
      street: 'flop',
      facing: false,
      potChips: 800,
      toCallChips: 0,
      heroCommittedChips: 0,
      villainCommittedChips: 0,
      min: 100,
      max: 10_000,
    })

    expect(presets.map((p) => ({ fraction: p.fraction, chips: p.chips, allIn: p.allIn }))).toEqual([
      { fraction: 0.25, chips: 200, allIn: false },
      { fraction: 0.5, chips: 400, allIn: false },
      { fraction: 0.75, chips: 600, allIn: false },
      { fraction: null, chips: 10_000, allIn: true },
    ])
  })

  it('maps facing-a-bet preset fractions to legal raise-to chip amounts', () => {
    const presets = postflopSizePresets({
      street: 'turn',
      facing: true,
      potChips: 1_000,
      toCallChips: 300,
      heroCommittedChips: 0,
      villainCommittedChips: 300,
      min: 600,
      max: 5_000,
    })

    expect(presets.map((p) => p.chips)).toEqual([950, 1_275, 1_925, 5_000])
  })

  it('clamps, dedupes, and omits all-in when requested', () => {
    const presets = postflopSizePresets({
      street: 'flop',
      facing: false,
      potChips: 400,
      toCallChips: 0,
      heroCommittedChips: 0,
      villainCommittedChips: 0,
      min: 350,
      max: 600,
      includeAllIn: false,
    })

    expect(presets.map((p) => p.chips)).toEqual([350])
  })
})

describe('action row analysis', () => {
  const row: ActionFrequency[] = [
    { actionId: 'check', frequency: 0.6, ev: 1.2 },
    { actionId: 'raiseTo:5.5', frequency: 0.25, ev: 1.35 },
    { actionId: 'raiseTo:8', frequency: 0.1, ev: 1.1 },
    { actionId: 'allIn', frequency: 0.05, ev: 0.8 },
  ]

  it('selects the best EV action and best aggressive size', () => {
    expect(bestActionByEv(row)?.actionId).toBe('raiseTo:5.5')
    expect(analyzeActionRow(row, row[2]!)?.bestAggressive?.actionId).toBe('raiseTo:5.5')
  })

  it('reports preview EV delta against the best action', () => {
    expect(analyzeActionRow(row, row[2]!)?.previewDeltaVsBest).toBe(-0.25)
  })

  it('falls back to frequency when EV is unavailable', () => {
    const noEv: ActionFrequency[] = [
      { actionId: 'check', frequency: 0.4 },
      { actionId: 'raiseTo:6', frequency: 0.6 },
    ]
    expect(bestActionByEv(noEv)?.actionId).toBe('raiseTo:6')
  })

  it('parses aggressive action ids', () => {
    expect(raiseToBb('raiseTo:7.25')).toBe(7.25)
    expect(raiseToBb('call')).toBeNull()
    expect(isAggressiveActionId('raiseTo:7.25')).toBe(true)
    expect(isAggressiveActionId('allIn')).toBe(true)
    expect(isAggressiveActionId('call')).toBe(false)
  })
})
