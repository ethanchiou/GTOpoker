import { cardFromString } from '@gto/hand-eval'
import { describe, expect, it } from 'vitest'
import { ALL_HAND_CLASSES, comboCount, HAND_CLASS_GRID, handClass } from './hand-class'

const c = cardFromString

describe('handClass', () => {
  it('names pairs, suited, and offsuit combos with the high card first', () => {
    expect(handClass(c('Ah'), c('Ad'))).toBe('AA')
    expect(handClass(c('As'), c('Ks'))).toBe('AKs')
    expect(handClass(c('Ks'), c('Ah'))).toBe('AKo')
    expect(handClass(c('5d'), c('Ad'))).toBe('A5s') // order-independent
    expect(handClass(c('7c'), c('2h'))).toBe('72o')
  })
})

describe('hand class universe', () => {
  it('has 169 unique classes', () => {
    expect(ALL_HAND_CLASSES).toHaveLength(169)
    expect(new Set(ALL_HAND_CLASSES).size).toBe(169)
  })

  it('lays out a 13×13 grid with pairs on the diagonal, suited above, offsuit below', () => {
    expect(HAND_CLASS_GRID).toHaveLength(13)
    expect(HAND_CLASS_GRID[0]).toHaveLength(13)
    expect(HAND_CLASS_GRID[0]![0]).toBe('AA')
    expect(HAND_CLASS_GRID[12]![12]).toBe('22')
    expect(HAND_CLASS_GRID[0]![1]).toBe('AKs') // upper triangle
    expect(HAND_CLASS_GRID[1]![0]).toBe('AKo') // lower triangle
  })

  it('counts combos per class', () => {
    expect(comboCount('AA')).toBe(6)
    expect(comboCount('AKs')).toBe(4)
    expect(comboCount('AKo')).toBe(12)
  })
})
