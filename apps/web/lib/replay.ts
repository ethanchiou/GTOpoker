import { applyAction, createHand, type ActionRecord, type HandState } from '@gto/poker-engine'

export interface ReplayStep {
  state: HandState
  /** The action applied to reach this step (null for the initial post-blinds state). */
  lastAction: ActionRecord | null
}

export interface ReplayParams {
  heroSeat: number
  controllers: ('human' | 'bot')[]
}

/**
 * Reconstruct a hand as an array of stepwise states by replaying its action
 * history from a deterministically rebuilt initial state. The engine is a pure,
 * seed-driven reducer (spec §5.6, §10), so re-creating the hand with the same
 * handId/seed/button reproduces the identical deck — hole cards *and* board — and
 * applying the recorded actions in order reproduces every intermediate state.
 * Opponent cards stay hidden until the final (settled) step, exactly as in live
 * play, because the table reveals on `phase === 'complete'`.
 */
export function buildReplaySteps(final: HandState, params: ReplayParams): ReplayStep[] {
  const initial = createHand({
    handId: final.handId,
    seed: final.handId,
    buttonIndex: final.buttonIndex,
    heroSeat: params.heroSeat,
    controllers: params.controllers,
    config: final.config,
  })

  const steps: ReplayStep[] = [{ state: initial, lastAction: null }]
  let state = initial
  for (const record of final.history) {
    state = applyAction(state, record.action)
    steps.push({ state, lastAction: record })
  }
  return steps
}
