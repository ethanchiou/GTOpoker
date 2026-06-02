import { cardFromString, type Card } from '@gto/hand-eval'
import { describe, expect, it } from 'vitest'
import { Deck } from './deck'
import { awardPots, computeSidePots, settleShowdown } from './showdown'
import type { HandState, SeatState, SeatStatus } from './types'

const hole = (a: string, b: string): readonly [Card, Card] => [cardFromString(a), cardFromString(b)]
const boardOf = (s: string): Card[] => s.split(' ').map(cardFromString)

function seat(
  seatIndex: number,
  committedTotal: number,
  status: SeatStatus = 'active',
  cards: readonly [Card, Card] = hole('Ah', 'Ad'),
): SeatState {
  return {
    seatIndex,
    position: 'BTN',
    stack: 0,
    committedThisStreet: 0,
    committedTotal,
    status,
    holeCards: cards,
    controller: 'bot',
    isHero: false,
    hasActed: true,
  }
}

describe('computeSidePots', () => {
  it('makes one pot when everyone contributed equally', () => {
    const pots = computeSidePots([seat(0, 100), seat(1, 100), seat(2, 100)])
    expect(pots).toEqual([{ amount: 300, eligibleSeatIndexes: [0, 1, 2] }])
  })

  it('splits a main pot and a side pot for an unequal all-in', () => {
    // seat 0 is all-in for 50; seats 1 and 2 each put in 100.
    const pots = computeSidePots([seat(0, 50), seat(1, 100), seat(2, 100)])
    expect(pots).toEqual([
      { amount: 150, eligibleSeatIndexes: [0, 1, 2] }, // 50 × 3
      { amount: 100, eligibleSeatIndexes: [1, 2] }, // (100−50) × 2
    ])
  })

  it('keeps a folded player’s chips in the pot but never makes them eligible', () => {
    const pots = computeSidePots([
      seat(0, 100, 'folded'),
      seat(1, 100),
      seat(2, 100),
    ])
    expect(pots).toEqual([{ amount: 300, eligibleSeatIndexes: [1, 2] }])
  })

  it('handles three distinct all-in levels', () => {
    const pots = computeSidePots([seat(0, 20), seat(1, 60), seat(2, 100)])
    expect(pots).toEqual([
      { amount: 60, eligibleSeatIndexes: [0, 1, 2] }, // 20 × 3
      { amount: 80, eligibleSeatIndexes: [1, 2] }, // 40 × 2
      { amount: 40, eligibleSeatIndexes: [2] }, // 40 × 1 (returned to seat 2)
    ])
  })
})

describe('awardPots', () => {
  it('awards a pot to the best hand', () => {
    const board = boardOf('2c 7d 9h Js 3c')
    const seats = [
      seat(0, 100, 'active', hole('Qh', 'Qd')),
      seat(1, 100, 'active', hole('Ah', 'Ad')),
      seat(2, 100, 'active', hole('Kh', 'Kd')),
    ]
    const payouts = awardPots([{ amount: 300, eligibleSeatIndexes: [0, 1, 2] }], seats, board)
    expect(payouts).toEqual({ 1: 300 }) // pocket aces win
  })

  it('splits a tie and gives the odd chip to the lowest seat index', () => {
    const board = boardOf('Qc Jd Th 2c 3d')
    const seats = [seat(0, 0, 'active', hole('Ah', 'Kh')), seat(1, 0, 'active', hole('As', 'Ks'))]
    // Both play the same broadway straight; an odd 3-chip pot splits 2/1.
    const payouts = awardPots([{ amount: 3, eligibleSeatIndexes: [0, 1] }], seats, board)
    expect(payouts).toEqual({ 0: 2, 1: 1 })
  })
})

describe('settleShowdown', () => {
  it('awards the whole pot to the winner and conserves chips', () => {
    const seats = [
      seat(0, 250, 'active', hole('Ah', 'Ad')),
      seat(1, 250, 'active', hole('Kh', 'Kd')),
    ]
    const state: HandState = {
      handId: 't',
      config: { numSeats: 2, bigBlindChips: 100, smallBlindChips: 50, anteChips: 0, startingStackChips: 250 },
      buttonIndex: 0,
      seats,
      board: boardOf('2c 7d 9h Js 3s'),
      street: 'river',
      phase: 'betting',
      toAct: null,
      betToMatch: 0,
      lastRaiseIncrement: 100,
      history: [],
      result: null,
      deck: new Deck('unused'),
    }
    const done = settleShowdown(state)
    expect(done.phase).toBe('complete')
    expect(done.result?.payouts).toEqual({ 0: 500 })
    expect(done.seats[0]!.stack).toBe(500)
  })
})
