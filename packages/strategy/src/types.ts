import type { GameNodeKey } from '@gto/poker-engine'
import type { HandClass } from './hand-class'

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
