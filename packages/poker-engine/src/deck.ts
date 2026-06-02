import { allCards, type Card } from './cards'
import { createRng, type SeededRng } from './rng'

/**
 * A seeded, reproducible deck (spec §5.2). Built from a seed, Fisher-Yates
 * shuffled, dealt sequentially. The same seed always produces the same deal
 * order — the basis for replayable study and deterministic tests.
 *
 * `deadCards` removes known cards before shuffling (used for equity: deal
 * random run-outs from the cards that remain after the hole cards and board).
 */
export class Deck {
  readonly seed: string | number
  private readonly rng: SeededRng
  private readonly cards: Card[]
  private pos = 0

  constructor(seed: string | number, deadCards: Iterable<Card> = []) {
    this.seed = seed
    this.rng = createRng(seed)
    const dead = new Set(deadCards)
    this.cards = allCards().filter((c) => !dead.has(c))
    this.shuffle()
  }

  private shuffle(): void {
    // Fisher-Yates using the seeded RNG.
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = this.rng.nextInt(i + 1)
      const tmp = this.cards[i]!
      this.cards[i] = this.cards[j]!
      this.cards[j] = tmp
    }
  }

  /** Cards not yet dealt. */
  remaining(): number {
    return this.cards.length - this.pos
  }

  dealOne(): Card {
    if (this.pos >= this.cards.length) throw new Error('Deck exhausted')
    return this.cards[this.pos++]!
  }

  deal(n: number): Card[] {
    if (n > this.remaining()) {
      throw new Error(`Cannot deal ${n} cards; only ${this.remaining()} remain`)
    }
    const out: Card[] = []
    for (let i = 0; i < n; i++) out.push(this.dealOne())
    return out
  }
}
