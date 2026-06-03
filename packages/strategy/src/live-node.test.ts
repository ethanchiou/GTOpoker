import { describe, expect, it } from 'vitest'
import { classifyPreflop, PreflopChartProvider } from './preflop-chart'
import { SEED_CHART } from './seed-chart'
import { buildPreflopLineNode, positionsAfter, positionsBefore } from './live-node'
import { villainContinuingRange } from './range-handoff'

describe('buildPreflopLineNode', () => {
  it('RFI: only blinds in the pot, no villain, opening spot', () => {
    const { node, villain, facingBet } = buildPreflopLineNode({ kind: 'rfi', hero: 'CO' })
    expect(villain).toBeNull()
    expect(facingBet).toBe(false)
    expect(node.potChips).toBe(150) // SB 50 + BB 100
    expect(classifyPreflop(node)?.spotId).toBe('rfi/CO')
  })

  it('vs-RFI: maps to the vsRfi spot and prices the call correctly', () => {
    const { node, villain, facingBet } = buildPreflopLineNode({ kind: 'vsRfi', hero: 'BTN', opener: 'CO' })
    expect(villain).toBe('CO')
    expect(facingBet).toBe(true)
    // CO opens to 2.5bb (250); BTN posts no blind; SB+BB dead = 150.
    expect(node.potChips).toBe(250 + 0 + 150)
    expect(node.toCallChips).toBe(250)
    expect(classifyPreflop(node)?.spotId).toBe('vsRfi/BTN/vsCO')
  })

  it('vs-RFI from the BB closes for a discount (blind already in)', () => {
    const { node } = buildPreflopLineNode({ kind: 'vsRfi', hero: 'BB', opener: 'CO' })
    // CO 250 + BB 100 + dead SB 50 = 400; BB to call 250 - 100 = 150.
    expect(node.potChips).toBe(400)
    expect(node.toCallChips).toBe(150)
    expect(classifyPreflop(node)?.spotId).toBe('vsRfi/BB/vsCO')
  })

  it('vs-3bet: hero is the opener facing a 3-bet', () => {
    const { node, villain } = buildPreflopLineNode({ kind: 'vs3bet', hero: 'CO', threeBettor: 'BB' })
    expect(villain).toBe('BB')
    // CO opens 250, BB 3-bets to 1100, dead SB 50.
    expect(node.potChips).toBe(1100 + 250 + 50)
    expect(node.toCallChips).toBe(850)
    expect(classifyPreflop(node)?.spotId).toBe('vs3bet/CO/vsBB')
  })

  it('position helpers respect preflop action order', () => {
    expect(positionsBefore('BTN')).toEqual(['UTG', 'HJ', 'CO'])
    expect(positionsAfter('CO')).toEqual(['BTN', 'SB', 'BB'])
    expect(positionsBefore('UTG')).toEqual([])
  })
})

describe('villainContinuingRange on fabricated preflop nodes', () => {
  const provider = new PreflopChartProvider(SEED_CHART)

  it('vs-RFI returns the opener as villain with a non-empty range', async () => {
    const { node } = buildPreflopLineNode({ kind: 'vsRfi', hero: 'BB', opener: 'CO' })
    const { villain, range } = await villainContinuingRange(node, provider)
    expect(villain).toBe('CO')
    expect(range.length).toBeGreaterThan(0)
    // Every combo carries a positive weight (folded combos drop out).
    expect(range.every((c) => c.weight > 0)).toBe(true)
  })

  it('RFI has no defined villain', async () => {
    const { node } = buildPreflopLineNode({ kind: 'rfi', hero: 'CO' })
    const { villain, range } = await villainContinuingRange(node, provider)
    expect(villain).toBeNull()
    expect(range).toHaveLength(0)
  })

  it('vs-3bet returns the 3-bettor as villain', async () => {
    const { node } = buildPreflopLineNode({ kind: 'vs3bet', hero: 'CO', threeBettor: 'BB' })
    const { villain, range } = await villainContinuingRange(node, provider)
    expect(villain).toBe('BB')
    expect(range.length).toBeGreaterThan(0)
  })
})
