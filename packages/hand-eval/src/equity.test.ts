import { describe, expect, it } from 'vitest'
import { cardFromString, type Card } from './cards'
import { equity, equityExact, equityMonteCarlo } from './equity'
import { createRng } from './rng'

const hole = (s: string): readonly [Card, Card] => {
  const [a, b] = s.split(' ').map(cardFromString)
  return [a!, b!]
}
const board = (s: string): Card[] => (s ? s.split(' ').map(cardFromString) : [])

describe('equity — Monte Carlo', () => {
  it('AA vs KK preflop is ~82/18 (spec acceptance vector)', () => {
    const eq = equityMonteCarlo(hole('Ah As'), hole('Kd Kc'), [], 60_000, createRng('aa-vs-kk'))
    expect(eq.equity).toBeGreaterThan(0.79)
    expect(eq.equity).toBeLessThan(0.86)
  })

  it('AKs vs QQ preflop is a near coinflip (~46% for AK)', () => {
    const eq = equityMonteCarlo(hole('Ah Kh'), hole('Qs Qd'), [], 60_000, createRng('ak-vs-qq'))
    expect(eq.equity).toBeGreaterThan(0.4)
    expect(eq.equity).toBeLessThan(0.52)
  })

  it('is deterministic for a fixed seed', () => {
    const a = equityMonteCarlo(hole('Ah As'), hole('Kd Kc'), [], 5_000, createRng('seed'))
    const b = equityMonteCarlo(hole('Ah As'), hole('Kd Kc'), [], 5_000, createRng('seed'))
    expect(a).toEqual(b)
  })
})

describe('equity — exact enumeration', () => {
  it('enumerates all turn+river combinations on a flop', () => {
    const eq = equityExact(hole('Ah Ad'), hole('Ks Kc'), board('2h 7d Tc'))
    expect(eq.win + eq.tie + eq.lose).toBe(990) // C(45, 2)
    expect(eq.equity).toBeGreaterThan(0.85) // overpair dominates
  })

  it('a fully-determined board where both make the same straight is a tie (0.5)', () => {
    const eq = equityExact(hole('Ah Kh'), hole('As Ks'), board('Qc Jd Th 2c 3d'))
    expect(eq).toMatchObject({ win: 0, lose: 0, tie: 1, equity: 0.5 })
  })
})

describe('equity — dispatch', () => {
  it('uses exact enumeration once the flop is out', () => {
    const a = equity(hole('Ah Ad'), hole('Ks Kc'), board('2h 7d Tc'))
    const b = equityExact(hole('Ah Ad'), hole('Ks Kc'), board('2h 7d Tc'))
    expect(a).toEqual(b)
  })
})
