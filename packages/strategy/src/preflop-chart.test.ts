import type { Position } from '@gto/domain-config'
import type { ActionRecord, GameNodeKey } from '@gto/poker-engine'
import { describe, expect, it } from 'vitest'
import { classifyPreflop, CompositeStrategyProvider, PreflopChartProvider } from './preflop-chart'
import { SEED_CHART } from './seed-chart'
import { strategyForHand } from './types'

const raiseBy = (position: Position): ActionRecord => ({
  seatIndex: 0,
  position,
  street: 'preflop',
  action: { type: 'raise', amount: 250 },
})

const node = (heroPosition: Position, history: ActionRecord[] = []): GameNodeKey => ({
  street: 'preflop',
  heroPosition,
  board: [],
  history,
})

const callBy = (position: Position): ActionRecord => ({
  seatIndex: 0,
  position,
  street: 'preflop',
  action: { type: 'call', amount: 250 },
})

/** Reconstruct the canonical raise-only node whose hero decision maps to `spotId`. */
function nodeForSpotId(id: string): GameNodeKey {
  const [fam, heroStr, vsStr] = id.split('/')
  const hero = heroStr as Position
  const villain = vsStr?.slice(2) as Position // "vsCO" -> "CO"
  switch (fam) {
    case 'rfi':
      return node(hero)
    case 'vsRfi':
      return node(hero, [raiseBy(villain)])
    case 'vs3bet': // hero opened, villain 3-bet
      return node(hero, [raiseBy(hero), raiseBy(villain)])
    case 'vs4bet': // hero 3-bet, villain (opener) 4-bet
      return node(hero, [raiseBy(villain), raiseBy(hero), raiseBy(villain)])
    case 'vs5bet': // hero opened + 4-bet, villain (3-bettor) 5-bet jammed
      return node(hero, [raiseBy(hero), raiseBy(villain), raiseBy(hero), raiseBy(villain)])
    default:
      throw new Error(`unknown spot family: ${id}`)
  }
}

describe('classifyPreflop', () => {
  it('classifies an unraised pot as RFI (except the BB)', () => {
    expect(classifyPreflop(node('CO'))?.spotId).toBe('rfi/CO')
    expect(classifyPreflop(node('BB'))).toBeNull()
  })

  it('classifies a single raise as vs-RFI against the opener', () => {
    expect(classifyPreflop(node('BB', [raiseBy('BTN')]))?.spotId).toBe('vsRfi/BB/vsBTN')
  })

  it('classifies the original opener facing a 3-bet', () => {
    expect(classifyPreflop(node('BTN', [raiseBy('BTN'), raiseBy('BB')]))?.spotId).toBe('vs3bet/BTN/vsBB')
  })

  it('classifies the 3-bettor facing a 4-bet', () => {
    // CO opens, BTN 3-bets, CO 4-bets — BTN now faces the 4-bet.
    expect(classifyPreflop(node('BTN', [raiseBy('CO'), raiseBy('BTN'), raiseBy('CO')]))?.spotId).toBe(
      'vs4bet/BTN/vsCO',
    )
  })

  it('classifies the opener facing a 5-bet jam', () => {
    // CO opens, BTN 3-bets, CO 4-bets, BTN jams — CO now faces the 5-bet.
    expect(
      classifyPreflop(node('CO', [raiseBy('CO'), raiseBy('BTN'), raiseBy('CO'), raiseBy('BTN')]))?.spotId,
    ).toBe('vs5bet/CO/vsBTN')
  })

  it('routes lines with a cold-caller to the multiway path (null here)', () => {
    // UTG opens, CO cold-calls, BB acts — a squeeze spot, not a heads-up vs-RFI.
    expect(classifyPreflop(node('BB', [raiseBy('UTG'), callBy('CO')]))).toBeNull()
    // A third party facing a 3-bet (cold 4-bet) stays unsupported by the linear classifier.
    expect(classifyPreflop(node('BB', [raiseBy('CO'), raiseBy('BTN')]))).toBeNull()
  })
})

describe('PreflopChartProvider with the seed chart', () => {
  const provider = new PreflopChartProvider(SEED_CHART)

  it('supports modelled spots and rejects unmodelled ones', () => {
    expect(provider.supports(node('BTN'))).toBe(true)
    expect(provider.supports(node('BB', [raiseBy('BTN')]))).toBe(true)
    expect(provider.supports(node('BTN', [raiseBy('BTN'), raiseBy('BB')]))).toBe(true)
    expect(provider.supports(node('BB'))).toBe(false) // BB RFI not modelled
    expect(provider.supports(node('BB', [raiseBy('CO'), raiseBy('BTN')]))).toBe(false)
  })

  it('supports every standard single-open response spot', () => {
    const spots: Array<[Position, Position]> = [
      ['HJ', 'UTG'],
      ['CO', 'UTG'],
      ['CO', 'HJ'],
      ['BTN', 'UTG'],
      ['BTN', 'HJ'],
      ['BTN', 'CO'],
      ['SB', 'UTG'],
      ['SB', 'HJ'],
      ['SB', 'CO'],
      ['SB', 'BTN'],
      ['BB', 'UTG'],
      ['BB', 'HJ'],
      ['BB', 'CO'],
      ['BB', 'BTN'],
      ['BB', 'SB'],
    ]
    for (const [hero, opener] of spots) {
      expect(provider.supports(node(hero, [raiseBy(opener)])), `vsRfi/${hero}/vs${opener}`).toBe(true)
    }
  })

  it('returns call, 4-bet, all-in, and fold mixes when the opener faces a 3-bet', async () => {
    const s = await provider.getStrategy(node('BTN', [raiseBy('BTN'), raiseBy('BB')]))
    expect(s.spotId).toBe('vs3bet/BTN/vsBB')
    expect(strategyForHand(s, 'AA')).toEqual([
      { actionId: 'raiseTo:25', frequency: 0.75 },
      { actionId: 'allIn', frequency: 0.25 },
    ])
    expect(strategyForHand(s, '99')).toContainEqual({ actionId: 'call', frequency: 1 })
    expect(strategyForHand(s, '72o')).toEqual([{ actionId: 'fold', frequency: 1 }])
  })

  it('returns pure, folded, and mixed strategies for the BTN open', async () => {
    const s = await provider.getStrategy(node('BTN'))
    expect(strategyForHand(s, 'AA')).toEqual([{ actionId: 'raiseTo:2.5', frequency: 1 }])
    expect(strategyForHand(s, '72o')).toEqual([{ actionId: 'fold', frequency: 1 }])
    // A5o is a 50/50 open in the seed data.
    const a5o = strategyForHand(s, 'A5o')
    expect(a5o).toContainEqual({ actionId: 'raiseTo:2.5', frequency: 0.5 })
    expect(a5o).toContainEqual({ actionId: 'fold', frequency: 0.5 })
  })

  it('every spot classifies back to its own id and serves valid frequencies', async () => {
    for (const spot of SEED_CHART.spots) {
      const n = nodeForSpotId(spot.id)
      expect(classifyPreflop(n)?.spotId, `${spot.id} round-trip`).toBe(spot.id)
      const s = await provider.getStrategy(n)
      expect(s.spotId).toBe(spot.id)
      for (const [cls, row] of Object.entries(s.grid)) {
        const sum = row.reduce((acc, a) => acc + a.frequency, 0)
        expect(sum, `${spot.id} ${cls}`).toBeCloseTo(1, 6)
        for (const a of row) {
          expect(a.frequency).toBeGreaterThan(0)
          expect(a.frequency).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('supports the full 3-bet/4-bet/5-bet tree the engine can reach', () => {
    expect(provider.supports(nodeForSpotId('vs3bet/UTG/vsCO'))).toBe(true) // completed matrix
    expect(provider.supports(nodeForSpotId('vs4bet/BTN/vsCO'))).toBe(true) // 3-bettor facing a 4-bet
    expect(provider.supports(nodeForSpotId('vs5bet/CO/vsBTN'))).toBe(true) // opener facing a 5-bet jam
  })

  it('defends AQo in the BB vs a CO open (regression: was a silent 100% fold)', async () => {
    const s = await provider.getStrategy(nodeForSpotId('vsRfi/BB/vsCO'))
    const aqo = strategyForHand(s, 'AQo')
    expect(aqo.some((a) => a.actionId !== 'fold' && a.frequency > 0)).toBe(true)
  })
})

describe('CompositeStrategyProvider', () => {
  it('routes to the first provider that supports the node', async () => {
    const composite = new CompositeStrategyProvider([new PreflopChartProvider(SEED_CHART)])
    expect(composite.supports(node('CO'))).toBe(true)
    expect((await composite.getStrategy(node('CO'))).spotId).toBe('rfi/CO')
    await expect(composite.getStrategy(node('BB'))).rejects.toThrow()
  })
})
