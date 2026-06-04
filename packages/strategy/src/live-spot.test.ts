import { cardFromString } from '@gto/hand-eval'
import { describe, expect, it } from 'vitest'
import {
  decodeLiveSolverSpot,
  encodeLiveSolverSpot,
  type LivePostflopSpot,
  type LivePreflopSpot,
} from './live-spot'

const c = (s: string) => cardFromString(s)

describe('encode/decode round-trips', () => {
  it('round-trips an RFI preflop spot (no opener/3-bettor, no cards)', () => {
    const spot: LivePreflopSpot = {
      mode: 'preflop',
      hero: 'CO',
      lineKind: 'rfi',
      opener: null,
      threeBettor: null,
      fourBettor: null,
      cards: [],
    }
    expect(decodeLiveSolverSpot(encodeLiveSolverSpot(spot))).toEqual({
      mode: 'preflop',
      hero: 'CO',
      lineKind: 'rfi',
    })
  })

  it('round-trips a vsRfi spot with opener and hole cards', () => {
    const spot: LivePreflopSpot = {
      mode: 'preflop',
      hero: 'BB',
      lineKind: 'vsRfi',
      opener: 'BTN',
      threeBettor: null,
      fourBettor: null,
      cards: [c('As'), c('Kh')],
    }
    expect(decodeLiveSolverSpot(encodeLiveSolverSpot(spot))).toEqual({
      mode: 'preflop',
      hero: 'BB',
      lineKind: 'vsRfi',
      opener: 'BTN',
      cards: [c('As'), c('Kh')],
    })
  })

  it('round-trips a vs4bet spot with the 4-bettor (opener)', () => {
    const spot: LivePreflopSpot = {
      mode: 'preflop',
      hero: 'BTN',
      lineKind: 'vs4bet',
      opener: null,
      threeBettor: null,
      fourBettor: 'CO',
      cards: [c('Ad'), c('Ks')],
    }
    expect(decodeLiveSolverSpot(encodeLiveSolverSpot(spot))).toEqual({
      mode: 'preflop',
      hero: 'BTN',
      lineKind: 'vs4bet',
      fourBettor: 'CO',
      cards: [c('Ad'), c('Ks')],
    })
  })

  it('drops opener/3-bettor that do not apply to the line kind', () => {
    const spot: LivePreflopSpot = {
      mode: 'preflop',
      hero: 'CO',
      lineKind: 'rfi',
      opener: 'UTG', // irrelevant for rfi
      threeBettor: 'BTN', // irrelevant for rfi
      fourBettor: 'HJ', // irrelevant for rfi
      cards: [],
    }
    const decoded = decodeLiveSolverSpot(encodeLiveSolverSpot(spot))
    expect(decoded).not.toHaveProperty('opener')
    expect(decoded).not.toHaveProperty('threeBettor')
    expect(decoded).not.toHaveProperty('fourBettor')
  })

  it('round-trips a full postflop spot including pot, sliders and preview bet', () => {
    const spot: LivePostflopSpot = {
      mode: 'postflop',
      street: 'turn',
      hero: 'BB',
      villain: 'BTN',
      potType: '3bet',
      aggressor: 'hero',
      board: [c('2h'), c('7d'), c('9s'), c('Td')],
      cards: [c('Ac'), c('Kc')],
      linePreset: 'flop-bet-call',
      potBb: 18.5,
      facing: true,
      villainBetBb: 6.25,
      heroFirstBetBb: 4,
      villainRaiseBb: 12,
      heroBetChips: 1325,
    }
    expect(decodeLiveSolverSpot(encodeLiveSolverSpot(spot))).toEqual({
      mode: 'postflop',
      street: 'turn',
      hero: 'BB',
      villain: 'BTN',
      potType: '3bet',
      aggressor: 'hero',
      board: [c('2h'), c('7d'), c('9s'), c('Td')],
      cards: [c('Ac'), c('Kc')],
      linePreset: 'flop-bet-call',
      potBb: 18.5,
      facing: true,
      villainBetBb: 6.25,
      heroFirstBetBb: 4,
      villainRaiseBb: 12,
      heroBetChips: 1325,
    })
  })

  it('omits facing when false (default) and rounds the preview bet to whole chips', () => {
    const base: LivePostflopSpot = {
      mode: 'postflop',
      street: 'flop',
      hero: 'BB',
      villain: 'BTN',
      potType: 'srp',
      aggressor: 'villain',
      board: [],
      cards: [],
      linePreset: 'manual',
      potBb: 5.5,
      facing: false,
      villainBetBb: 3,
      heroFirstBetBb: 3,
      villainRaiseBb: 9,
      heroBetChips: 366.7,
    }
    const qs = encodeLiveSolverSpot(base)
    expect(qs).not.toContain('f=1')
    expect(new URLSearchParams(qs).get('bet')).toBe('367')
    expect(decodeLiveSolverSpot(qs)).not.toHaveProperty('facing')
  })
})

describe('decode validation', () => {
  it('returns null without a recognised mode', () => {
    expect(decodeLiveSolverSpot('')).toBeNull()
    expect(decodeLiveSolverSpot('m=bogus&h=CO')).toBeNull()
    expect(decodeLiveSolverSpot('h=CO&l=rfi')).toBeNull()
  })

  it('drops invalid enum/position fields rather than throwing', () => {
    expect(decodeLiveSolverSpot('m=preflop&h=ZZ&l=sideways')).toEqual({ mode: 'preflop' })
    expect(decodeLiveSolverSpot('m=postflop&s=fifth&pt=4bet&ag=nobody')).toEqual({ mode: 'postflop' })
  })

  it('rejects malformed card tokens', () => {
    expect(decodeLiveSolverSpot('m=preflop&c=A')).not.toHaveProperty('cards') // odd length
    expect(decodeLiveSolverSpot('m=preflop&c=AsAs')).not.toHaveProperty('cards') // duplicate
    expect(decodeLiveSolverSpot('m=preflop&c=Xy')).not.toHaveProperty('cards') // unknown rank/suit
    expect(decodeLiveSolverSpot('m=postflop&b=2h7d9sTdAcKc')).not.toHaveProperty('board') // > 5 cards
  })

  it('rejects non-finite or negative amounts', () => {
    expect(decodeLiveSolverSpot('m=postflop&pot=NaN')).not.toHaveProperty('potBb')
    expect(decodeLiveSolverSpot('m=postflop&pot=-3')).not.toHaveProperty('potBb')
    expect(decodeLiveSolverSpot('m=postflop&bet=abc')).not.toHaveProperty('heroBetChips')
  })

  it('accepts a URLSearchParams instance directly', () => {
    const params = new URLSearchParams('m=preflop&h=UTG&l=rfi')
    expect(decodeLiveSolverSpot(params)).toEqual({ mode: 'preflop', hero: 'UTG', lineKind: 'rfi' })
  })
})
