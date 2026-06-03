import type { Position } from '@gto/domain-config'
import { allCards, type Card } from '@gto/hand-eval'
import type { ActionRecord, GameNodeKey, Action } from '@gto/poker-engine'
import { ALL_HAND_CLASSES, handClass, type HandClass } from './hand-class'
import type { Range } from './postflop-types'
import type { ActionFrequency, ActionId, StrategyProvider } from './types'
import { strategyForHand } from './types'

/**
 * Preflop→flop range handoff (spec §6.4) — the integration's trickiest
 * correctness point. The postflop solve needs *both players' ranges entering the
 * flop*, derived from the preflop action path: a combo's weight is the product
 * of the chart frequencies of the actions it actually took along the line. Combos
 * the chart never plays that way fall to weight 0 and drop out.
 *
 * Weights are per-combo and unnormalized (the solver/baseline normalizes within
 * the range). Within a hand class every combo shares the class frequency, so a
 * class's total mass scales naturally with its combo count (pairs 6, suited 4,
 * offsuit 12).
 */

const EPS = 1e-9

/** Positions that have acted and never folded across the recorded history. */
export function inHandPositions(history: readonly ActionRecord[]): Position[] {
  const acting = new Set<Position>()
  const folded = new Set<Position>()
  for (const r of history) {
    acting.add(r.position)
    if (r.action.type === 'fold') folded.add(r.position)
  }
  return [...acting].filter((p) => !folded.has(p))
}

function freqOf(row: ActionFrequency[], id: ActionId): number {
  return row.find((a) => a.actionId === id)?.frequency ?? 0
}

/** The chart actionId a recorded engine action corresponds to at a given node. */
function recordedActionId(action: Action, charted: ActionId[], bigBlindChips: number): ActionId {
  if (action.type === 'fold') return 'fold'
  if (action.type === 'check') return 'check'
  if (action.type === 'call') return 'call'

  const targetBb = (action.amount ?? 0) / bigBlindChips
  const hasAllIn = charted.includes('allIn')
  // A very large raise-to that the chart models as a shove maps to all-in.
  if (hasAllIn && targetBb >= 40) return 'allIn'

  const raiseIds = charted.filter((id) => id.startsWith('raiseTo:'))
  if (raiseIds.length === 0) return hasAllIn ? 'allIn' : 'call'

  let best = raiseIds[0]!
  let bestDiff = Infinity
  for (const id of raiseIds) {
    const diff = Math.abs(Number(id.slice('raiseTo:'.length)) - targetBb)
    if (diff < bestDiff) {
      bestDiff = diff
      best = id
    }
  }
  return best
}

/** History entries strictly before the `index`-th record (its decision context). */
function historyBefore(history: readonly ActionRecord[], index: number): ActionRecord[] {
  return history.slice(0, index)
}

/** All 1326 two-card combos, excluding any that collide with `dead`. */
function allCombos(dead: Iterable<Card>): Array<[Card, Card]> {
  const deadSet = new Set(dead)
  const cards = allCards().filter((c) => !deadSet.has(c))
  const out: Array<[Card, Card]> = []
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      out.push([cards[i]!, cards[j]!])
    }
  }
  return out
}

/**
 * Build a single position's weighted range entering the flop, by replaying its
 * preflop decisions through the chart provider. `deadCards` (the board) are
 * removed; conflicts with the opponent's specific cards are handled at solve
 * time, not here.
 */
export async function buildPreflopRange(
  position: Position,
  history: readonly ActionRecord[],
  chartProvider: StrategyProvider,
  deadCards: readonly Card[],
  bigBlindChips: number,
): Promise<Range> {
  const classWeight = new Map<HandClass, number>(ALL_HAND_CLASSES.map((c) => [c, 1]))

  for (let i = 0; i < history.length; i++) {
    const rec = history[i]!
    if (rec.position !== position || rec.street !== 'preflop') continue

    const node: GameNodeKey = {
      street: 'preflop',
      heroPosition: position,
      board: [],
      history: historyBefore(history, i),
    }
    if (!chartProvider.supports(node)) continue

    const strat = await chartProvider.getStrategy(node)
    const actionId = recordedActionId(rec.action, strat.actions, bigBlindChips)
    for (const cls of ALL_HAND_CLASSES) {
      const f = freqOf(strategyForHand(strat, cls), actionId)
      classWeight.set(cls, (classWeight.get(cls) ?? 0) * f)
    }
  }

  const range: Range = []
  for (const [a, b] of allCombos(deadCards)) {
    const w = classWeight.get(handClass(a, b)) ?? 0
    if (w > EPS) range.push({ hand: [a, b], weight: w })
  }
  return range
}

/**
 * The single opponent the hero faces at a node, and that opponent's weighted
 * range there — the input the "chances to win" stat needs. Preflop: the last
 * raiser the hero is facing (the opener in a vs-RFI spot, the 3-bettor in a
 * vs-3bet spot). Postflop: the lone other in-hand player (heads-up only). Returns
 * a null villain and empty range when there is no single defined opponent — an
 * RFI/opening spot, or a multiway pot — so callers render "—".
 */
export async function villainContinuingRange(
  node: GameNodeKey,
  chartProvider: StrategyProvider,
): Promise<{ villain: Position | null; range: Range }> {
  const bb = node.bigBlindChips ?? 100
  const hero = node.heroPosition

  if (node.street === 'preflop') {
    const raises = node.history.filter((r) => r.action.type === 'raise')
    const last = raises[raises.length - 1]
    if (!last || last.position === hero) return { villain: null, range: [] }
    const range = await buildPreflopRange(last.position, node.history, chartProvider, node.board, bb)
    return { villain: last.position, range }
  }

  const others = inHandPositions(node.history).filter((p) => p !== hero)
  if (others.length !== 1) return { villain: null, range: [] }
  const range = await buildPreflopRange(others[0]!, node.history, chartProvider, node.board, bb)
  return { villain: others[0]!, range }
}
