import { describe, expect, it } from 'vitest'
import { parseRange } from './range'

const classes = (s: string) => [...parseRange(s).keys()].sort()

describe('parseRange', () => {
  it('parses single pairs and pair-plus', () => {
    expect(classes('AA')).toEqual(['AA'])
    expect(classes('QQ+')).toEqual(['AA', 'KK', 'QQ'].sort())
  })

  it('parses pair ranges', () => {
    expect(classes('22-55')).toEqual(['22', '33', '44', '55'])
  })

  it('parses suited/offsuit combos and plus forms', () => {
    expect(classes('AKs')).toEqual(['AKs'])
    expect(classes('A2s+')).toEqual(['A2s', 'A3s', 'A4s', 'A5s', 'A6s', 'A7s', 'A8s', 'A9s', 'ATs', 'AJs', 'AQs', 'AKs'].sort())
    expect(classes('KTo+')).toEqual(['KTo', 'KJo', 'KQo'].sort())
  })

  it('parses combo ranges', () => {
    expect(classes('A2s-A4s')).toEqual(['A2s', 'A3s', 'A4s'])
  })

  it('applies mixed frequencies', () => {
    const map = parseRange('AJs:0.5, KQo')
    expect(map.get('AJs')).toBe(0.5)
    expect(map.get('KQo')).toBe(1)
  })

  it('accumulates and caps frequency at 1', () => {
    expect(parseRange('AA:0.5, AA:0.7').get('AA')).toBe(1)
  })

  it('rejects malformed tokens and bad frequencies', () => {
    expect(() => parseRange('XYZ')).toThrow()
    expect(() => parseRange('AA:1.5')).toThrow()
  })
})
