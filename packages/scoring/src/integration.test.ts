import { createRng } from '@gto/hand-eval'
import { applyAction, createHand, decisionPoint, runToShowdown, type HandState } from '@gto/poker-engine'
import { decideGtoAction, PreflopChartProvider, SEED_CHART } from '@gto/strategy'
import { describe, expect, it } from 'vitest'
import { scoreFromStrategy, type Classification } from './score'
import { createSessionStats, noteHandComplete, recordDecision } from './session'

/**
 * Cross-package smoke of the whole core loop (spec §15 manual-verification, as an
 * automated test): deal a 6-max hand, let bots act from the GTO strategy, score
 * the hero's preflop decision, and run out to showdown — all chips conserved.
 */
describe('core play loop (engine × strategy × scoring)', () => {
  const provider = new PreflopChartProvider(SEED_CHART)
  const VALID: Classification[] = ['best', 'correct', 'inaccuracy', 'wrong', 'blunder']
  const stacksTotal = (s: HandState) => s.seats.reduce((sum, seat) => sum + seat.stack, 0)

  it('plays a hand where the hero (UTG) faces an RFI decision, scores it, and conserves chips', async () => {
    const botRng = createRng('bots-seed')
    // buttonIndex 0 → seat 3 is UTG (first to act preflop).
    const heroSeat = 3
    let state = createHand({
      handId: 'integration-1',
      buttonIndex: 0,
      heroSeat,
      controllers: ['bot', 'bot', 'bot', 'human', 'bot', 'bot'],
      seed: 'integration-1',
    })

    const stats = createSessionStats()
    let heroScored = false

    while (state.phase === 'betting' && state.street === 'preflop') {
      const dpoint = decisionPoint(state)!
      if (dpoint.seatIndex === heroSeat) {
        // UTG with no prior raise → an RFI spot the seed chart supports.
        expect(provider.supports(dpoint.nodeKey)).toBe(true)
        expect(dpoint.heroHoleCards).toHaveLength(2)
        const strategy = await provider.getStrategy(dpoint.nodeKey)
        const heroAction = { type: 'fold' } as const
        const score = scoreFromStrategy(heroAction, dpoint, strategy)
        expect(VALID).toContain(score.classification)
        expect(score.strategyRow.length).toBeGreaterThan(0)
        recordDecision(stats, score, { street: dpoint.street, position: dpoint.position })
        heroScored = true
        state = applyAction(state, heroAction)
      } else {
        state = applyAction(state, await decideGtoAction(dpoint, provider, botRng))
      }
    }

    if (state.phase === 'betting') state = runToShowdown(state)
    noteHandComplete(stats)

    expect(heroScored).toBe(true)
    expect(state.phase).toBe('complete')
    expect(state.result).not.toBeNull()
    expect(stacksTotal(state)).toBe(state.config.startingStackChips * state.config.numSeats)
    expect(stats.overall.decisions).toBe(1)
    expect(stats.hands).toBe(1)
  })

  it('is fully reproducible from the same seeds', async () => {
    const run = async () => {
      const botRng = createRng('det')
      let state = createHand({ handId: 'det', buttonIndex: 2, heroSeat: 5, seed: 'det-seed' })
      while (state.phase === 'betting') {
        const dpoint = decisionPoint(state)
        if (!dpoint) break
        state = applyAction(state, await decideGtoAction(dpoint, provider, botRng))
        if (state.street !== 'preflop' && state.phase === 'betting') {
          state = runToShowdown(state)
        }
      }
      return state
    }
    const a = await run()
    const b = await run()
    expect(a.board).toEqual(b.board)
    expect(a.result?.payouts).toEqual(b.result?.payouts)
  })
})
