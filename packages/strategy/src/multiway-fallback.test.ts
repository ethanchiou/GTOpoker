import type { Position } from '@gto/domain-config'
import type { ActionRecord, GameNodeKey } from '@gto/poker-engine'
import { describe, expect, it } from 'vitest'
import { classifyMultiway, MultiwayFallbackProvider } from './multiway-fallback'
import { PreflopChartProvider } from './preflop-chart'
import { SEED_CHART } from './seed-chart'
import { strategyForHand } from './types'

const raiseBy = (position: Position): ActionRecord => ({
  seatIndex: 0,
  position,
  street: 'preflop',
  action: { type: 'raise', amount: 250 },
})
const callBy = (position: Position): ActionRecord => ({
  seatIndex: 0,
  position,
  street: 'preflop',
  action: { type: 'call', amount: 250 },
})
const node = (heroPosition: Position, history: ActionRecord[]): GameNodeKey => ({
  street: 'preflop',
  heroPosition,
  board: [],
  history,
})

describe('classifyMultiway', () => {
  it('maps a squeeze (open + caller) to the hero vs-RFI range', () => {
    expect(classifyMultiway(node('BB', [raiseBy('UTG'), callBy('CO')]))).toEqual({
      refSpotId: 'vsRfi/BB/vsUTG',
      mode: 'asIs',
      displayId: 'squeeze/BB/vsUTG',
    })
  })

  it('maps a cold 4-bet (third party vs open + 3-bet) to the opener vs-3bet range, value only', () => {
    expect(classifyMultiway(node('BTN', [raiseBy('UTG'), raiseBy('CO')]))).toEqual({
      refSpotId: 'vs3bet/UTG/vsCO',
      mode: 'aggressiveOnly',
      displayId: 'coldFourBet/BTN/vsCO',
    })
  })

  it('maps the opener facing a squeeze to its vs-3bet response', () => {
    expect(classifyMultiway(node('UTG', [raiseBy('UTG'), callBy('CO'), raiseBy('BTN')]))).toEqual({
      refSpotId: 'vs3bet/UTG/vsBTN',
      mode: 'asIs',
      displayId: 'vsSqueeze/UTG/vsBTN',
    })
  })

  it('leaves the linear (no-caller) lines to classifyPreflop', () => {
    expect(classifyMultiway(node('BB', [raiseBy('BTN')]))).toBeNull() // heads-up vs-RFI
    expect(classifyMultiway(node('BTN', [raiseBy('BTN'), raiseBy('BB')]))).toBeNull() // heads-up vs-3bet
    expect(classifyMultiway(node('CO', [raiseBy('UTG'), raiseBy('CO')]))).toBeNull() // 3-bettor waiting for the 4-bet
  })
})

describe('MultiwayFallbackProvider', () => {
  const charts = new PreflopChartProvider(SEED_CHART)
  const provider = new MultiwayFallbackProvider(charts)

  it('supports multiway nodes and flags them low-confidence', async () => {
    const squeeze = node('BB', [raiseBy('UTG'), callBy('CO')])
    expect(provider.supports(squeeze)).toBe(true)
    const s = await provider.getStrategy(squeeze)
    expect(s.meta.confidence).toBe('low')
    expect(s.spotId).toBe('squeeze/BB/vsUTG')
  })

  it('squeeze reuses the heads-up defense (still 3-bets premiums, frequencies sum to 1)', async () => {
    const s = await provider.getStrategy(node('BB', [raiseBy('UTG'), callBy('CO')]))
    // AA 3-bets in vsRfi/BB/vsUTG, so the squeeze keeps a raise.
    expect(strategyForHand(s, 'AA').some((a) => a.actionId.startsWith('raiseTo:'))).toBe(true)
    for (const row of Object.values(s.grid)) {
      expect(row.reduce((acc, a) => acc + a.frequency, 0)).toBeCloseTo(1, 6)
    }
  })

  it('cold 4-bet keeps only value (4-bet/jam) and folds the flatting hands', async () => {
    const s = await provider.getStrategy(node('BTN', [raiseBy('UTG'), raiseBy('CO')]))
    // AA 4-bets/jams in the reference vs3bet; it survives.
    expect(strategyForHand(s, 'AA').some((a) => a.actionId === 'allIn' || a.actionId.startsWith('raiseTo:'))).toBe(true)
    // TT only *calls* a 3-bet in the reference, so as a cold 4-bet it folds.
    expect(strategyForHand(s, 'TT')).toEqual([{ actionId: 'fold', frequency: 1 }])
    // No passive actions leak into a cold 4-bet.
    for (const row of Object.values(s.grid)) {
      expect(row.every((a) => a.actionId !== 'call' && a.actionId !== 'check')).toBe(true)
      expect(row.reduce((acc, a) => acc + a.frequency, 0)).toBeCloseTo(1, 6)
    }
  })

  it('does not support deep (3+ raise) multiway pots', () => {
    expect(provider.supports(node('UTG', [raiseBy('UTG'), callBy('CO'), raiseBy('BTN'), raiseBy('UTG')]))).toBe(false)
  })
})
