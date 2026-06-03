import { cardFromString, type Card } from '@gto/hand-eval'
import { describe, expect, it } from 'vitest'
import { BaselineSolverTransport } from './baseline-transport'
import { classifyPreflop, PreflopChartProvider } from './preflop-chart'
import { PostflopSolverProvider } from './postflop-provider'
import type { SolveRequest, SolveResult, SolverTransport } from './postflop-types'
import { SEED_CHART } from './seed-chart'
import {
  buildPostflopLineNode,
  buildPreflopLineNode,
  POSTFLOP_BOARD_LEN,
  potFractionForBetTo,
  positionsAfter,
  positionsBefore,
  type PostflopActionLine,
  type PostflopActionStep,
} from './live-node'
import { villainContinuingRange } from './range-handoff'

const board = (s: string): Card[] => s.split(' ').map(cardFromString)
const step = (
  street: PostflopActionStep['street'],
  actor: PostflopActionStep['actor'],
  action: PostflopActionStep['action'],
  amountChips?: number,
): PostflopActionStep => (amountChips === undefined ? { street, actor, action } : { street, actor, action, amountChips })
const line = (label: string, steps: PostflopActionStep[]): PostflopActionLine => ({ label, steps })
const postflopHistory = <T extends { street: string }>(history: readonly T[]): T[] =>
  history.filter((r) => r.street !== 'preflop')

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

describe('buildPostflopLineNode', () => {
  const flop = board('Ah Kd 7c')

  it('SRP, villain opened: flop pot, no bet, charted ranges for both players', () => {
    // BTN opens 2.5bb, BB calls → BB (hero) vs BTN (villain) on the flop, first to act.
    const { node, villain, facingBet, flopPotChips, effectiveStackChips } = buildPostflopLineNode({
      street: 'flop',
      hero: 'BB',
      villain: 'BTN',
      potType: 'srp',
      aggressor: 'villain',
      board: flop,
      potBeforeChips: 550,
      facingBetChips: 0,
    })
    expect(villain).toBe('BTN')
    expect(facingBet).toBe(false)
    // Both commit the 2.5bb open (250); SB 50 dead → 550. Stacks: 10000 − 250.
    expect(flopPotChips).toBe(550)
    expect(node.potChips).toBe(550)
    expect(node.toCallChips).toBe(0)
    expect(effectiveStackChips).toBe(9750)
    expect(node.board).toEqual(flop)
  })

  it('facing a bet: pot includes the bet, to-call equals it, current-street record added', () => {
    const { node, facingBet } = buildPostflopLineNode({
      street: 'turn',
      hero: 'BB',
      villain: 'BTN',
      potType: 'srp',
      aggressor: 'villain',
      board: board('Ah Kd 7c 2d'),
      potBeforeChips: 550,
      facingBetChips: 400,
    })
    expect(facingBet).toBe(true)
    expect(node.potChips).toBe(950) // 550 + the 400 bet
    expect(node.toCallChips).toBe(400)
    const last = node.history[node.history.length - 1]!
    expect(last.position).toBe('BTN')
    expect(last.street).toBe('turn')
    expect(last.action).toEqual({ type: 'bet', amount: 400 })
  })

  it('flop check-check -> turn: records prior-street checks without changing the pot', () => {
    const provider = new PostflopSolverProvider(new BaselineSolverTransport({ iterations: 10 }), new PreflopChartProvider(SEED_CHART))
    const { node, facingBet, effectiveStackChips, minRaiseToChips, lineLabel } = buildPostflopLineNode({
      street: 'turn',
      hero: 'BB',
      villain: 'BTN',
      potType: 'srp',
      aggressor: 'villain',
      board: board('Ah Kd 7c 2d'),
      potBeforeChips: 550,
      actionLine: line('Flop check-check -> turn', [step('flop', 'hero', 'check'), step('flop', 'villain', 'check')]),
    })

    expect(lineLabel).toBe('Flop check-check -> turn')
    expect(postflopHistory(node.history).map((r) => `${r.street}:${r.position}:${r.action.type}`)).toEqual([
      'flop:BB:check',
      'flop:BTN:check',
    ])
    expect(facingBet).toBe(false)
    expect(node.potChips).toBe(550)
    expect(node.toCallChips).toBe(0)
    expect(effectiveStackChips).toBe(9750)
    expect(minRaiseToChips).toBe(100)
    expect(provider.supports(node)).toBe(true)
  })

  it('flop bet-call -> turn: carries completed street action and shorter stacks', () => {
    const provider = new PostflopSolverProvider(new BaselineSolverTransport({ iterations: 10 }), new PreflopChartProvider(SEED_CHART))
    const { node, effectiveStackChips, currentStreetHeroCommitmentChips, currentStreetVillainCommitmentChips } =
      buildPostflopLineNode({
        street: 'turn',
        hero: 'BB',
        villain: 'BTN',
        potType: 'srp',
        aggressor: 'villain',
        board: board('Ah Kd 7c 2d'),
        potBeforeChips: 1250,
        actionLine: line('Flop bet-call -> turn', [
          step('flop', 'hero', 'check'),
          step('flop', 'villain', 'bet', 350),
          step('flop', 'hero', 'call', 350),
        ]),
      })

    expect(postflopHistory(node.history).map((r) => `${r.street}:${r.position}:${r.action.type}:${r.action.amount ?? ''}`)).toEqual([
      'flop:BB:check:',
      'flop:BTN:bet:350',
      'flop:BB:call:350',
    ])
    expect(node.potChips).toBe(1250)
    expect(node.toCallChips).toBe(0)
    expect(effectiveStackChips).toBe(9400)
    expect(currentStreetHeroCommitmentChips).toBe(0)
    expect(currentStreetVillainCommitmentChips).toBe(0)
    expect(provider.supports(node)).toBe(true)
  })

  it('turn bet-call -> river: carries prior flop and turn actions into a river node', () => {
    const provider = new PostflopSolverProvider(new BaselineSolverTransport({ iterations: 10 }), new PreflopChartProvider(SEED_CHART))
    const { node, effectiveStackChips } = buildPostflopLineNode({
      street: 'river',
      hero: 'BB',
      villain: 'BTN',
      potType: 'srp',
      aggressor: 'villain',
      board: board('Ah Kd 7c 2d 9s'),
      potBeforeChips: 1750,
      actionLine: line('Turn bet-call -> river', [
        step('flop', 'hero', 'check'),
        step('flop', 'villain', 'check'),
        step('turn', 'hero', 'check'),
        step('turn', 'villain', 'bet', 600),
        step('turn', 'hero', 'call', 600),
      ]),
    })

    expect(postflopHistory(node.history).map((r) => `${r.street}:${r.position}:${r.action.type}:${r.action.amount ?? ''}`)).toEqual([
      'flop:BB:check:',
      'flop:BTN:check:',
      'turn:BB:check:',
      'turn:BTN:bet:600',
      'turn:BB:call:600',
    ])
    expect(node.potChips).toBe(1750)
    expect(node.toCallChips).toBe(0)
    expect(effectiveStackChips).toBe(9150)
    expect(provider.supports(node)).toBe(true)
  })

  it('hero bet facing raise: derives to-call, min re-raise, commitments, and exact-size fraction', async () => {
    class CaptureTransport implements SolverTransport {
      requests: SolveRequest[] = []

      async solve(req: SolveRequest): Promise<SolveResult> {
        this.requests.push(req)
        return {
          hero: req.heroRange.map(({ hand }) => ({
            hand,
            actions: [{ actionId: 'fold', frequency: 1, ev: 0 }],
          })),
          meta: { confidence: 'low', approximate: true, label: 'capture' },
        }
      }
    }

    const transport = new CaptureTransport()
    const provider = new PostflopSolverProvider(transport, new PreflopChartProvider(SEED_CHART))
    const built = buildPostflopLineNode({
      street: 'flop',
      hero: 'BB',
      villain: 'BTN',
      potType: 'srp',
      aggressor: 'villain',
      board: flop,
      potBeforeChips: 550,
      actionLine: line('Hero bet facing raise', [
        step('flop', 'hero', 'bet', 400),
        step('flop', 'villain', 'raise', 1200),
      ]),
    })

    expect(built.facingBet).toBe(true)
    expect(built.node.potChips).toBe(2150)
    expect(built.node.toCallChips).toBe(800)
    expect(built.currentStreetHeroCommitmentChips).toBe(400)
    expect(built.currentStreetVillainCommitmentChips).toBe(1200)
    expect(built.minRaiseToChips).toBe(2000)
    expect(built.effectiveStackChips).toBe(9350)
    expect(provider.supports(built.node)).toBe(true)

    const exactFraction = potFractionForBetTo(
      built.node.potChips ?? 0,
      built.node.toCallChips ?? 0,
      built.currentStreetVillainCommitmentChips,
      3000,
    )
    expect(exactFraction).toBeCloseTo(1800 / 2950, 5)

    await provider.getStrategyWithSizes(built.node, [exactFraction])
    expect(transport.requests[0]!.heroCommittedThisStreetChips).toBe(400)
    expect(transport.requests[0]!.villainCommittedThisStreetChips).toBe(1200)
    expect(transport.requests[0]!.minRaiseToChips).toBe(2000)
    expect(transport.requests[0]!.betFractions).toContain(Number(exactFraction.toFixed(4)))
  })

  it('villain donk bets, delayed c-bets, and probes are representable as explicit current-street lines', () => {
    const provider = new PostflopSolverProvider(new BaselineSolverTransport({ iterations: 10 }), new PreflopChartProvider(SEED_CHART))

    const donk = buildPostflopLineNode({
      street: 'flop',
      hero: 'BTN',
      villain: 'BB',
      potType: 'srp',
      aggressor: 'hero',
      board: flop,
      potBeforeChips: 550,
      actionLine: line('Villain donk bet', [step('flop', 'villain', 'bet', 300)]),
    })
    expect(donk.node.potChips).toBe(850)
    expect(donk.node.toCallChips).toBe(300)
    expect(donk.currentStreetVillainCommitmentChips).toBe(300)
    expect(donk.minRaiseToChips).toBe(600)
    expect(provider.supports(donk.node)).toBe(true)

    const delayedCbetNode = buildPostflopLineNode({
      street: 'turn',
      hero: 'BTN',
      villain: 'BB',
      potType: 'srp',
      aggressor: 'hero',
      board: board('Ah Kd 7c 2d'),
      potBeforeChips: 550,
      actionLine: line('Delayed c-bet node', [
        step('flop', 'villain', 'check'),
        step('flop', 'hero', 'check'),
        step('turn', 'villain', 'check'),
      ]),
    })
    expect(delayedCbetNode.node.potChips).toBe(550)
    expect(delayedCbetNode.node.toCallChips).toBe(0)
    expect(postflopHistory(delayedCbetNode.node.history).at(-1)?.action.type).toBe('check')
    expect(provider.supports(delayedCbetNode.node)).toBe(true)

    const probe = buildPostflopLineNode({
      street: 'turn',
      hero: 'BTN',
      villain: 'BB',
      potType: 'srp',
      aggressor: 'hero',
      board: board('Ah Kd 7c 2d'),
      potBeforeChips: 550,
      actionLine: line('Villain probe', [
        step('flop', 'villain', 'check'),
        step('flop', 'hero', 'check'),
        step('turn', 'villain', 'bet', 450),
      ]),
    })
    expect(probe.node.potChips).toBe(1000)
    expect(probe.node.toCallChips).toBe(450)
    expect(probe.currentStreetVillainCommitmentChips).toBe(450)
    expect(probe.minRaiseToChips).toBe(900)
    expect(provider.supports(probe.node)).toBe(true)
  })

  it('3-bet pot: both commit the 3-bet, effective stacks are shorter', () => {
    // Hero opens, villain 3-bets to 11bb, hero calls → 3-bet pot (villain aggressor).
    const { flopPotChips, effectiveStackChips } = buildPostflopLineNode({
      street: 'flop',
      hero: 'BTN',
      villain: 'BB',
      potType: '3bet',
      aggressor: 'villain',
      board: flop,
      potBeforeChips: 2250,
      facingBetChips: 0,
    })
    // BB 3-bets to 11bb (1100); both in for 1100; SB 50 dead → 2250. Stacks 10000 − 1100.
    expect(flopPotChips).toBe(2250)
    expect(effectiveStackChips).toBe(8900)
  })

  it('the fabricated node is supported by the postflop solver and derives the villain range', async () => {
    const preflop = new PreflopChartProvider(SEED_CHART)
    const transport = new BaselineSolverTransport({ iterations: 50 })
    const postflop = new PostflopSolverProvider(transport, preflop)
    const { node, villain } = buildPostflopLineNode({
      street: 'flop',
      hero: 'BB',
      villain: 'BTN',
      potType: 'srp',
      aggressor: 'villain',
      board: flop,
      potBeforeChips: 550,
      facingBetChips: 0,
    })
    expect(postflop.supports(node)).toBe(true)
    const cont = await villainContinuingRange(node, preflop)
    expect(cont.villain).toBe(villain)
    expect(cont.range.length).toBeGreaterThan(0)
  })

  it('board length constants follow the streets', () => {
    expect(POSTFLOP_BOARD_LEN).toEqual({ flop: 3, turn: 4, river: 5 })
  })
})

describe('potFractionForBetTo', () => {
  it('first to act: fraction is the bet relative to the pot', () => {
    expect(potFractionForBetTo(600, 0, 0, 300)).toBeCloseTo(0.5, 5) // half-pot bet
    expect(potFractionForBetTo(600, 0, 0, 600)).toBeCloseTo(1, 5) // pot bet
  })

  it('facing a bet: fraction is the raise above the bet over the post-call pot', () => {
    // node pot (1000) already includes the 400 bet (toCall 400). The solver invests
    // villainCommitted + f·(pot + toCall): a raise-to of 1800 → 400 + f·1400 = 1800
    // → f = 1.0. A raise-to of 1400 is the 0.714 fraction (1000/1400).
    expect(potFractionForBetTo(1000, 400, 400, 1800)).toBeCloseTo(1, 5)
    expect(potFractionForBetTo(1000, 400, 400, 1400)).toBeCloseTo(1000 / 1400, 5)
  })

  it('clamps below the bet to zero', () => {
    expect(potFractionForBetTo(1000, 400, 400, 200)).toBe(0)
  })
})

describe('PostflopSolverProvider.getStrategyWithSizes', () => {
  const preflop = new PreflopChartProvider(SEED_CHART)

  it('adds the requested size to the mix the default tree would not include', async () => {
    const transport = new BaselineSolverTransport({ iterations: 80 })
    const postflop = new PostflopSolverProvider(transport, preflop)
    const { node } = buildPostflopLineNode({
      street: 'flop',
      hero: 'BTN',
      villain: 'BB',
      potType: 'srp',
      aggressor: 'hero',
      board: board('Ah Kd 7c'),
      potBeforeChips: 550,
      facingBetChips: 0,
    })
    // 1.1× pot is not in the flop tree ([0.25, 0.5, 0.75]); requesting it should
    // surface a raise-to entry somewhere in the grid that the plain solve lacks.
    const base = await postflop.getStrategy(node)
    const withSize = await postflop.getStrategyWithSizes(node, [1.1])
    const sizes = (s: typeof base) =>
      new Set(
        Object.values(s.grid)
          .flat()
          .filter((a) => a.actionId.startsWith('raiseTo:'))
          .map((a) => a.actionId),
      )
    const extra = [...sizes(withSize)].filter((id) => !sizes(base).has(id))
    expect(extra.length).toBeGreaterThan(0)
  })

  it('empty extra fractions falls back to the cached plain solve', async () => {
    const transport = new BaselineSolverTransport({ iterations: 50 })
    const postflop = new PostflopSolverProvider(transport, preflop)
    const { node } = buildPostflopLineNode({
      street: 'flop',
      hero: 'BTN',
      villain: 'BB',
      potType: 'srp',
      aggressor: 'hero',
      board: board('Ah Kd 7c'),
      potBeforeChips: 550,
      facingBetChips: 0,
    })
    expect(await postflop.getStrategyWithSizes(node, [])).toBe(await postflop.getStrategy(node))
  })
})
