import { rankOf, suitOf, type Card } from './cards'
import { categoryOf, evaluateHand, HandCategory } from './evaluator'

/**
 * Human-readable description of *what a player currently holds* on a given board —
 * the made hand (category + the ranks that name it) plus any pre-river draws. It
 * answers the player-facing "what do I have?" question and is independent of the
 * strategy/equity machinery; it just reads the cards.
 *
 * Preflop (fewer than 5 known cards) there is no made hand, so it describes the
 * two hole cards instead (a pocket pair, or the two ranks + suitedness).
 */

/** Singular rank names indexed 0..12 (2..A), for "Ace-high", "…-high straight". */
const RANK_SINGULAR = [
  'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace',
] as const
/** Plural rank names indexed 0..12, for "Pair of Kings", "full of Sevens". */
const RANK_PLURAL = [
  'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces',
] as const

export interface HandDescription {
  /** The made-hand category, or `HighCard` when only the hole cards are known. */
  category: HandCategory
  /** The made hand named with its ranks, e.g. "Ace-high flush", "Pair of Kings". */
  label: string
  /** Pre-river draws the holding has, e.g. ["Flush draw", "Open-ended straight draw"]. */
  draws: string[]
}

/** Decode the i-th tiebreak nibble (0..4) of an `evaluateHand` value → rank index. */
function kicker(value: number, i: number): number {
  return (value >> (4 * (4 - i))) & 0xf
}

/** Name the made hand from its category and decoded tiebreak ranks. */
function madeLabel(category: HandCategory, value: number): string {
  const k0 = kicker(value, 0)
  const k1 = kicker(value, 1)
  switch (category) {
    case HandCategory.StraightFlush:
      return k0 === 12 ? 'Royal flush' : `${RANK_SINGULAR[k0]}-high straight flush`
    case HandCategory.Quads:
      return `Four of a kind, ${RANK_PLURAL[k0]}`
    case HandCategory.FullHouse:
      return `Full house, ${RANK_PLURAL[k0]} full of ${RANK_PLURAL[k1]}`
    case HandCategory.Flush:
      return `${RANK_SINGULAR[k0]}-high flush`
    case HandCategory.Straight:
      return `${RANK_SINGULAR[k0]}-high straight`
    case HandCategory.Trips:
      return `Three of a kind, ${RANK_PLURAL[k0]}`
    case HandCategory.TwoPair:
      return `Two pair, ${RANK_PLURAL[k0]} & ${RANK_PLURAL[k1]}`
    case HandCategory.Pair:
      return `Pair of ${RANK_PLURAL[k0]}`
    default:
      return `${RANK_SINGULAR[k0]}-high`
  }
}

/** Highest card of the best straight in a 13-bit rank mask, or -1 (incl. the wheel). */
function straightHigh(rankMask: number): number {
  for (let high = 12; high >= 4; high--) {
    let ok = true
    for (let r = high; r > high - 5; r--) if (!(rankMask & (1 << r))) ok = false
    if (ok) return high
  }
  if (rankMask & (1 << 12) && (rankMask & 0b1111) === 0b1111) return 3
  return -1
}

/** Pre-river draws for the hole cards on this board (empty on the river / preflop). */
function drawsFor(hole: readonly [Card, Card], board: readonly Card[], category: HandCategory): string[] {
  if (board.length < 3 || board.length >= 5) return []
  const cards = [hole[0], hole[1], ...board]

  const draws: string[] = []

  // Flush draw: four to a flush the hero contributes to, short of a made flush.
  if (category < HandCategory.Flush) {
    const suitCount = [0, 0, 0, 0]
    for (const c of cards) suitCount[suitOf(c)]!++
    const heroSuits = new Set([suitOf(hole[0]), suitOf(hole[1])])
    for (let s = 0; s < 4; s++) {
      if (suitCount[s] === 4 && heroSuits.has(s)) {
        draws.push('Flush draw')
        break
      }
    }
  }

  // Straight draw: rank-completions that aren't already a made straight. Two or
  // more completing ranks ≈ open-ended (incl. double gutshots); one ≈ a gutshot.
  if (category < HandCategory.Straight) {
    let mask = 0
    for (const c of cards) mask |= 1 << rankOf(c)
    if (straightHigh(mask) < 0) {
      let outs = 0
      for (let r = 0; r < 13; r++) {
        if (mask & (1 << r)) continue
        if (straightHigh(mask | (1 << r)) >= 0) outs++
      }
      if (outs >= 2) draws.push('Open-ended straight draw')
      else if (outs === 1) draws.push('Gutshot straight draw')
    }
  }

  return draws
}

/** Describe the two hole cards alone (preflop, before any board). */
function describeHoleCards(hole: readonly [Card, Card]): HandDescription {
  const r0 = rankOf(hole[0])
  const r1 = rankOf(hole[1])
  if (r0 === r1) {
    return { category: HandCategory.Pair, label: `Pocket ${RANK_PLURAL[r0]}`, draws: [] }
  }
  const hi = Math.max(r0, r1)
  const lo = Math.min(r0, r1)
  const suited = suitOf(hole[0]) === suitOf(hole[1])
  return {
    category: HandCategory.HighCard,
    label: `${RANK_SINGULAR[hi]}-${RANK_SINGULAR[lo]} ${suited ? 'suited' : 'offsuit'}`,
    draws: [],
  }
}

/**
 * What the player currently holds on this board: the named made hand plus any
 * pre-river draws. With fewer than five known cards (preflop) it describes the
 * hole cards instead.
 */
export function describeHolding(hole: readonly [Card, Card], board: readonly Card[] = []): HandDescription {
  if (board.length < 3) return describeHoleCards(hole)

  const value = evaluateHand([hole[0], hole[1], ...board])
  const category = categoryOf(value)
  return { category, label: madeLabel(category, value), draws: drawsFor(hole, board, category) }
}
