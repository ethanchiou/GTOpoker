import type { Position, TableConfig } from '@gto/domain-config'
import type { Card } from '@gto/hand-eval'
import type { Deck } from './deck'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river']

/**
 * Player action types. An all-in is not a distinct type — it is a bet/raise/call
 * whose chip amount equals the player's entire remaining stack (spec §5.5).
 */
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise'

export interface Action {
  type: ActionType
  /**
   * For `bet`/`raise`: the TOTAL chips this seat has committed *this street*
   * after the action (the "raise-to" amount), not the increment. Omitted for
   * fold/check/call.
   */
  amount?: number
}

export interface LegalAction {
  type: ActionType
  /** For bet/raise: minimum legal "raise-to" total (chips). */
  min?: number
  /** For bet/raise: maximum legal "raise-to" total = all-in (chips). */
  max?: number
}

export interface SizeOption {
  label: string
  /** Total "raise-to"/"bet-to" amount in chips. */
  amount: number
  kind: 'open' | 'bet' | 'raise' | 'allin'
}

export type SeatStatus = 'active' | 'folded' | 'allIn'

export interface SeatState {
  seatIndex: number
  position: Position
  stack: number
  committedThisStreet: number
  committedTotal: number
  status: SeatStatus
  /** The engine knows every seat's cards; DecisionPoint exposes only the actor's. */
  holeCards: readonly [Card, Card]
  controller: 'human' | 'bot'
  isHero: boolean
  /** Whether this seat has acted in the current betting round (blinds don't count). */
  hasActed: boolean
}

export interface ActionRecord {
  seatIndex: number
  position: Position
  street: Street
  action: Action
}

/**
 * Canonical, backend-agnostic description of a game-tree node (spec §6.2).
 * Lives in poker-engine (it is derived from game state); the strategy layer maps
 * it to a chart spot or a solver request.
 */
export interface GameNodeKey {
  street: Street
  heroPosition: Position
  board: readonly Card[]
  /** All actions so far this hand, in order. */
  history: readonly ActionRecord[]
}

/** Emitted whenever a seat must act; consumed by human UI, bots, and the scorer (spec §5.8). */
export interface DecisionPoint {
  handId: string
  street: Street
  seatIndex: number
  position: Position
  heroHoleCards: readonly [Card, Card]
  board: readonly Card[]
  potChips: number
  toCallChips: number
  effectiveStackChips: number
  actionHistory: readonly ActionRecord[]
  legalActions: LegalAction[]
  sizeOptions: SizeOption[]
  nodeKey: GameNodeKey
}

export interface SidePot {
  amount: number
  eligibleSeatIndexes: number[]
}

export interface HandResult {
  board: readonly Card[]
  pots: SidePot[]
  /** seatIndex → chips won. */
  payouts: Record<number, number>
  wentToShowdown: boolean
}

export type HandPhase = 'betting' | 'complete'

export interface HandState {
  handId: string
  config: TableConfig
  buttonIndex: number
  seats: SeatState[]
  board: Card[]
  street: Street
  phase: HandPhase
  /** Seat index to act, or null when the current betting round is closed. */
  toAct: number | null
  /** Highest committedThisStreet this round (the amount to match). */
  betToMatch: number
  /** Size of the last full bet/raise increment (for min-raise rules). */
  lastRaiseIncrement: number
  history: ActionRecord[]
  result: HandResult | null
  /** The deck this hand draws from. Mutable; shared across forward state transitions. */
  deck: Deck
}
