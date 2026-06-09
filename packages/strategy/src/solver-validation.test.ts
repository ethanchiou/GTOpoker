import type { Position } from '@gto/domain-config'
import { makeCard, type Card } from '@gto/hand-eval'
import type { ActionRecord, GameNodeKey } from '@gto/poker-engine'
import { describe, expect, it } from 'vitest'
import { handClass } from './hand-class'
import { PostflopSolverProvider } from './postflop-provider'
import type { Range, SolveRequest, SolveResult, SolverTransport } from './postflop-types'
import { buildPreflopRange, villainContinuingRange } from './range-handoff'
import type { ActionFrequency, NodeStrategy, StrategyProvider } from './types'

/**
 * Task 5 — solver correctness validation (spec §15 Phase 2), the pure-TS half:
 * the preflop→flop range handoff and the solve cache. These run in the standard
 * `pnpm run check` gate. The WASM half (our glue vs the crate-native reference,
 * and baseline-vs-exact drift) lives in `solver-wasm.test.ts` and runs only when
 * the `pkg-node` build is present (the new CI WASM job).
 *
 * `postflop.test.ts` already covers single-action handoff (opener/caller/board
 * removal) and what the provider passes to the transport; this file fills the
 * gaps that bear directly on correctness: the multi-action weight product, exact
 * combo enumeration, `villainContinuingRange`, and cache identity.
 */

// ---------------------------------------------------------------------------
// A configurable fake chart provider: returns a fixed strategy per preflop node,
// chosen by a predicate, so handoff math can be asserted against exact products
// rather than chart data.
// ---------------------------------------------------------------------------
interface FakeSpot {
  /** Matches the node this strategy answers (by hero + how many records precede it). */
  match: (node: GameNodeKey) => boolean
  /** class → action mix at that node. Classes absent here pure-fold by default. */
  grid: Record<string, ActionFrequency[]>
}

function fakeProvider(spots: FakeSpot[]): StrategyProvider {
  const find = (node: GameNodeKey) => spots.find((s) => s.match(node))
  return {
    supports: (node) => find(node) !== undefined,
    async getStrategy(node) {
      const spot = find(node)
      if (!spot) throw new Error('fake provider: unsupported node')
      const actions = new Set<string>()
      for (const row of Object.values(spot.grid)) for (const a of row) actions.add(a.actionId)
      return {
        spotId: 'fake',
        actions: [...actions],
        grid: spot.grid,
        meta: { source: 'chart', confidence: 'low', rakeAssumption: '', version: 'fake' },
      } satisfies NodeStrategy
    },
  }
}

const rec = (
  position: Position,
  seatIndex: number,
  action: ActionRecord['action'],
  street: ActionRecord['street'] = 'preflop',
): ActionRecord => ({ position, seatIndex, street, action })

/** Count concrete combos per hand class in a range. */
function comboCountByClass(range: Range): Map<string, number> {
  const out = new Map<string, number>()
  for (const { hand } of range) {
    const cls = handClass(hand[0], hand[1])
    out.set(cls, (out.get(cls) ?? 0) + 1)
  }
  return out
}

describe('range handoff — exact combo enumeration', () => {
  // A provider that opens exactly AA / AKs / AKo at 100% via a 2.5bb raise.
  const opener = fakeProvider([
    {
      match: (n) => n.heroPosition === 'BTN' && n.street === 'preflop',
      grid: {
        AA: [{ actionId: 'raiseTo:2.5', frequency: 1 }],
        AKs: [{ actionId: 'raiseTo:2.5', frequency: 1 }],
        AKo: [{ actionId: 'raiseTo:2.5', frequency: 1 }],
      },
    },
  ])
  const history: ActionRecord[] = [rec('BTN', 0, { type: 'raise', amount: 250 })]

  it('emits 6 pair / 4 suited / 12 offsuit combos with no dead cards', async () => {
    const range = await buildPreflopRange('BTN', history, opener, [], 100)
    const counts = comboCountByClass(range)
    expect(counts.get('AA')).toBe(6)
    expect(counts.get('AKs')).toBe(4)
    expect(counts.get('AKo')).toBe(12)
    expect(range).toHaveLength(6 + 4 + 12)
  })

  it('removes every combo colliding with a board card', async () => {
    const board: Card[] = [makeCard(12, 3)] // As
    const range = await buildPreflopRange('BTN', history, opener, board, 100)
    const counts = comboCountByClass(range)
    // Dropping the As removes 3 AA combos (AcAs/AdAs/AhAs), the AsKs suited combo,
    // and 3 AKo combos (AsKc/AsKd/AsKh).
    expect(counts.get('AA')).toBe(3)
    expect(counts.get('AKs')).toBe(3)
    expect(counts.get('AKo')).toBe(9)
    for (const { hand } of range) expect(hand.includes(makeCard(12, 3))).toBe(false)
  })
})

describe('range handoff — multi-action weight product', () => {
  it('multiplies the chart frequency of every action along the hero line', async () => {
    // BTN opens, BB 3-bets, BTN calls the 3-bet. BTN's flop weight for a class is
    // its open frequency × its call-vs-3bet frequency.
    const history: ActionRecord[] = [
      rec('BTN', 0, { type: 'raise', amount: 250 }), // index 0: BTN's open node sees []
      rec('BB', 2, { type: 'raise', amount: 1100 }), // BB 3-bets to 11bb
      rec('BTN', 0, { type: 'call', amount: 1100 }), // index 2: BTN's call node sees [open, 3bet]
    ]
    const provider = fakeProvider([
      {
        match: (n) => n.heroPosition === 'BTN' && n.history.length === 0, // the open node
        grid: { AKs: [{ actionId: 'raiseTo:2.5', frequency: 0.6 }] },
      },
      {
        match: (n) => n.heroPosition === 'BTN' && n.history.length === 2, // facing the 3-bet
        grid: { AKs: [{ actionId: 'call', frequency: 0.5 }] },
      },
    ])

    const range = await buildPreflopRange('BTN', history, provider, [], 100)
    const aks = range.find((c) => handClass(c.hand[0], c.hand[1]) === 'AKs')
    expect(aks).toBeDefined()
    expect(aks!.weight).toBeCloseTo(0.6 * 0.5, 9)
  })

  it('snaps a recorded raise to the nearest charted size before reading its frequency', async () => {
    // A recorded raise to 2.7bb must read the charted raiseTo:2.5 frequency
    // (nearest), not raiseTo:5.
    const history: ActionRecord[] = [rec('BTN', 0, { type: 'raise', amount: 270 })]
    const provider = fakeProvider([
      {
        match: (n) => n.heroPosition === 'BTN' && n.street === 'preflop',
        grid: {
          AKs: [
            { actionId: 'raiseTo:2.5', frequency: 0.4 },
            { actionId: 'raiseTo:5', frequency: 0.1 },
          ],
        },
      },
    ])
    const range = await buildPreflopRange('BTN', history, provider, [], 100)
    const aks = range.find((c) => handClass(c.hand[0], c.hand[1]) === 'AKs')
    expect(aks!.weight).toBeCloseTo(0.4, 9)
  })

  it('maps a shove-sized raise to all-in when the chart models a shove', async () => {
    const history: ActionRecord[] = [rec('BTN', 0, { type: 'raise', amount: 10_000 })] // 100bb jam
    const provider = fakeProvider([
      {
        match: (n) => n.heroPosition === 'BTN' && n.street === 'preflop',
        grid: {
          AA: [
            { actionId: 'raiseTo:2.5', frequency: 0.2 },
            { actionId: 'allIn', frequency: 0.8 },
          ],
        },
      },
    ])
    const range = await buildPreflopRange('BTN', history, provider, [], 100)
    const aa = range.find((c) => handClass(c.hand[0], c.hand[1]) === 'AA')
    expect(aa!.weight).toBeCloseTo(0.8, 9)
  })
})

describe('villainContinuingRange', () => {
  const provider = fakeProvider([
    {
      match: (n) => n.heroPosition === 'BTN' && n.street === 'preflop',
      grid: { AKs: [{ actionId: 'raiseTo:2.5', frequency: 1 }] },
    },
  ])

  it('returns no villain for an opening (RFI) spot', async () => {
    const node: GameNodeKey = {
      street: 'preflop',
      heroPosition: 'BTN',
      board: [],
      history: [rec('CO', 5, { type: 'fold' })],
      bigBlindChips: 100,
    }
    const { villain, range } = await villainContinuingRange(node, provider)
    expect(villain).toBeNull()
    expect(range).toHaveLength(0)
  })

  it('returns the last raiser the hero faces preflop', async () => {
    const node: GameNodeKey = {
      street: 'preflop',
      heroPosition: 'BB',
      board: [],
      history: [rec('BTN', 0, { type: 'raise', amount: 250 })],
      bigBlindChips: 100,
    }
    const { villain, range } = await villainContinuingRange(node, provider)
    expect(villain).toBe('BTN')
    expect(range.length).toBeGreaterThan(0) // BTN's opening range
  })

  it('returns no villain when the hero is the last raiser', async () => {
    const node: GameNodeKey = {
      street: 'preflop',
      heroPosition: 'BTN',
      board: [],
      history: [rec('BTN', 0, { type: 'raise', amount: 250 })],
      bigBlindChips: 100,
    }
    const { villain } = await villainContinuingRange(node, provider)
    expect(villain).toBeNull()
  })

  it('returns the lone other in-hand player postflop, none when multiway', async () => {
    const headsUp: GameNodeKey = {
      street: 'flop',
      heroPosition: 'BB',
      board: [makeCard(12, 3), makeCard(11, 2), makeCard(7, 1)],
      history: [
        rec('CO', 5, { type: 'fold' }),
        rec('BTN', 0, { type: 'raise', amount: 250 }),
        rec('BB', 2, { type: 'call', amount: 250 }),
      ],
      bigBlindChips: 100,
    }
    expect((await villainContinuingRange(headsUp, provider)).villain).toBe('BTN')

    const multiway: GameNodeKey = {
      ...headsUp,
      history: [
        rec('CO', 5, { type: 'raise', amount: 250 }),
        rec('BTN', 0, { type: 'call', amount: 250 }),
        rec('BB', 2, { type: 'call', amount: 250 }),
      ],
    }
    expect((await villainContinuingRange(multiway, provider)).villain).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Solve cache correctness (spec §15: "cache correctness").
// ---------------------------------------------------------------------------
describe('PostflopSolverProvider solve cache', () => {
  /** Counts solves and returns a trivial pure-fold strategy per combo. */
  class CountingTransport implements SolverTransport {
    solves = 0
    async solve(req: SolveRequest): Promise<SolveResult> {
      this.solves++
      return {
        hero: req.heroRange.map(({ hand }) => ({ hand, actions: [{ actionId: 'fold', frequency: 1, ev: 0 }] })),
        meta: { confidence: 'low', approximate: true, label: 'count' },
      }
    }
  }

  const preflop = fakeProvider([
    { match: (n) => n.street === 'preflop', grid: { AA: [{ actionId: 'raiseTo:2.5', frequency: 1 }] } },
  ])

  const baseNode = (): GameNodeKey => ({
    street: 'flop',
    heroPosition: 'BB',
    board: [makeCard(12, 3), makeCard(11, 2), makeCard(7, 1)], // As Kh 7d
    history: [
      rec('CO', 5, { type: 'fold' }),
      rec('BTN', 0, { type: 'raise', amount: 250 }),
      rec('BB', 2, { type: 'call', amount: 250 }),
    ],
    potChips: 600,
    effectiveStackChips: 9_750,
    toCallChips: 0,
    bigBlindChips: 100,
  })

  it('solves once per identical node and reuses the cached promise', async () => {
    const transport = new CountingTransport()
    const provider = new PostflopSolverProvider(transport, preflop)
    const node = baseNode()
    const a = await provider.getStrategy(node)
    const b = await provider.getStrategy(baseNode()) // structurally identical
    expect(transport.solves).toBe(1)
    expect(b).toEqual(a)
  })

  it('keys the cache on chip context — a different pot re-solves', async () => {
    const transport = new CountingTransport()
    const provider = new PostflopSolverProvider(transport, preflop)
    await provider.getStrategy(baseNode())
    await provider.getStrategy({ ...baseNode(), potChips: 800 }) // only the pot differs
    expect(transport.solves).toBe(2)
  })

  it('keys the cache on toCall and effective stack', async () => {
    const transport = new CountingTransport()
    const provider = new PostflopSolverProvider(transport, preflop)
    await provider.getStrategy(baseNode())
    await provider.getStrategy({ ...baseNode(), toCallChips: 300 })
    await provider.getStrategy({ ...baseNode(), effectiveStackChips: 5_000 })
    expect(transport.solves).toBe(3)
  })

  it('caches extra-size solves separately and re-solves after a clear', async () => {
    const transport = new CountingTransport()
    const provider = new PostflopSolverProvider(transport, preflop)
    const node = baseNode()

    await provider.getStrategy(node) // 1: plain solve
    await provider.getStrategyWithSizes(node, [0.62]) // 2: distinct extra-size key
    await provider.getStrategyWithSizes(node, [0.62]) // cached → no new solve
    expect(transport.solves).toBe(2)

    // Empty extras delegate to the plain (already cached) solve.
    await provider.getStrategyWithSizes(node, [])
    expect(transport.solves).toBe(2)

    provider.clearCache()
    await provider.getStrategy(node) // 3: cache cleared → re-solve
    expect(transport.solves).toBe(3)
  })
})
