import type { Card } from '@gto/hand-eval'
import type { ActionFrequency, StrategyMeta } from './types'

/**
 * The postflop solver seam (spec §4.7, §6.4). A `SolverTransport` is injected so
 * the genuinely-async equilibrium solve (postflop-solver WASM in a Web Worker)
 * is a drop-in: the core depends only on this interface, and tests/the app can
 * supply a precomputed or baseline transport. The real WASM and the in-process
 * baseline implement the exact same contract.
 */

/** A specific two-card holding with the probability mass it carries into a node. */
export interface WeightedCombo {
  hand: readonly [Card, Card]
  /** Relative weight in (0, 1]; the solver/baseline normalizes within the range. */
  weight: number
}

/** A player's range entering a node: weighted concrete combos. */
export type Range = WeightedCombo[]

/**
 * Everything a heads-up postflop solve needs at one node. Money is in chips
 * (converted to bb at the edge). `toCallChips === 0` means the hero may
 * check/bet; otherwise the hero faces a bet and may fold/call/raise.
 */
export interface SolveRequest {
  board: readonly Card[]
  heroRange: Range
  villainRange: Range
  potChips: number
  effectiveStackChips: number
  bigBlindChips: number
  toCallChips: number
  /** Hero's current commitment on this betting street before acting. */
  heroCommittedThisStreetChips?: number
  /** Villain's current commitment on this betting street before hero acts. */
  villainCommittedThisStreetChips?: number
  /** Minimum legal bet/raise-to amount for the aggressive option, when known. */
  minRaiseToChips?: number
  /** Postflop bet/raise sizes as a fraction of the pot (e.g. 0.33, 0.75). */
  betFractions: readonly number[]
  /**
   * Whether the hero acts first postflop (out of position). Consumed by the real
   * WASM solver to orient its [OOP, IP] ranges/tree; the baseline transport is
   * position-agnostic and ignores it.
   */
  heroIsOop?: boolean
  /** Rake as a fraction of the pot and a cap in chips (default: no rake). */
  rakePercent?: number
  rakeCapChips?: number
}

/** A single combo's equilibrium action mix at the node, with per-action EV (bb). */
export interface ComboStrategy {
  hand: readonly [Card, Card]
  /** Action frequencies summing to 1; every entry carries `ev` (big blinds). */
  actions: ActionFrequency[]
}

export interface SolveResult {
  /** Per-combo strategy for the hero's range at the queried node. */
  hero: ComboStrategy[]
  meta: {
    confidence: StrategyMeta['confidence']
    /** True when EVs are an approximation (baseline transport), not a real solve. */
    approximate: boolean
    /** Short label for the source, surfaced in the UI (e.g. 'baseline', 'wasm'). */
    label: string
  }
}

export interface SolverTransport {
  solve(req: SolveRequest): Promise<SolveResult>
}
