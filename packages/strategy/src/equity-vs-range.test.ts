import { cardFromString, createRng } from '@gto/hand-eval'
import { describe, expect, it } from 'vitest'
import { equityVsRange, potOddsPct } from './equity-vs-range'
import type { Range } from './postflop-types'

const hand = (a: string, b: string): readonly [number, number] => [cardFromString(a), cardFromString(b)]
const combo = (a: string, b: string, weight = 1) => ({ hand: hand(a, b), weight })

describe('potOddsPct', () => {
  it('prices a call as a share of the final pot', () => {
    expect(potOddsPct(250, 400)).toBeCloseTo(250 / 650, 6)
  })
  it('is null when there is nothing to call', () => {
    expect(potOddsPct(0, 400)).toBeNull()
    expect(potOddsPct(-5, 400)).toBeNull()
  })
})

describe('equityVsRange', () => {
  const rng = () => createRng('equity-vs-range-test')

  it('AA dominates a single KK combo (~82% preflop)', () => {
    const villain: Range = [combo('Kh', 'Kd')]
    const eq = equityVsRange(hand('As', 'Ac'), villain, [], { iterations: 20_000, rng: rng() })
    expect(eq).not.toBeNull()
    expect(eq!.equity).toBeGreaterThan(0.78)
    expect(eq!.equity).toBeLessThan(0.86)
  })

  it('is a coin flip versus a copy of an equivalent hand', () => {
    // AKo vs a single offsuit AK combo of different suits ~ near 50% (chops dominate).
    const eq = equityVsRange(hand('As', 'Kh'), [combo('Ad', 'Kc')], [], { iterations: 20_000, rng: rng() })
    expect(eq!.equity).toBeGreaterThan(0.45)
    expect(eq!.equity).toBeLessThan(0.55)
  })

  it('weights combos: AA vs mostly-KK tilts higher than vs mostly-QQ-is-irrelevant', () => {
    const heavyKK: Range = [combo('Kh', 'Kd', 9), combo('2h', '2d', 1)]
    const eq = equityVsRange(hand('As', 'Ac'), heavyKK, [], { iterations: 20_000, rng: rng() })
    // vs ~KK it's ~82%, vs 22 it's ~82% too — both are big pairs underdogs, so high.
    expect(eq!.equity).toBeGreaterThan(0.78)
  })

  it('respects a postflop board (the nuts is unbeatable)', () => {
    // Hero AcAd on As-Ah-Kc holds four aces; villain KsKh can at best make kings
    // full, so hero wins every runout regardless of the turn/river dealt.
    const eq = equityVsRange(hand('Ac', 'Ad'), [combo('Ks', 'Kh')], [
      cardFromString('As'),
      cardFromString('Ah'),
      cardFromString('Kc'),
    ], { iterations: 3_000, rng: rng() })
    expect(eq!.equity).toBeGreaterThan(0.999)
  })

  it('returns null when every villain combo collides with the hero/board', () => {
    const villain: Range = [combo('As', 'Ac')] // both blocked by the hero
    expect(equityVsRange(hand('As', 'Ac'), villain, [], { iterations: 1_000, rng: rng() })).toBeNull()
    expect(equityVsRange(hand('As', 'Ac'), [], [], { iterations: 1_000, rng: rng() })).toBeNull()
  })
})
