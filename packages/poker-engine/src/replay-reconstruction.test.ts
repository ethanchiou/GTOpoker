import { describe, expect, it } from 'vitest'
import { applyAction, applyActions, createHand, decisionPoint } from './hand'
import type { Action, HandState } from './types'

/**
 * The hand replayer (apps/web) reconstructs a hand by re-creating it from the
 * same handId/seed and re-applying its recorded action history. This guards that
 * core assumption: a seed-rebuilt hand + its history reproduces the identical
 * board, payouts, and per-seat contributions (spec §5.6, §10).
 */
describe('replay reconstruction (seed + history → identical hand)', () => {
  const opts = {
    handId: 'replay-seed-1',
    seed: 'replay-seed-1',
    buttonIndex: 2,
    heroSeat: 0,
    controllers: Array.from({ length: 6 }, () => 'bot' as const),
  }

  // A deterministic, fold-free line: call when facing a bet, else check.
  const policy = (state: HandState): Action => {
    const dp = decisionPoint(state)!
    if (dp.legalActions.some((l) => l.type === 'call')) return { type: 'call' }
    if (dp.legalActions.some((l) => l.type === 'check')) return { type: 'check' }
    return { type: 'fold' }
  }

  function playOut(): HandState {
    let state = createHand(opts)
    let guard = 0
    while (state.phase === 'betting' && guard++ < 100) {
      state = applyAction(state, policy(state))
    }
    return state
  }

  it('reproduces board, payouts, and contributions from the history', () => {
    const live = playOut()
    expect(live.phase).toBe('complete')
    expect(live.history.length).toBeGreaterThan(0)

    const rebuilt = applyActions(
      createHand(opts),
      live.history.map((r) => r.action),
    )

    expect(rebuilt.phase).toBe('complete')
    expect(rebuilt.board).toEqual(live.board)
    expect(rebuilt.result?.payouts).toEqual(live.result?.payouts)
    expect(rebuilt.seats.map((s) => s.holeCards)).toEqual(live.seats.map((s) => s.holeCards))
    expect(rebuilt.seats.map((s) => s.committedTotal)).toEqual(live.seats.map((s) => s.committedTotal))
    expect(rebuilt.seats.map((s) => s.stack)).toEqual(live.seats.map((s) => s.stack))
  })

  it('reconstructs a consistent state at every intermediate step', () => {
    const live = playOut()
    const actions = live.history.map((r) => r.action)
    // Each prefix replays without throwing and ends on the right street ordering.
    let prevBoardLen = 0
    for (let k = 0; k <= actions.length; k++) {
      const step = applyActions(createHand(opts), actions.slice(0, k))
      expect(step.board.length).toBeGreaterThanOrEqual(prevBoardLen)
      prevBoardLen = step.board.length
    }
  })
})
