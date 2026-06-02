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
  preflopOpenBb: number
  preflopSbOpenBb: number
  /** Postflop bet sizes as a fraction of the pot. */
  postflopBetFractions: number[]
}

export const DEFAULT_BET_SIZE_TREE: BetSizeTree = {
  preflopOpenBb: 2.5,
  preflopSbOpenBb: 3,
  postflopBetFractions: [0.33, 0.75, 1.25],
}

/** Position order starting from the button (offset 0 = BTN), for 6-max. */
const ORDER_FROM_BUTTON_6MAX: readonly Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']

/** The position of a seat given the button seat (6-max only). */
export function positionFor(seatIndex: number, buttonIndex: number, numSeats = NUM_SEATS_6MAX): Position {
  if (numSeats !== NUM_SEATS_6MAX) throw new Error('Only 6-max positions are supported')
  const offset = (((seatIndex - buttonIndex) % numSeats) + numSeats) % numSeats
  return ORDER_FROM_BUTTON_6MAX[offset]!
}
