import { DEFAULT_TABLE_CONFIG } from '@gto/domain-config'
import { describe, expect, it } from 'vitest'
import { applyAction, applyActions, createHand, decisionPoint, legalActions, runToShowdown } from './hand'
import type { HandState } from './types'

const BB = DEFAULT_TABLE_CONFIG.bigBlindChips // 100
const SB = DEFAULT_TABLE_CONFIG.smallBlindChips // 50
const START = DEFAULT_TABLE_CONFIG.startingStackChips // 10000
const STACKS_TOTAL = START * DEFAULT_TABLE_CONFIG.numSeats

// buttonIndex 0 → seat0 BTN, 1 SB, 2 BB, 3 UTG, 4 HJ, 5 CO.
const fresh = (): HandState => createHand({ handId: 'h1', buttonIndex: 0, heroSeat: 3, seed: 'h1' })

// Mid-hand, committed chips sit in the pot (out of stacks): stacks + committed.
const liveChips = (s: HandState): number =>
  s.seats.reduce((sum, seat) => sum + seat.stack + seat.committedTotal, 0)
// At completion, the pot has been paid back into stacks (committedTotal is a
// cumulative record, not live), so conservation is stacks alone.
const stacksTotal = (s: HandState): number => s.seats.reduce((sum, seat) => sum + seat.stack, 0)

describe('createHand', () => {
  it('assigns 6-max positions relative to the button', () => {
    const s = fresh()
    expect(s.seats.map((x) => x.position)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'])
  })

  it('posts blinds and puts UTG first to act', () => {
    const s = fresh()
    expect(s.seats[1]!.committedThisStreet).toBe(SB)
    expect(s.seats[2]!.committedThisStreet).toBe(BB)
    expect(s.betToMatch).toBe(BB)
    expect(s.toAct).toBe(3) // UTG
    expect(liveChips(s)).toBe(STACKS_TOTAL)
  })
})

describe('preflop betting flow', () => {
  it('folds around to the BB, who wins uncontested', () => {
    const s = applyActions(fresh(), [
      { type: 'fold' }, // UTG
      { type: 'fold' }, // HJ
      { type: 'fold' }, // CO
      { type: 'fold' }, // BTN
      { type: 'fold' }, // SB
    ])
    expect(s.phase).toBe('complete')
    expect(s.result?.wentToShowdown).toBe(false)
    expect(s.result?.payouts).toEqual({ 2: SB + BB })
    expect(s.seats[2]!.stack).toBe(START - BB + (SB + BB)) // net +SB
    expect(stacksTotal(s)).toBe(STACKS_TOTAL)
  })

  it('open + call advances to the flop with the BB first to act', () => {
    const s = applyActions(fresh(), [
      { type: 'raise', amount: 250 }, // UTG opens to 2.5bb
      { type: 'fold' }, // HJ
      { type: 'fold' }, // CO
      { type: 'fold' }, // BTN
      { type: 'fold' }, // SB
      { type: 'call' }, // BB calls
    ])
    expect(s.phase).toBe('betting')
    expect(s.street).toBe('flop')
    expect(s.board).toHaveLength(3)
    expect(s.betToMatch).toBe(0)
    expect(s.toAct).toBe(2) // BB acts first postflop
  })

  it('gives the BB its option after a limp, and a check advances the street', () => {
    let s = applyActions(fresh(), [
      { type: 'call' }, // UTG limps
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' }, // SB folds
    ])
    expect(s.toAct).toBe(2) // BB has the option
    expect(legalActions(s).map((l) => l.type)).toContain('check')
    s = applyAction(s, { type: 'check' })
    expect(s.street).toBe('flop')
  })
})

describe('action legality', () => {
  it('rejects checking when facing a bet', () => {
    const s = fresh() // UTG faces the BB
    expect(() => applyAction(s, { type: 'check' })).toThrow()
  })

  it('rejects a raise below the minimum', () => {
    const s = fresh()
    // min legal raise is to 2bb (200); 150 is illegal.
    expect(() => applyAction(s, { type: 'raise', amount: 150 })).toThrow()
    expect(() => applyAction(s, { type: 'raise', amount: 200 })).not.toThrow()
  })

  it('offers multiple preflop open sizes, including larger opens', () => {
    const dp = decisionPoint(fresh())!
    expect(dp.sizeOptions.map((o) => o.label)).toEqual(['Open 2.5bb', 'Open 3bb', 'Open 3.5bb', 'All-in'])
    expect(dp.sizeOptions.map((o) => o.amount)).toEqual([250, 300, 350, START])
  })

  it('offers call, fold, 4-bet sizes, and all-in after a 3-bet', () => {
    const s = applyActions(fresh(), [
      { type: 'raise', amount: 250 }, // UTG opens.
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'raise', amount: 1100 }, // BB 3-bets.
    ])
    const dp = decisionPoint(s)!
    expect(dp.legalActions.map((a) => a.type)).toEqual(['fold', 'call', 'raise'])
    expect(dp.sizeOptions.map((o) => o.label)).toEqual([
      '4-bet to 24.2bb',
      '4-bet to 27.5bb',
      '4-bet to 30.8bb',
      'All-in',
    ])
    expect(dp.sizeOptions.map((o) => o.amount)).toEqual([2420, 2750, 3080, START])
  })
})

describe('runToShowdown', () => {
  it('completes a hand to showdown, conserving chips', () => {
    const s = applyActions(fresh(), [
      { type: 'raise', amount: 250 },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'call' }, // → flop, 2 players
    ])
    const done = runToShowdown(s)
    expect(done.phase).toBe('complete')
    expect(done.board).toHaveLength(5)
    expect(done.result?.wentToShowdown).toBe(true)
    expect(stacksTotal(done)).toBe(STACKS_TOTAL)
  })
})

describe('determinism (golden master)', () => {
  const script = () =>
    runToShowdown(
      applyActions(createHand({ handId: 'gm', buttonIndex: 2, heroSeat: 5, seed: 'gm-seed' }), [
        { type: 'fold' },
        { type: 'raise', amount: 250 },
        { type: 'call' },
        { type: 'fold' },
        { type: 'fold' },
        { type: 'fold' },
      ]),
    )

  it('same seed + same actions → identical board and payouts', () => {
    const a = script()
    const b = script()
    expect(a.board).toEqual(b.board)
    expect(a.result?.payouts).toEqual(b.result?.payouts)
    expect(stacksTotal(a)).toBe(STACKS_TOTAL)
  })
})
