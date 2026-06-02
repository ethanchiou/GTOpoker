import { allCards, type Card } from './cards'
import { evaluateHand } from './evaluator'
import { createRng, type SeededRng } from './rng'

/**
 * Heads-up equity: hero's two hole cards vs villain's two hole cards on a given
 * board (0, 3, 4, or 5 cards). Equity counts a tie as half a win (spec §15).
 *
 * When ≤2 board cards remain to deal (flop/turn/river) we enumerate exactly;
 * preflop we Monte-Carlo with an injected seeded RNG (deterministic).
 */
export interface Equity {
  win: number
  tie: number
  lose: number
  /** (win + tie/2) / total, in [0, 1]. */
  equity: number
}

type HoleCards = readonly [Card, Card]

function remainingDeck(dead: Iterable<Card>): Card[] {
  const set = new Set(dead)
  return allCards().filter((c) => !set.has(c))
}

/** Run callback for every k-combination of `pool`. */
function forEachCombination(pool: Card[], k: number, cb: (combo: Card[]) => void): void {
  const combo: Card[] = new Array(k)
  const recurse = (start: number, depth: number): void => {
    if (depth === k) {
      cb(combo)
      return
    }
    for (let i = start; i <= pool.length - (k - depth); i++) {
      combo[depth] = pool[i]!
      recurse(i + 1, depth + 1)
    }
  }
  if (k === 0) cb([])
  else recurse(0, 0)
}

function settle(heroValue: number, villainValue: number, tally: { win: number; tie: number }): void {
  if (heroValue > villainValue) tally.win++
  else if (heroValue === villainValue) tally.tie++
}

/** Exact equity by enumerating all board completions. Cheap only for flop+. */
export function equityExact(hero: HoleCards, villain: HoleCards, board: Card[]): Equity {
  const pool = remainingDeck([...hero, ...villain, ...board])
  const need = 5 - board.length
  const tally = { win: 0, tie: 0 }
  let total = 0
  forEachCombination(pool, need, (extra) => {
    const full = [...board, ...extra]
    settle(evaluateHand([...hero, ...full]), evaluateHand([...villain, ...full]), tally)
    total++
  })
  return {
    win: tally.win,
    tie: tally.tie,
    lose: total - tally.win - tally.tie,
    equity: (tally.win + tally.tie / 2) / total,
  }
}

function sampleDistinct(pool: Card[], k: number, rng: SeededRng): Card[] {
  const arr = pool.slice()
  for (let i = 0; i < k; i++) {
    const j = i + rng.nextInt(arr.length - i)
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr.slice(0, k)
}

/** Monte-Carlo equity by sampling random board completions. */
export function equityMonteCarlo(
  hero: HoleCards,
  villain: HoleCards,
  board: Card[],
  iterations: number,
  rng: SeededRng = createRng('equity'),
): Equity {
  const pool = remainingDeck([...hero, ...villain, ...board])
  const need = 5 - board.length
  const tally = { win: 0, tie: 0 }
  for (let i = 0; i < iterations; i++) {
    const full = [...board, ...sampleDistinct(pool, need, rng)]
    settle(evaluateHand([...hero, ...full]), evaluateHand([...villain, ...full]), tally)
  }
  return {
    win: tally.win,
    tie: tally.tie,
    lose: iterations - tally.win - tally.tie,
    equity: (tally.win + tally.tie / 2) / iterations,
  }
}

export interface EquityOptions {
  /** Monte-Carlo iterations when exact enumeration is too expensive. */
  iterations?: number
  rng?: SeededRng
}

/**
 * Heads-up equity, picking exact enumeration when cheap (≥3 board cards) and
 * Monte-Carlo otherwise (preflop).
 */
export function equity(
  hero: HoleCards,
  villain: HoleCards,
  board: Card[] = [],
  opts: EquityOptions = {},
): Equity {
  if (board.length >= 3) return equityExact(hero, villain, board)
  return equityMonteCarlo(hero, villain, board, opts.iterations ?? 25_000, opts.rng)
}
