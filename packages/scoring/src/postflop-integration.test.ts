import { createRng } from '@gto/hand-eval'
import { applyAction, applyActions, createHand, decisionPoint, type Card, type HandState } from '@gto/poker-engine'
import { makeCard } from '@gto/hand-eval'
import {
  BaselineSolverTransport,
  CompositeStrategyProvider,
  decideGtoAction,
  PostflopSolverProvider,
  PreflopChartProvider,
  SEED_CHART,
} from '@gto/strategy'
import { describe, expect, it } from 'vitest'
import { scoreFromStrategy, type Classification } from './score'
import { createSessionStats, noteHandComplete, recordDecision } from './session'

/**
 * Phase-2 cross-package smoke: drive a hand to a heads-up flop decision through
 * the composite provider (preflop charts → postflop solver), grade the hero's
 * postflop decision with real per-action EV, then let bots play out postflop via
 * the solver — chips conserved, hand completes.
 */
describe('postflop play loop (engine × handoff × solver × scoring)', () => {
  const preflop = new PreflopChartProvider(SEED_CHART)
  const postflop = new PostflopSolverProvider(new BaselineSolverTransport({ iterations: 120 }), preflop)
  const provider = new CompositeStrategyProvider([preflop, postflop])
  const VALID: Classification[] = ['best', 'correct', 'inaccuracy', 'wrong', 'blunder']
  const stacksTotal = (s: HandState) => s.seats.reduce((sum, seat) => sum + seat.stack, 0)

  // BTN open, folds around, BB (hero, seat 2) calls → heads-up flop.
  function toFlop(): HandState {
    const holeCards: Array<[Card, Card]> = [
      [makeCard(12, 3), makeCard(11, 3)], // BTN AKs
      [makeCard(7, 0), makeCard(3, 0)], // SB
      [makeCard(5, 1), makeCard(4, 1)], // BB 76d (hero)
      [makeCard(0, 0), makeCard(1, 1)], // UTG
      [makeCard(0, 2), makeCard(1, 3)], // HJ
      [makeCard(2, 0), makeCard(3, 2)], // CO
    ]
    const hand = createHand({ handId: 'pf-int', buttonIndex: 0, heroSeat: 2, seed: 'pf-int-board', holeCards })
    return applyActions(hand, [
      { type: 'fold' }, // UTG
      { type: 'fold' }, // HJ
      { type: 'fold' }, // CO
      { type: 'raise', amount: 250 }, // BTN open
      { type: 'fold' }, // SB
      { type: 'call' }, // BB → flop
    ])
  }

  it('grades a heads-up flop decision with real (non-estimated) per-action EV', async () => {
    const state = toFlop()
    const dp = decisionPoint(state)!
    expect(dp.street).toBe('flop')
    expect(dp.seatIndex).toBe(2)
    expect(provider.supports(dp.nodeKey)).toBe(true)

    const strategy = await provider.getStrategy(dp.nodeKey)
    expect(strategy.meta.source).toBe('solver')

    const score = scoreFromStrategy({ type: 'check' }, dp, strategy)
    expect(VALID).toContain(score.classification)
    expect(score.estimated).toBe(false) // real per-action EV, not the chart estimate
    expect(Number.isFinite(score.evLossBb)).toBe(true)
    expect(score.evLossBb).toBeGreaterThanOrEqual(0)
    expect(score.strategyRow.every((a) => a.ev !== undefined)).toBe(true)

    const stats = createSessionStats()
    recordDecision(stats, score, { street: dp.street, position: dp.position })
    expect(stats.byStreet.flop?.decisions).toBe(1)
  })

  it('lets bots play out postflop via the solver, conserving chips to completion', async () => {
    const rng = createRng('pf-runout')
    let state = toFlop()
    for (let i = 0; i < 200 && state.phase === 'betting'; i++) {
      const dp = decisionPoint(state)
      if (!dp) break
      state = applyAction(state, await decideGtoAction(dp, provider, rng))
    }
    noteHandComplete(createSessionStats())
    expect(state.phase).toBe('complete')
    expect(state.result).not.toBeNull()
    expect(stacksTotal(state)).toBe(state.config.startingStackChips * state.config.numSeats)
  })
})
