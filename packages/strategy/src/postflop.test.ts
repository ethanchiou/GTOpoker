import { makeCard, type Card } from '@gto/hand-eval'
import { applyActions, createHand, decisionPoint, type ActionRecord } from '@gto/poker-engine'
import { describe, expect, it } from 'vitest'
import { BaselineSolverTransport } from './baseline-transport'
import { handClass, type HandClass } from './hand-class'
import { PostflopSolverProvider } from './postflop-provider'
import type { Range } from './postflop-types'
import { PreflopChartProvider } from './preflop-chart'
import { buildPreflopRange, inHandPositions } from './range-handoff'
import { SEED_CHART } from './seed-chart'

const preflop = new PreflopChartProvider(SEED_CHART)

/** Collapse a combo range to a class→weight map (combos in a class share weight). */
function classWeights(range: Range): Map<HandClass, number> {
  const out = new Map<HandClass, number>()
  for (const { hand, weight } of range) out.set(handClass(hand[0], hand[1]), weight)
  return out
}

// A BTN open (2.5bb), folds around, BB calls → heads-up to the flop.
const BTN_VS_BB_HISTORY: ActionRecord[] = [
  { seatIndex: 3, position: 'UTG', street: 'preflop', action: { type: 'fold' } },
  { seatIndex: 4, position: 'HJ', street: 'preflop', action: { type: 'fold' } },
  { seatIndex: 5, position: 'CO', street: 'preflop', action: { type: 'fold' } },
  { seatIndex: 0, position: 'BTN', street: 'preflop', action: { type: 'raise', amount: 250 } },
  { seatIndex: 1, position: 'SB', street: 'preflop', action: { type: 'fold' } },
  { seatIndex: 2, position: 'BB', street: 'preflop', action: { type: 'call', amount: 250 } },
]

describe('inHandPositions', () => {
  it('excludes folded seats and keeps callers/raisers', () => {
    expect(inHandPositions(BTN_VS_BB_HISTORY).sort()).toEqual(['BB', 'BTN'])
  })

  it('counts every non-folder in a multiway pot', () => {
    const multiway: ActionRecord[] = [
      { seatIndex: 5, position: 'CO', street: 'preflop', action: { type: 'raise', amount: 250 } },
      { seatIndex: 0, position: 'BTN', street: 'preflop', action: { type: 'call', amount: 250 } },
      { seatIndex: 1, position: 'SB', street: 'preflop', action: { type: 'fold' } },
      { seatIndex: 2, position: 'BB', street: 'preflop', action: { type: 'call', amount: 250 } },
    ]
    expect(inHandPositions(multiway).sort()).toEqual(['BB', 'BTN', 'CO'])
  })
})

describe('preflop→flop range handoff', () => {
  it('builds the opener range from the chart open frequencies', async () => {
    const range = await buildPreflopRange('BTN', BTN_VS_BB_HISTORY, preflop, [], 100)
    const w = classWeights(range)
    expect(w.get('AA')).toBeCloseTo(1, 5) // always opens
    expect(w.get('A5o')).toBeCloseTo(0.5, 5) // mixed 50% open in the seed chart
    expect(w.get('72o') ?? 0).toBe(0) // never opened → not in the flop range
  })

  it('builds the caller range from the chart call frequencies (3-bet-only hands drop out)', async () => {
    const range = await buildPreflopRange('BB', BTN_VS_BB_HISTORY, preflop, [], 100)
    const w = classWeights(range)
    // AA is a pure 3-bet for BB vs BTN in the seed chart → it called 0% → excluded.
    expect(w.get('AA') ?? 0).toBe(0)
    // 76s is in BB's flat-call range.
    expect((w.get('76s') ?? 0) > 0).toBe(true)
  })

  it('removes board cards from the range', async () => {
    const board: Card[] = [makeCard(12, 3), makeCard(12, 2), makeCard(0, 0)] // As Ah 2c
    const range = await buildPreflopRange('BTN', BTN_VS_BB_HISTORY, preflop, board, 100)
    for (const { hand } of range) {
      expect(board.includes(hand[0])).toBe(false)
      expect(board.includes(hand[1])).toBe(false)
    }
  })
})

describe('BaselineSolverTransport', () => {
  it('produces a valid per-combo strategy with EV on every action', async () => {
    const transport = new BaselineSolverTransport({ iterations: 200 })
    const board: Card[] = [makeCard(12, 3), makeCard(12, 2), makeCard(0, 0)] // As Ah 2c
    const hero: Range = [{ hand: [makeCard(11, 1), makeCard(11, 0)], weight: 1 }] // KdKc
    const villain: Range = [{ hand: [makeCard(10, 1), makeCard(9, 1)], weight: 1 }] // QdJd
    const res = await transport.solve({
      board,
      heroRange: hero,
      villainRange: villain,
      potChips: 600,
      effectiveStackChips: 9750,
      bigBlindChips: 100,
      toCallChips: 0,
      betFractions: [0.33, 0.75],
    })
    expect(res.meta.approximate).toBe(true)
    expect(res.hero).toHaveLength(1)
    const row = res.hero[0]!.actions
    expect(row.reduce((s, a) => s + a.frequency, 0)).toBeCloseTo(1, 2)
    for (const a of row) expect(typeof a.ev).toBe('number')
    expect(row.some((a) => a.actionId === 'check')).toBe(true)
  })

  it('bets more with a stronger hand (EV-driven aggression is monotonic in equity)', async () => {
    const transport = new BaselineSolverTransport({ iterations: 400 })
    const board: Card[] = [makeCard(12, 3), makeCard(12, 2), makeCard(0, 0)] // As Ah 2c
    const villain: Range = [{ hand: [makeCard(10, 1), makeCard(9, 1)], weight: 1 }] // QdJd
    const req = {
      board,
      villainRange: villain,
      potChips: 600,
      effectiveStackChips: 9750,
      bigBlindChips: 100,
      toCallChips: 0,
      betFractions: [0.33, 0.75],
    }
    const strong = await transport.solve({ ...req, heroRange: [{ hand: [makeCard(11, 1), makeCard(11, 0)], weight: 1 }] }) // KK (two pair)
    const weak = await transport.solve({ ...req, heroRange: [{ hand: [makeCard(5, 0), makeCard(3, 1)], weight: 1 }] }) // 75o

    const aggression = (row: { actionId: string; frequency: number }[]) =>
      row.filter((a) => a.actionId !== 'check').reduce((s, a) => s + a.frequency, 0)

    expect(aggression(strong.hero[0]!.actions)).toBeGreaterThanOrEqual(aggression(weak.hero[0]!.actions))
  })

  it('offers raises (not just fold/call) when facing a bet', async () => {
    const transport = new BaselineSolverTransport({ iterations: 400 })
    const board: Card[] = [makeCard(12, 3), makeCard(7, 0), makeCard(2, 1)] // As 9c 4d
    const hero: Range = [{ hand: [makeCard(7, 1), makeCard(7, 2)], weight: 1 }] // 9d9h (set of nines)
    const villain: Range = [{ hand: [makeCard(11, 1), makeCard(10, 1)], weight: 1 }] // KdQd (overcards)
    const res = await transport.solve({
      board,
      heroRange: hero,
      villainRange: villain,
      potChips: 600,
      effectiveStackChips: 9400, // ~94bb → high SPR, no all-in offered
      bigBlindChips: 100,
      toCallChips: 300, // facing a 3bb bet
      betFractions: [0.5, 1],
    })
    const row = res.hero[0]!.actions
    expect(row.reduce((s, a) => s + a.frequency, 0)).toBeCloseTo(1, 2)
    expect(row.some((a) => a.actionId === 'fold')).toBe(true)
    expect(row.some((a) => a.actionId === 'call')).toBe(true)
    // The set wants to raise: a raise size exists and carries real frequency.
    const raises = row.filter((a) => a.actionId.startsWith('raiseTo:'))
    expect(raises.length).toBeGreaterThan(0)
    expect(raises.reduce((s, a) => s + a.frequency, 0)).toBeGreaterThan(0)
    // High SPR → no flop jam.
    expect(row.some((a) => a.actionId === 'allIn')).toBe(false)
  })
})

describe('PostflopSolverProvider', () => {
  const provider = new PostflopSolverProvider(new BaselineSolverTransport({ iterations: 150 }), preflop)

  // Drive a real hand to a heads-up BTN-vs-BB flop decision.
  function flopNode() {
    const holeCards: Array<[Card, Card]> = [
      [makeCard(12, 3), makeCard(11, 3)], // seat0 BTN: AKs
      [makeCard(7, 0), makeCard(3, 0)], // seat1 SB: 95c (folds)
      [makeCard(5, 1), makeCard(4, 1)], // seat2 BB: 76d
      [makeCard(0, 0), makeCard(1, 1)], // seat3 UTG
      [makeCard(0, 2), makeCard(1, 3)], // seat4 HJ
      [makeCard(2, 0), makeCard(3, 2)], // seat5 CO
    ]
    const hand = createHand({ handId: 'flop-test', buttonIndex: 0, heroSeat: 2, seed: 'board-1', holeCards })
    const state = applyActions(hand, [
      { type: 'fold' }, // UTG
      { type: 'fold' }, // HJ
      { type: 'fold' }, // CO
      { type: 'raise', amount: 250 }, // BTN open 2.5bb
      { type: 'fold' }, // SB
      { type: 'call' }, // BB calls → flop
    ])
    return decisionPoint(state)!
  }

  it('supports heads-up postflop nodes only', () => {
    const dp = flopNode()
    expect(dp.street).toBe('flop')
    expect(provider.supports(dp.nodeKey)).toBe(true)

    const preflopNode = { ...dp.nodeKey, street: 'preflop' as const, board: [] }
    expect(provider.supports(preflopNode)).toBe(false)
  })

  it('returns a solver NodeStrategy with real per-action EV', async () => {
    const dp = flopNode()
    const strat = await provider.getStrategy(dp.nodeKey)
    expect(strat.meta.source).toBe('solver')
    expect(Object.keys(strat.grid).length).toBeGreaterThan(0)
    for (const row of Object.values(strat.grid)) {
      expect(row.reduce((s, a) => s + a.frequency, 0)).toBeCloseTo(1, 1)
      for (const a of row) expect(a.ev).toBeTypeOf('number')
    }
  })
})
