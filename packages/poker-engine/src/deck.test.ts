import { describe, expect, it } from 'vitest'
import { cardFromString, NUM_CARDS, type Card } from '@gto/hand-eval'
import { Deck } from './deck'

describe('Deck', () => {
  it('contains all 52 cards exactly once', () => {
    const deck = new Deck('seed-1')
    expect(deck.remaining()).toBe(NUM_CARDS)
    const dealt = deck.deal(NUM_CARDS)
    expect(new Set(dealt).size).toBe(NUM_CARDS)
    expect([...dealt].sort((a, b) => a - b)).toEqual(
      Array.from({ length: NUM_CARDS }, (_, i) => i),
    )
  })

  it('is deterministic: same seed → identical deal order', () => {
    const a = new Deck('seed-xyz').deal(NUM_CARDS)
    const b = new Deck('seed-xyz').deal(NUM_CARDS)
    expect(a).toEqual(b)
  })

  it('differs across seeds', () => {
    const a = new Deck('seed-a').deal(10)
    const b = new Deck('seed-b').deal(10)
    expect(a).not.toEqual(b)
  })

  it('removes dead cards before shuffling', () => {
    const dead: Card[] = ['As', 'Kd', '2c'].map(cardFromString)
    const deck = new Deck('eq', dead)
    expect(deck.remaining()).toBe(NUM_CARDS - dead.length)
    const dealt = new Set(deck.deal(deck.remaining()))
    for (const c of dead) expect(dealt.has(c)).toBe(false)
  })

  it('tracks remaining and throws when exhausted', () => {
    const deck = new Deck('exhaust')
    deck.deal(NUM_CARDS)
    expect(deck.remaining()).toBe(0)
    expect(() => deck.dealOne()).toThrow('Deck exhausted')
    expect(() => deck.deal(1)).toThrow()
  })
})
