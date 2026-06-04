import { NUM_SEATS_6MAX, type Position } from './positions'

/**
 * Table configuration. Money is in **chips** internally (spec §5.4); a big
 * blind is 100 chips so the small blind (50) and standard sizings stay integer.
 * Display converts chips → bb at the edge (chips / bigBlindChips).
 */
export interface TableConfig {
  numSeats: number
  bigBlindChips: number
  smallBlindChips: number
  anteChips: number
  startingStackChips: number
}

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  numSeats: NUM_SEATS_6MAX,
  bigBlindChips: 100,
  smallBlindChips: 50,
  anteChips: 0,
  startingStackChips: 10_000, // 100bb
}

/**
 * Discrete bet-size tree the trainer grades against (spec §5.5, §13). The
 * canonical per-node action sizes ultimately come from the strategy layer; this
 * is the engine/UI's convenience set for presenting buttons and snapping.
 */
export interface BetSizeTree {
  /** Back-compat/default open size for non-SB first-in raises. */
  preflopOpenBb: number
  /** Back-compat/default SB open size. */
  preflopSbOpenBb: number
  /** Offered non-SB first-in open sizes. */
  preflopOpenBbs: number[]
  /** Offered SB first-in open sizes. */
  preflopSbOpenBbs: number[]
  /** Offered preflop 3-bet sizes as multiples of the open raise-to amount. */
  preflopReraiseMultipliers: number[]
  /** Offered preflop 4-bet sizes as multiples of the 3-bet raise-to amount. */
  preflopFourBetMultipliers: number[]
  /** Postflop bet sizes as a fraction of the pot (default/back-compat flat list). */
  postflopBetFractions: number[]
  /**
   * Per-street postflop bet/raise sizes as a fraction of the pot. When present the
   * solver uses the street's list instead of the flat `postflopBetFractions`, so
   * sizing reflects street norms (denser/smaller flop c-bets, polar turn/river
   * sizings including overbets) rather than one menu everywhere.
   */
  postflopBetFractionsByStreet: {
    flop: number[]
    turn: number[]
    river: number[]
  }
}

export const DEFAULT_BET_SIZE_TREE: BetSizeTree = {
  preflopOpenBb: 2.5,
  preflopSbOpenBb: 3,
  preflopOpenBbs: [2.5, 3, 3.5],
  preflopSbOpenBbs: [3, 3.5, 4],
  preflopReraiseMultipliers: [3, 3.5, 4],
  preflopFourBetMultipliers: [2.2, 2.5, 2.8],
  postflopBetFractions: [0.33, 0.75, 1.25],
  postflopBetFractionsByStreet: {
    flop: [0.25, 0.5, 0.75], // denser, smaller c-bet sizings
    turn: [0.5, 0.75, 1.25], // larger, with an overbet
    river: [0.5, 1, 1.5], // polar value/bluff sizings, incl. overbet
  },
}

/** Position order starting from the button (offset 0 = BTN), for 6-max. */
const ORDER_FROM_BUTTON_6MAX: readonly Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']

/** The position of a seat given the button seat (6-max only). */
export function positionFor(seatIndex: number, buttonIndex: number, numSeats = NUM_SEATS_6MAX): Position {
  if (numSeats !== NUM_SEATS_6MAX) throw new Error('Only 6-max positions are supported')
  const offset = (((seatIndex - buttonIndex) % numSeats) + numSeats) % numSeats
  return ORDER_FROM_BUTTON_6MAX[offset]!
}

/**
 * Inverse of {@link positionFor}: the button seat that puts `seatIndex` at
 * `position`. Used to pin the hero to a chosen training seat (6-max only).
 */
export function buttonIndexFor(seatIndex: number, position: Position, numSeats = NUM_SEATS_6MAX): number {
  if (numSeats !== NUM_SEATS_6MAX) throw new Error('Only 6-max positions are supported')
  const offset = ORDER_FROM_BUTTON_6MAX.indexOf(position)
  return (((seatIndex - offset) % numSeats) + numSeats) % numSeats
}
