import type { SeededRng } from '@gto/hand-eval'
import type { Action, DecisionPoint } from '@gto/poker-engine'
import type { ActionFrequency, ActionId, NodeStrategy, StrategyProvider } from './types'
import { strategyForCombo } from './types'

/** Sample an actionId from a mix, proportional to frequency, using a seeded RNG. */
export function sampleActionId(row: ActionFrequency[], rng: SeededRng): ActionId {
  const total = row.reduce((s, a) => s + a.frequency, 0)
  let x = rng.nextFloat() * total
  for (const a of row) {
    x -= a.frequency
    if (x <= 0) return a.actionId
  }
  return row[row.length - 1]!.actionId
}

/** Translate a chart actionId into a concrete engine Action at this decision point. */
export function resolveActionId(actionId: ActionId, dp: DecisionPoint): Action | null {
  if (actionId === 'fold') return { type: 'fold' }
  if (actionId === 'check') {
    return dp.legalActions.some((l) => l.type === 'check') ? { type: 'check' } : null
  }
  if (actionId === 'call') {
    return dp.legalActions.some((l) => l.type === 'call') ? { type: 'call' } : null
  }
  if (actionId === 'allIn') {
    const legal = dp.legalActions.find((l) => l.type === 'raise') ?? dp.legalActions.find((l) => l.type === 'bet')
    if (!legal) return null
    return { type: legal.type, amount: legal.max! }
  }
  const m = /^raiseTo:([\d.]+)$/.exec(actionId)
  if (m) {
    const amount = Math.round(Number(m[1]) * dp.bigBlindChips)
    const legal = dp.legalActions.find((l) => l.type === 'raise') ?? dp.legalActions.find((l) => l.type === 'bet')
    if (!legal) return null
    return { type: legal.type, amount: Math.max(legal.min!, Math.min(legal.max!, amount)) }
  }
  return null
}

/** Conservative fallback for nodes the strategy can't answer: check if free, else fold. */
export function fallbackAction(dp: DecisionPoint): Action {
  return dp.legalActions.some((l) => l.type === 'check') ? { type: 'check' } : { type: 'fold' }
}

/**
 * Decide a bot action by sampling the GTO strategy for its own hand. Falls back
 * to a simple policy when the node is unsupported or an action can't be resolved
 * (spec §8.1). The bot plays the same strategy the human is graded against.
 */
export async function decideGtoAction(
  dp: DecisionPoint,
  provider: StrategyProvider,
  rng: SeededRng,
): Promise<Action> {
  if (!provider.supports(dp.nodeKey)) return fallbackAction(dp)
  const strategy: NodeStrategy = await provider.getStrategy(dp.nodeKey)
  const row = strategyForCombo(strategy, dp.heroHoleCards[0], dp.heroHoleCards[1])
  const action = resolveActionId(sampleActionId(row, rng), dp)
  return action ?? fallbackAction(dp)
}
