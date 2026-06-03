import type { Card } from '@gto/hand-eval'
import type { GameNodeKey } from '@gto/poker-engine'
import { handClass, type HandClass } from './hand-class'

/**
 * An action identifier used by charts and the scorer. Conventions:
 *   'fold' | 'check' | 'call' | 'allIn' | 'raiseTo:<bb>'   (e.g. 'raiseTo:2.5', 'raiseTo:12')
 */
export type ActionId = string

export interface ActionFrequency {
  actionId: ActionId
  /** Probability in [0, 1]; a node's frequencies sum to 1. */
  frequency: number
  /** EV in big blinds — present only when the backend provides it (solver, not charts). */
  ev?: number
}

export interface StrategyMeta {
  source: 'chart' | 'solver'
  confidence: 'low' | 'medium' | 'high'
  rakeAssumption: string
  version: string
}

/**
 * The GTO strategy at a game node, for the acting seat. `grid` is the full
 * per-hand-class strategy (the rangeView that powers the 13×13 heatmap); the
 * scorer/bot pick the acting hand's row via `strategyForHand` (spec §6.1).
 */
export interface NodeStrategy {
  spotId: string
  actions: ActionId[]
  grid: Record<HandClass, ActionFrequency[]>
  /**
   * Optional per-combo strategy keyed by {@link comboKey}. Solver nodes populate it
   * so a board-specific holding — a made flush, a flush draw — can diverge from the
   * average of its 169-class siblings; charts (class-granularity) omit it, and
   * consumers fall back to the class `grid` via {@link strategyForCombo}.
   */
  comboGrid?: Record<string, ActionFrequency[]>
  meta: StrategyMeta
}

export interface StrategyProvider {
  supports(node: GameNodeKey): boolean
  getStrategy(node: GameNodeKey): Promise<NodeStrategy>
}

/** The acting hand's action mix, defaulting to pure fold if absent. */
export function strategyForHand(strategy: NodeStrategy, handClass: HandClass): ActionFrequency[] {
  return strategy.grid[handClass] ?? [{ actionId: 'fold', frequency: 1 }]
}

/** Order-independent key for a concrete two-card combo (e.g. for {@link NodeStrategy.comboGrid}). */
export function comboKey(a: Card, b: Card): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/**
 * The acting hand's action mix for a *specific* two-card combo: the board-aware
 * per-combo row when the backend provides one (solver), else the 169-class row.
 * This is the lookup every consumer holding concrete cards should use, so a made
 * flush is graded/played/displayed as a flush rather than as its class average.
 */
export function strategyForCombo(strategy: NodeStrategy, a: Card, b: Card): ActionFrequency[] {
  return strategy.comboGrid?.[comboKey(a, b)] ?? strategyForHand(strategy, handClass(a, b))
}
