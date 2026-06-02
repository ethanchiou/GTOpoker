import { describe, expect, it } from 'vitest'
import {
  allCards,
  cardFromString,
  cardToString,
  makeCard,
  NUM_CARDS,
  rankOf,
  suitOf,
} from './cards'

describe('cards', () => {
  it('encodes/decodes all 52 cards consistently', () => {
    for (let rank = 0; rank < 13; rank++) {
      for (let suit = 0; suit < 4; suit++) {
        const card = makeCard(rank, suit)
        expect(rankOf(card)).toBe(rank)
        expect(suitOf(card)).toBe(suit)
      }
    }
  })

  it('round-trips every card through its string form', () => {
    for (const card of allCards()) {
      expect(cardFromString(cardToString(card))).toBe(card)
    }
  })

  it('uses the expected human-readable strings', () => {
    expect(cardToString(makeCard(12, 3))).toBe('As')
    expect(cardToString(makeCard(8, 1))).toBe('Td')
    expect(cardToString(makeCard(0, 0))).toBe('2c')
  })

  it('produces 52 unique cards in [0, 51]', () => {
    const cards = allCards()
    expect(cards).toHaveLength(NUM_CARDS)
    expect(new Set(cards).size).toBe(NUM_CARDS)
    expect(Math.min(...cards)).toBe(0)
    expect(Math.max(...cards)).toBe(51)
  })

  it('rejects malformed card strings', () => {
    expect(() => cardFromString('Xs')).toThrow()
    expect(() => cardFromString('A')).toThrow()
    expect(() => cardFromString('Ax')).toThrow()
  })
})
