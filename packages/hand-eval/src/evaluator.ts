import { rankOf, suitOf, type Card } from './cards'

/**
 * Self-contained 5–7 card hand evaluator (spec §5, §15).
 *
 * Returns a single comparable integer "hand value" where higher = stronger.
 * Encoding: the top nibble is the category (0=high card … 8=straight flush)
 * and the next five nibbles are tiebreak ranks in descending importance, each
 * a rank index 0..12. Two hands compare correctly by plain numeric `>`.
 *
 * This is deterministic and dependency-free. It favours correctness and
 * simplicity over raw throughput; it can be swapped for a WASM lookup-table
 * evaluator behind this same API if profiling ever demands it.
 */

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const HAND_CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.Trips]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.Quads]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
}

export type HandValue = number

function encode(category: HandCategory, kickers: number[]): HandValue {
  let score = category
  for (let i = 0; i < 5; i++) score = (score << 4) | (kickers[i] ?? 0)
  return score
}

export function categoryOf(value: HandValue): HandCategory {
  return (value >> 20) as HandCategory
}

/**
 * Highest card of the best straight present in a 13-bit rank mask, or -1.
 * Handles the wheel (A-2-3-4-5, returned as a 5-high straight → rank index 3).
 */
function straightHigh(rankMask: number): number {
  for (let high = 12; high >= 4; high--) {
    let ok = true
    for (let r = high; r > high - 5; r--) {
      if (!(rankMask & (1 << r))) {
        ok = false
        break
      }
    }
    if (ok) return high
  }
  // Wheel: A(12) + 2,3,4,5 (bits 0..3) → 5-high straight (high card rank index 3).
  if (rankMask & (1 << 12) && (rankMask & 0b1111) === 0b1111) return 3
  return -1
}

/** Evaluate the best 5-card hand from 5–7 cards. */
export function evaluateHand(cards: Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluateHand expects 5–7 cards, got ${cards.length}`)
  }

  const rankCount = new Array<number>(13).fill(0)
  const suitCount = new Array<number>(4).fill(0)
  const suitRankMask = [0, 0, 0, 0]
  let rankMask = 0

  for (const c of cards) {
    const r = rankOf(c)
    const s = suitOf(c)
    rankCount[r]!++
    suitCount[s]!++
    suitRankMask[s]! |= 1 << r
    rankMask |= 1 << r
  }

  let flushSuit = -1
  for (let s = 0; s < 4; s++) if (suitCount[s]! >= 5) flushSuit = s

  if (flushSuit >= 0) {
    const sfHigh = straightHigh(suitRankMask[flushSuit]!)
    if (sfHigh >= 0) return encode(HandCategory.StraightFlush, [sfHigh])
  }

  const quads: number[] = []
  const trips: number[] = []
  const pairs: number[] = []
  const distinctDesc: number[] = []
  for (let r = 12; r >= 0; r--) {
    const n = rankCount[r]!
    if (n === 4) quads.push(r)
    else if (n === 3) trips.push(r)
    else if (n === 2) pairs.push(r)
    if (n > 0) distinctDesc.push(r)
  }

  if (quads.length) {
    const quad = quads[0]!
    const kicker = distinctDesc.find((r) => r !== quad)!
    return encode(HandCategory.Quads, [quad, kicker])
  }

  if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
    const tripRank = trips[0]!
    const pairRank = trips.length >= 2 ? trips[1]! : pairs[0]!
    return encode(HandCategory.FullHouse, [tripRank, pairRank])
  }

  if (flushSuit >= 0) {
    const suited: number[] = []
    for (let r = 12; r >= 0 && suited.length < 5; r--) {
      if (suitRankMask[flushSuit]! & (1 << r)) suited.push(r)
    }
    return encode(HandCategory.Flush, suited)
  }

  const strHigh = straightHigh(rankMask)
  if (strHigh >= 0) return encode(HandCategory.Straight, [strHigh])

  if (trips.length) {
    const tripRank = trips[0]!
    const kickers = distinctDesc.filter((r) => r !== tripRank).slice(0, 2)
    return encode(HandCategory.Trips, [tripRank, ...kickers])
  }

  if (pairs.length >= 2) {
    const hi = pairs[0]!
    const lo = pairs[1]!
    const kicker = distinctDesc.find((r) => r !== hi && r !== lo)!
    return encode(HandCategory.TwoPair, [hi, lo, kicker])
  }

  if (pairs.length === 1) {
    const pairRank = pairs[0]!
    const kickers = distinctDesc.filter((r) => r !== pairRank).slice(0, 3)
    return encode(HandCategory.Pair, [pairRank, ...kickers])
  }

  return encode(HandCategory.HighCard, distinctDesc.slice(0, 5))
}

/** Human-readable category for a hand value. */
export function handCategoryName(value: HandValue): string {
  return HAND_CATEGORY_NAMES[categoryOf(value)]
}
