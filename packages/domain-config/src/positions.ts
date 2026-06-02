/**
 * Seat positions at a 6-max table, listed in preflop action order
 * (first to act → last). BTN is last preflop except for the blinds; SB/BB
 * post blinds and act last/penultimate preflop.
 */
export const POSITIONS_6MAX = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const

export type Position = (typeof POSITIONS_6MAX)[number]

/** Number of seats in the supported game (6-max). */
export const NUM_SEATS_6MAX = 6
