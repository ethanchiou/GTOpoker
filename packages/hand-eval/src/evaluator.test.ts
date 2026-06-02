import { describe, expect, it } from 'vitest'
import { cardFromString } from './cards'
import { categoryOf, evaluateHand, HandCategory } from './evaluator'

const h = (s: string) => s.split(' ').map(cardFromString)

describe('evaluateHand — categories', () => {
  const cases: Array<[string, HandCategory]> = [
    ['As Ks Qs Js Ts', HandCategory.StraightFlush],
    ['Ac Ad Ah As Kd', HandCategory.Quads],
    ['Ac Ad Ah Kc Kd', HandCategory.FullHouse],
    ['As Ks 9s 5s 2s', HandCategory.Flush],
    ['Ts 9d 8c 7h 6s', HandCategory.Straight],
    ['As 2d 3c 4h 5s', HandCategory.Straight], // wheel
    ['Ac Ad Ah Kd Qs', HandCategory.Trips],
    ['Ac Ad Kc Kd Qs', HandCategory.TwoPair],
    ['Ac Ad Kc Qd Js', HandCategory.Pair],
    ['Ac Kd Qh Js 9c', HandCategory.HighCard],
  ]
  for (const [hand, category] of cases) {
    it(`classifies "${hand}" as ${HandCategory[category]}`, () => {
      expect(categoryOf(evaluateHand(h(hand)))).toBe(category)
    })
  }
})

describe('evaluateHand — ordering', () => {
  it('ranks categories strictly by strength', () => {
    const ordered = [
      'As Ks Qs Js Ts', // straight flush
      'Ac Ad Ah As Kd', // quads
      'Ac Ad Ah Kc Kd', // full house
      'As Ks 9s 5s 2s', // flush
      'Ts 9d 8c 7h 6s', // straight
      'Ac Ad Ah Kd Qs', // trips
      'Ac Ad Kc Kd Qs', // two pair
      'Ac Ad Kc Qd Js', // pair
      'Ac Kd Qh Js 9c', // high card
    ].map((s) => evaluateHand(h(s)))
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1]!).toBeGreaterThan(ordered[i]!)
    }
  })

  it('a wheel (A-5) is the lowest straight', () => {
    expect(evaluateHand(h('As 2d 3c 4h 5s'))).toBeLessThan(evaluateHand(h('6c 2d 3c 4h 5s')))
  })

  it('breaks ties by kicker', () => {
    expect(evaluateHand(h('Ac Kc Qc Jd 9h'))).toBeGreaterThan(evaluateHand(h('Ac Kc Qc Jd 8h')))
    expect(evaluateHand(h('Ac Ad Kc Kd Qs'))).toBeGreaterThan(evaluateHand(h('Ac Ad Kc Kd Js')))
  })
})

describe('evaluateHand — best of 7', () => {
  it('picks the best 5 cards out of 7', () => {
    const seven = evaluateHand(h('As Ks Qs Js Ts 2c 3d'))
    const five = evaluateHand(h('As Ks Qs Js Ts'))
    expect(seven).toBe(five)
    expect(categoryOf(seven)).toBe(HandCategory.StraightFlush)
  })

  it('rejects fewer than 5 or more than 7 cards', () => {
    expect(() => evaluateHand(h('As Ks Qs Js'))).toThrow()
    expect(() => evaluateHand(h('As Ks Qs Js Ts 2c 3d 4h'))).toThrow()
  })
})
