import { describe, expect, it } from 'vitest'
import { cardFromString } from './cards'
import { HandCategory } from './evaluator'
import { describeHolding } from './describe'

const c = cardFromString
const hole = (a: string, b: string): [number, number] => [c(a), c(b)]
const board = (...cs: string[]) => cs.map(c)

describe('describeHolding — made hands', () => {
  it('names a made flush by its high card', () => {
    const d = describeHolding(hole('As', '5s'), board('Ks', '9s', '2s'))
    expect(d.category).toBe(HandCategory.Flush)
    expect(d.label).toBe('Ace-high flush')
  })

  it('does not call a non-matching suit a flush on the same board', () => {
    const d = describeHolding(hole('Ah', '5d'), board('Ks', '9s', '2s'))
    expect(d.category).toBe(HandCategory.HighCard)
    expect(d.label).toBe('Ace-high')
  })

  it('names a pair by rank', () => {
    expect(describeHolding(hole('Kh', 'Qd'), board('Kc', '7s', '2d')).label).toBe('Pair of Kings')
  })

  it('names two pair high-to-low', () => {
    expect(describeHolding(hole('Ah', 'Kd'), board('Ac', 'Ks', '2d')).label).toBe('Two pair, Aces & Kings')
  })

  it('names a set / three of a kind', () => {
    expect(describeHolding(hole('9d', '9h'), board('As', '9c', '4d')).label).toBe('Three of a kind, Nines')
  })

  it('names a straight by its high card (incl. the wheel)', () => {
    expect(describeHolding(hole('5h', '4h'), board('Ad', '2c', '3s')).label).toBe('Five-high straight')
  })

  it('names a full house trips-over-pair', () => {
    expect(describeHolding(hole('Ah', 'Ad'), board('Ac', 'Ks', 'Kd')).label).toBe('Full house, Aces full of Kings')
  })

  it('calls the Broadway straight flush a royal', () => {
    expect(describeHolding(hole('Ah', 'Kh'), board('Qh', 'Jh', 'Th')).label).toBe('Royal flush')
  })
})

describe('describeHolding — draws (pre-river only)', () => {
  it('flags a flush draw the hero is part of', () => {
    expect(describeHolding(hole('As', '7s'), board('Ks', '9s', '2d')).draws).toContain('Flush draw')
  })

  it('flags an open-ended straight draw', () => {
    expect(describeHolding(hole('9h', '8h'), board('7s', '6d', '2c')).draws).toContain('Open-ended straight draw')
  })

  it('flags a gutshot', () => {
    expect(describeHolding(hole('9h', '8h'), board('6s', '5d', '2c')).draws).toContain('Gutshot straight draw')
  })

  it('reports no draws on the river', () => {
    expect(describeHolding(hole('As', '7s'), board('Ks', '9s', '2d', 'Jc', '3h')).draws).toEqual([])
  })

  it('does not report a flush draw once the flush is made', () => {
    expect(describeHolding(hole('As', '7s'), board('Ks', '9s', '2s', 'Jc')).draws).not.toContain('Flush draw')
  })
})

describe('describeHolding — preflop (hole cards only)', () => {
  it('names a pocket pair', () => {
    const d = describeHolding(hole('Kh', 'Kd'), [])
    expect(d.category).toBe(HandCategory.Pair)
    expect(d.label).toBe('Pocket Kings')
  })

  it('names suited / offsuit unpaired hands high-to-low', () => {
    expect(describeHolding(hole('Ah', 'Ks'), []).label).toBe('Ace-King offsuit')
    expect(describeHolding(hole('Ts', 'Js'), []).label).toBe('Jack-Ten suited')
  })
})
