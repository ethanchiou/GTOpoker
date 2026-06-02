/**
 * Cards are encoded as a single integer 0..51 for fast evaluation and tiny
 * serialization (spec §5.1). Encoding: `card = rank * 4 + suit`, so:
 *   rankOf(card) === card >> 2     (rank occupies the high bits)
 *   suitOf(card) === card & 0b11   (suit occupies the low 2 bits)
 *
 * Rank index 0..12 maps to 2,3,4,5,6,7,8,9,T,J,Q,K,A.
 * Suit index 0..3 maps to c,d,h,s.
 */

export type Card = number // invariant: integer in [0, 51]
export type Rank = number // [0, 12]
export type Suit = number // [0, 3]

export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUIT_CHARS = ['c', 'd', 'h', 's'] as const

export const NUM_RANKS = 13
export const NUM_SUITS = 4
export const NUM_CARDS = 52

export function makeCard(rank: Rank, suit: Suit): Card {
  return rank * NUM_SUITS + suit
}

export function rankOf(card: Card): Rank {
  return card >> 2
}

export function suitOf(card: Card): Suit {
  return card & 0b11
}

export function cardToString(card: Card): string {
  return `${RANK_CHARS[rankOf(card)]}${SUIT_CHARS[suitOf(card)]}`
}

const RANK_BY_CHAR = new Map<string, Rank>(RANK_CHARS.map((c, i) => [c, i]))
const SUIT_BY_CHAR = new Map<string, Suit>(SUIT_CHARS.map((c, i) => [c, i]))

export function cardFromString(str: string): Card {
  if (str.length !== 2) throw new Error(`Invalid card string: "${str}"`)
  const rank = RANK_BY_CHAR.get(str[0]!)
  const suit = SUIT_BY_CHAR.get(str[1]!)
  if (rank === undefined || suit === undefined) throw new Error(`Invalid card string: "${str}"`)
  return makeCard(rank, suit)
}

/** All 52 cards in canonical order (2c, 2d, 2h, 2s, 3c, ...). */
export function allCards(): Card[] {
  const cards: Card[] = []
  for (let c = 0; c < NUM_CARDS; c++) cards.push(c)
  return cards
}
