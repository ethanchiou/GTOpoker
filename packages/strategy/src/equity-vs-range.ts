import { allCards, createRng, evaluateHand, type Card, type SeededRng } from '@gto/hand-eval'
import type { Range } from './postflop-types'

/**
 * Pot odds: the share of the final pot the hero is risking to call, i.e. the
 * break-even equity needed for a call to be neutral — `toCall / (pot + toCall)`.
 * Returns null when there is nothing to call (a check/opening spot), where pot
 * odds are not meaningful.
 */
export function potOddsPct(toCallChips: number, potChips: number): number | null {
  if (toCallChips <= 0) return null
  const denom = potChips + toCallChips
  return denom > 0 ? toCallChips / denom : null
}

export interface RangeEquity {
  /** Hero's equity (win + tie/2) in [0, 1] against the weighted villain range. */
  equity: number
  iterations: number
}

/** Smallest index `i` with `cum[i] >= x` (cum is ascending). */
function pick(cum: number[], x: number): number {
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Hero's equity against a *weighted* villain range on a (possibly partial) board,
 * by Monte-Carlo: each iteration samples one villain combo proportional to its
 * weight, deals a random runout, and scores the showdown (a tie counts as half a
 * win, matching `@gto/hand-eval`). Combos that collide with the hero's cards or
 * the board are dropped. Returns null when no villain combo is left (e.g. the
 * range is empty or fully blocked) — callers render "—".
 *
 * Street-agnostic: an empty board means a preflop all-in-equity estimate; a
 * flop/turn/river board narrows the runout. The villain range itself is supplied
 * by the caller (`buildPreflopRange` / `villainContinuingRange`).
 */
export function equityVsRange(
  hero: readonly [Card, Card],
  villain: Range,
  board: readonly Card[] = [],
  opts: { iterations?: number; rng?: SeededRng } = {},
): RangeEquity | null {
  const dead = new Set<Card>([hero[0], hero[1], ...board])
  const combos = villain.filter((c) => c.weight > 0 && !dead.has(c.hand[0]) && !dead.has(c.hand[1]))
  if (combos.length === 0) return null

  const rng = opts.rng ?? createRng('equity-vs-range')
  const iterations = opts.iterations ?? 12_000

  const cum = new Array<number>(combos.length)
  let acc = 0
  for (let i = 0; i < combos.length; i++) {
    acc += combos[i]!.weight
    cum[i] = acc
  }
  const total = acc

  // Runout pool excludes the hero's cards and the board; the villain's two cards
  // are excluded per-iteration (they vary), via rejection on a small pool.
  const basePool = allCards().filter((c) => !dead.has(c))
  const need = 5 - board.length
  const runout = new Array<Card>(need)
  let win = 0
  let tie = 0

  for (let it = 0; it < iterations; it++) {
    const v = combos[pick(cum, rng.nextFloat() * total)]!
    const v0 = v.hand[0]
    const v1 = v.hand[1]
    for (let k = 0; k < need; k++) {
      let c: Card
      reject: while (true) {
        c = basePool[rng.nextInt(basePool.length)]!
        if (c === v0 || c === v1) continue
        for (let j = 0; j < k; j++) if (runout[j] === c) continue reject
        break
      }
      runout[k] = c
    }
    const full = board.length ? [...board, ...runout] : runout
    const heroVal = evaluateHand([hero[0], hero[1], ...full])
    const villainVal = evaluateHand([v0, v1, ...full])
    if (heroVal > villainVal) win++
    else if (heroVal === villainVal) tie++
  }

  return { equity: (win + tie / 2) / iterations, iterations }
}
