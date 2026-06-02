import { evaluateHand } from '@gto/hand-eval'
import type { HandState, SeatState, SidePot } from './types'

/**
 * Build side pots from per-seat total contributions (spec §5.7). Folded players'
 * chips stay in the pots, but folded seats are never eligible to win. Each
 * distinct all-in level peels one pot layer contested by the seats that reached
 * that level.
 */
export function computeSidePots(seats: readonly SeatState[]): SidePot[] {
  const contribs = seats
    .map((s) => ({ seat: s.seatIndex, amt: s.committedTotal, folded: s.status === 'folded' }))
    .filter((c) => c.amt > 0)

  const levels = [...new Set(contribs.map((c) => c.amt))].sort((a, b) => a - b)

  const pots: SidePot[] = []
  let prev = 0
  for (const level of levels) {
    let amount = 0
    const eligible: number[] = []
    for (const c of contribs) {
      const layer = Math.min(c.amt, level) - prev
      if (layer > 0) amount += layer
      if (c.amt >= level && !c.folded) eligible.push(c.seat)
    }
    if (amount > 0) pots.push({ amount, eligibleSeatIndexes: eligible })
    prev = level
  }
  return pots
}

/** Total chips contributed across all seats this hand. */
export function totalPot(seats: readonly SeatState[]): number {
  return seats.reduce((sum, s) => sum + s.committedTotal, 0)
}

/**
 * Award each pot to the best hand among its eligible seats (split on ties; odd
 * chips go to the lowest eligible seat index). Mutates the given seats' stacks
 * and returns the per-seat payouts.
 */
export function awardPots(
  pots: readonly SidePot[],
  seats: SeatState[],
  board: readonly number[],
): Record<number, number> {
  const payouts: Record<number, number> = {}
  const seatById = new Map(seats.map((s) => [s.seatIndex, s]))

  for (const pot of pots) {
    if (pot.eligibleSeatIndexes.length === 0) continue
    let bestValue = -1
    let winners: number[] = []
    for (const seatIndex of pot.eligibleSeatIndexes) {
      const seat = seatById.get(seatIndex)!
      const value = evaluateHand([...seat.holeCards, ...board])
      if (value > bestValue) {
        bestValue = value
        winners = [seatIndex]
      } else if (value === bestValue) {
        winners.push(seatIndex)
      }
    }

    const share = Math.floor(pot.amount / winners.length)
    let remainder = pot.amount - share * winners.length
    // Odd chips to the lowest eligible seat index (deterministic convention).
    for (const seatIndex of [...winners].sort((a, b) => a - b)) {
      const extra = remainder > 0 ? 1 : 0
      remainder -= extra
      const won = share + extra
      payouts[seatIndex] = (payouts[seatIndex] ?? 0) + won
      seatById.get(seatIndex)!.stack += won
    }
  }
  return payouts
}

/** Resolve a hand at showdown: build side pots, evaluate, award. */
export function settleShowdown(state: HandState): HandState {
  const seats = state.seats.map((s) => ({ ...s }))
  const pots = computeSidePots(seats)
  const payouts = awardPots(pots, seats, state.board)
  return {
    ...state,
    seats,
    phase: 'complete',
    toAct: null,
    result: { board: state.board, pots, payouts, wentToShowdown: true },
  }
}

/**
 * End a hand when everyone but one player has folded: that player wins the whole
 * pot uncontested (no cards revealed).
 */
export function settleUncontested(state: HandState, winnerSeatIndex: number): HandState {
  const seats = state.seats.map((s) => ({ ...s }))
  const pot = totalPot(seats)
  const winner = seats.find((s) => s.seatIndex === winnerSeatIndex)!
  winner.stack += pot
  return {
    ...state,
    seats,
    phase: 'complete',
    toAct: null,
    result: {
      board: state.board,
      pots: [{ amount: pot, eligibleSeatIndexes: [winnerSeatIndex] }],
      payouts: { [winnerSeatIndex]: pot },
      wentToShowdown: false,
    },
  }
}
