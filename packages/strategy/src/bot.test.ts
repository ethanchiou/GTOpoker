import { cardFromString, createRng, type Card } from '@gto/hand-eval'
import type { DecisionPoint, GameNodeKey } from '@gto/poker-engine'
import { describe, expect, it } from 'vitest'
import { decideGtoAction, resolveActionId, sampleActionId } from './bot'
import { PreflopChartProvider } from './preflop-chart'
import { SEED_CHART } from './seed-chart'

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
    legalActions: [
      { type: 'fold' },
      { type: 'call', min: 100, max: 100 },
      { type: 'raise', min: 200, max: 10_000 },
    ],
    sizeOptions: [],
    nodeKey: { street: 'preflop', heroPosition: 'BTN', board: [], history: [] } as GameNodeKey,
    ...overrides,
  }
}

describe('sampleActionId', () => {
  it('samples proportionally to frequency', () => {
    const rng = createRng('sample')
    const counts: Record<string, number> = { a: 0, b: 0 }
    for (let i = 0; i < 20_000; i++) {
      counts[sampleActionId([{ actionId: 'a', frequency: 0.7 }, { actionId: 'b', frequency: 0.3 }], rng)]!++
    }
    expect(counts.a! / 20_000).toBeGreaterThan(0.66)
    expect(counts.a! / 20_000).toBeLessThan(0.74)
  })
})

describe('resolveActionId', () => {
  it('maps chart action ids to legal engine actions', () => {
    expect(resolveActionId('fold', dp())).toEqual({ type: 'fold' })
    expect(resolveActionId('call', dp())).toEqual({ type: 'call' })
    expect(resolveActionId('raiseTo:2.5', dp())).toEqual({ type: 'raise', amount: 250 })
  })

  it('clamps raise amounts into the legal band', () => {
    expect(resolveActionId('raiseTo:1', dp())).toEqual({ type: 'raise', amount: 200 }) // below min → min
    expect(resolveActionId('raiseTo:500', dp())).toEqual({ type: 'raise', amount: 10_000 }) // above max → all-in
  })

  it('maps charted all-in to the max legal raise amount', () => {
    expect(resolveActionId('allIn', dp())).toEqual({ type: 'raise', amount: 10_000 })
  })

  it('returns null for an action that is not legal here', () => {
    expect(resolveActionId('check', dp())).toBeNull() // facing a bet
  })
})

describe('decideGtoAction', () => {
  const provider = new PreflopChartProvider(SEED_CHART)

  it('opens AA from the BTN (pure raise)', async () => {
    const action = await decideGtoAction(dp({ heroHoleCards: hole('Ah', 'Ad') }), provider, createRng('a'))
    expect(action).toEqual({ type: 'raise', amount: 250 })
  })

  it('falls back to fold/check when the node is unsupported', async () => {
    const unsupported = dp({
      // Cold 4-bet/deeper spot → no seed chart support → fallback.
      nodeKey: {
        street: 'preflop',
        heroPosition: 'BTN',
        board: [],
        history: [
          { seatIndex: 4, position: 'CO', street: 'preflop', action: { type: 'raise', amount: 250 } },
          { seatIndex: 0, position: 'BTN', street: 'preflop', action: { type: 'raise', amount: 800 } },
        ],
      } as GameNodeKey,
    })
    const action = await decideGtoAction(unsupported, provider, createRng('b'))
    expect(['fold', 'check']).toContain(action.type)
  })
})
