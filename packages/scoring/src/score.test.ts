import { cardFromString, type Card } from '@gto/hand-eval'
import type { DecisionPoint, GameNodeKey } from '@gto/poker-engine'
import type { ActionFrequency, NodeStrategy, StrategyMeta } from '@gto/strategy'
import { describe, expect, it } from 'vitest'
import { scoreDecision, scoreFromStrategy } from './score'

const META: StrategyMeta = { source: 'chart', confidence: 'low', rakeAssumption: 'none', version: 't' }
const hole = (a: string, b: string): readonly [Card, Card] => [cardFromString(a), cardFromString(b)]

function dp(overrides: Partial<DecisionPoint> = {}): DecisionPoint {
  return {
    handId: 'h',
    street: 'preflop',
    seatIndex: 0,
    position: 'BTN',
    heroHoleCards: hole('Ah', 'Ad'),
    board: [],
    potChips: 150,
    toCallChips: 100,
    effectiveStackChips: 10_000,
    bigBlindChips: 100,
    actionHistory: [],
    legalActions: [],
    sizeOptions: [],
    nodeKey: { street: 'preflop', heroPosition: 'BTN', board: [], history: [] } as GameNodeKey,
    ...overrides,
  }
}

const mix: ActionFrequency[] = [
  { actionId: 'raiseTo:2.5', frequency: 0.7 },
  { actionId: 'call', frequency: 0.3 },
]

describe('scoreDecision — frequency-only (chart) model', () => {
  it('grades the modal in-mix action as Best with zero EV loss', () => {
    const s = scoreDecision({ chosen: { type: 'raise', amount: 250 }, decisionPoint: dp(), strategyRow: mix, meta: META })
    expect(s.classification).toBe('best')
    expect(s.evLossBb).toBe(0)
    expect(s.frequencyCredit).toBe(0.7)
    expect(s.estimated).toBe(false)
  })

  it('grades a lower-frequency in-mix action as Correct with partial credit', () => {
    const s = scoreDecision({ chosen: { type: 'call' }, decisionPoint: dp(), strategyRow: mix, meta: META })
    expect(s.classification).toBe('correct')
    expect(s.frequencyCredit).toBe(0.3)
    expect(s.bestActionId).toBe('raiseTo:2.5')
  })

  it('flags a pure mistake (freq 0) as estimated with positive EV loss', () => {
    const pureRaise: ActionFrequency[] = [{ actionId: 'raiseTo:2.5', frequency: 1 }]
    const s = scoreDecision({ chosen: { type: 'fold' }, decisionPoint: dp(), strategyRow: pureRaise, meta: META })
    expect(s.frequencyCredit).toBe(0)
    expect(s.estimated).toBe(true)
    expect(s.evLossBb).toBeGreaterThan(0)
    expect(['inaccuracy', 'wrong', 'blunder']).toContain(s.classification)
  })

  it('snaps an off-tree bet size to the nearest tree size and flags it', () => {
    const pureRaise: ActionFrequency[] = [{ actionId: 'raiseTo:2.5', frequency: 1 }]
    const s = scoreDecision({ chosen: { type: 'raise', amount: 300 }, decisionPoint: dp(), strategyRow: pureRaise, meta: META })
    expect(s.chosenActionId).toBe('raiseTo:2.5')
    expect(s.sizeSnapped).toBe(true)
    expect(s.raiseSizeTarget).toEqual({ actionId: 'raiseTo:2.5', targetBb: 2.5, minBb: 2, maxBb: 3 })
    expect(s.classification).toBe('best') // right action, snapped size
  })

  it('does not snap a raise outside the target size band', () => {
    const pureRaise: ActionFrequency[] = [{ actionId: 'raiseTo:2.5', frequency: 1 }]
    const s = scoreDecision({ chosen: { type: 'raise', amount: 350 }, decisionPoint: dp(), strategyRow: pureRaise, meta: META })
    expect(s.chosenActionId).toBe('raiseTo:3.5')
    expect(s.sizeSnapped).toBe(false)
    expect(s.frequencyCredit).toBe(0)
    expect(['inaccuracy', 'wrong', 'blunder']).toContain(s.classification)
  })

  it('grades an all-in action from the mixed strategy row', () => {
    const fourBetMix: ActionFrequency[] = [
      { actionId: 'raiseTo:25', frequency: 0.6 },
      { actionId: 'allIn', frequency: 0.4 },
    ]
    const s = scoreDecision({
      chosen: { type: 'raise', amount: 10_000 },
      decisionPoint: dp({ legalActions: [{ type: 'raise', min: 2_000, max: 10_000 }] }),
      strategyRow: fourBetMix,
      meta: META,
    })
    expect(s.chosenActionId).toBe('allIn')
    expect(s.frequencyCredit).toBe(0.4)
    expect(s.classification).toBe('correct')
  })
})

describe('scoreDecision — EV-aware model', () => {
  const evMix: ActionFrequency[] = [
    { actionId: 'raiseTo:2.5', frequency: 0.6, ev: 1.0 },
    { actionId: 'call', frequency: 0.4, ev: 0.9 },
    { actionId: 'fold', frequency: 0, ev: 0 },
  ]

  it('computes real EV loss against the best action', () => {
    expect(scoreDecision({ chosen: { type: 'raise', amount: 250 }, decisionPoint: dp(), strategyRow: evMix, meta: META }).classification).toBe('best')
    const call = scoreDecision({ chosen: { type: 'call' }, decisionPoint: dp(), strategyRow: evMix, meta: META })
    expect(call.evLossBb).toBeCloseTo(0.1, 6)
    expect(call.classification).toBe('correct')
    const fold = scoreDecision({ chosen: { type: 'fold' }, decisionPoint: dp(), strategyRow: evMix, meta: META })
    expect(fold.evLossBb).toBeCloseTo(1.0, 6)
    expect(fold.classification).toBe('wrong')
  })
})

describe('scoreFromStrategy', () => {
  it('looks up the acting hand from a NodeStrategy', () => {
    const strategy: NodeStrategy = {
      spotId: 'rfi/BTN',
      actions: ['raiseTo:2.5', 'fold'],
      grid: { AA: [{ actionId: 'raiseTo:2.5', frequency: 1 }] },
      meta: META,
    }
    const s = scoreFromStrategy({ type: 'raise', amount: 250 }, dp({ heroHoleCards: hole('Ah', 'Ad') }), strategy)
    expect(s.classification).toBe('best')
  })
})
