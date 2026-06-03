import { DEFAULT_BET_SIZE_TREE, type Position } from '@gto/domain-config'
import type { GameNodeKey } from '@gto/poker-engine'
import { handClass, type HandClass } from './hand-class'
import { buildPreflopRange, inHandPositions } from './range-handoff'
import type { ComboStrategy, Range, SolverTransport } from './postflop-types'
import type { ActionFrequency, ActionId, NodeStrategy, StrategyProvider } from './types'

/** The postflop streets the provider sizes for. */
type PostflopStreet = 'flop' | 'turn' | 'river'

export interface PostflopProviderOptions {
  /**
   * Postflop bet sizes as a fraction of the pot. A flat list applies to every
   * street; a per-street map lets sizing reflect street norms. Defaults to the
   * domain tree's per-street sizings.
   */
  betFractions?: readonly number[] | Record<PostflopStreet, readonly number[]>
}

/**
 * Serves postflop strategy for heads-up spots by building each player's flop
 * range from the preflop line (the §6.4 range handoff) and solving via the
 * injected `SolverTransport` (postflop-solver WASM, or the baseline stand-in).
 * Multiway and non-heads-up postflop spots are reported unsupported and flagged
 * to the user upstream (spec §1.3, §2.1).
 */
export class PostflopSolverProvider implements StrategyProvider {
  private readonly betFractionsByStreet: Record<PostflopStreet, readonly number[]>
  /** Solve cache keyed by canonical node (spec §6.4): pre-solve reuse + instant drills. */
  private readonly cache = new Map<string, Promise<NodeStrategy>>()

  constructor(
    private readonly transport: SolverTransport,
    /** The preflop provider used to derive flop ranges from the preflop path. */
    private readonly preflopProvider: StrategyProvider,
    opts: PostflopProviderOptions = {},
  ) {
    const opt = opts.betFractions
    if (opt === undefined) {
      this.betFractionsByStreet = DEFAULT_BET_SIZE_TREE.postflopBetFractionsByStreet
    } else if (Array.isArray(opt)) {
      this.betFractionsByStreet = { flop: opt, turn: opt, river: opt }
    } else {
      this.betFractionsByStreet = opt as Record<PostflopStreet, readonly number[]>
    }
  }

  private fractionsFor(street: string): readonly number[] {
    return this.betFractionsByStreet[street as PostflopStreet] ?? DEFAULT_BET_SIZE_TREE.postflopBetFractions
  }

  supports(node: GameNodeKey): boolean {
    if (node.street === 'preflop') return false
    if (node.board.length < 3) return false
    if (node.bigBlindChips === undefined || node.potChips === undefined) return false
    const inHand = inHandPositions(node.history)
    return inHand.length === 2 && inHand.includes(node.heroPosition)
  }

  async getStrategy(node: GameNodeKey): Promise<NodeStrategy> {
    if (!this.supports(node)) {
      throw new Error('PostflopSolverProvider does not support this node (heads-up postflop only)')
    }
    const key = solveKey(node)
    const cached = this.cache.get(key)
    if (cached) return cached
    const promise = this.solveNode(node)
    this.cache.set(key, promise)
    return promise
  }

  /**
   * Like {@link getStrategy} but also evaluates the given extra pot-fraction sizes
   * alongside the street's default tree — the Live Solver's "preview my bet" slider,
   * so the mix carries the exact size the user dials with its real frequency and EV.
   * Cached per (node, extra fractions); falls back to the plain solve when empty.
   */
  async getStrategyWithSizes(node: GameNodeKey, extraBetFractions: readonly number[]): Promise<NodeStrategy> {
    if (!this.supports(node)) {
      throw new Error('PostflopSolverProvider does not support this node (heads-up postflop only)')
    }
    const extras = mergeFractions([], extraBetFractions)
    if (extras.length === 0) return this.getStrategy(node)
    const key = `${solveKey(node)}|+${extras.join(',')}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const promise = this.solveNode(node, extras)
    this.cache.set(key, promise)
    return promise
  }

  private async solveNode(node: GameNodeKey, extraBetFractions: readonly number[] = []): Promise<NodeStrategy> {
    const bb = node.bigBlindChips!
    const heroPos = node.heroPosition
    const villainPos = inHandPositions(node.history).find((p) => p !== heroPos)!
    const board = node.board

    const [heroRange, villainRange] = await Promise.all([
      buildPreflopRange(heroPos, node.history, this.preflopProvider, board, bb),
      buildPreflopRange(villainPos, node.history, this.preflopProvider, board, bb),
    ])
    const sizingContext = currentStreetSizingContext(node, heroPos, villainPos)

    const result = await this.transport.solve({
      board,
      heroRange,
      villainRange,
      potChips: node.potChips!,
      effectiveStackChips: node.effectiveStackChips ?? 0,
      bigBlindChips: bb,
      toCallChips: node.toCallChips ?? 0,
      heroCommittedThisStreetChips: sizingContext.heroCommitted,
      villainCommittedThisStreetChips: sizingContext.villainCommitted,
      minRaiseToChips: sizingContext.minRaiseTo,
      betFractions: mergeFractions(this.fractionsFor(node.street), extraBetFractions),
      heroIsOop: isOutOfPosition(heroPos, villainPos),
    })

    const grid = aggregateToGrid(result.hero, heroRange)
    return {
      spotId: `postflop/${node.street}/${heroPos}v${villainPos}`,
      actions: actionOrder(grid),
      grid,
      meta: {
        source: 'solver',
        confidence: result.meta.confidence,
        rakeAssumption: `solve (${result.meta.label})`,
        version: result.meta.label,
      },
    }
  }
}

/** Union of two pot-fraction lists, positive-only, deduped (4dp) and ascending. */
function mergeFractions(base: readonly number[], extra: readonly number[]): number[] {
  const set = new Set<number>()
  for (const f of base) if (f > 0) set.add(Number(f.toFixed(4)))
  for (const f of extra) if (f > 0) set.add(Number(f.toFixed(4)))
  return [...set].sort((a, b) => a - b)
}

/** Canonical solve-cache key: board + action path + chip context (spec §6.4). */
function solveKey(node: GameNodeKey): string {
  const hist = node.history.map((r) => `${r.position}:${r.action.type}:${r.action.amount ?? ''}`).join('>')
  return `${node.street}|${node.heroPosition}|${node.board.join(',')}|${hist}|${node.potChips}|${node.toCallChips}|${node.effectiveStackChips}`
}

function currentStreetSizingContext(
  node: GameNodeKey,
  hero: Position,
  villain: Position,
): { heroCommitted: number; villainCommitted: number; minRaiseTo: number } {
  const committed = new Map<Position, number>()
  let betToMatch = 0
  let lastFullRaiseIncrement = node.bigBlindChips ?? 100

  for (const rec of node.history) {
    if (rec.street !== node.street) continue
    const amount = rec.action.amount
    if (amount === undefined) continue

    if (rec.action.type === 'bet') {
      committed.set(rec.position, amount)
      betToMatch = amount
      lastFullRaiseIncrement = amount
    } else if (rec.action.type === 'raise') {
      committed.set(rec.position, amount)
      const increment = amount - betToMatch
      betToMatch = amount
      if (increment >= lastFullRaiseIncrement) lastFullRaiseIncrement = increment
    } else if (rec.action.type === 'call') {
      committed.set(rec.position, amount)
    }
  }

  const heroCommitted = committed.get(hero) ?? 0
  const villainCommitted = committed.get(villain) ?? 0
  const minRaiseTo =
    betToMatch > heroCommitted
      ? betToMatch + lastFullRaiseIncrement
      : heroCommitted + (node.bigBlindChips ?? 100)

  return { heroCommitted, villainCommitted, minRaiseTo }
}

/** Aggregate per-combo strategy into a per-hand-class grid (weighted by range mass). */
function aggregateToGrid(hero: ComboStrategy[], range: Range): Record<HandClass, ActionFrequency[]> {
  const weightOf = new Map<string, number>()
  for (const { hand, weight } of range) weightOf.set(comboKey(hand[0], hand[1]), weight)

  // class → actionId → { freqMass, evMass }
  const acc = new Map<HandClass, Map<ActionId, { freqMass: number; evMass: number }>>()
  const classWeight = new Map<HandClass, number>()

  for (const cs of hero) {
    const w = weightOf.get(comboKey(cs.hand[0], cs.hand[1])) ?? 0
    if (w <= 0) continue
    const cls = handClass(cs.hand[0], cs.hand[1])
    classWeight.set(cls, (classWeight.get(cls) ?? 0) + w)
    const byAction = acc.get(cls) ?? new Map()
    for (const a of cs.actions) {
      const cur = byAction.get(a.actionId) ?? { freqMass: 0, evMass: 0 }
      cur.freqMass += w * a.frequency
      cur.evMass += w * a.frequency * (a.ev ?? 0)
      byAction.set(a.actionId, cur)
    }
    acc.set(cls, byAction)
  }

  const grid: Record<HandClass, ActionFrequency[]> = {}
  for (const [cls, byAction] of acc) {
    const w = classWeight.get(cls) ?? 1
    const row: ActionFrequency[] = []
    for (const [actionId, { freqMass, evMass }] of byAction) {
      const frequency = freqMass / w
      const ev = freqMass > 0 ? evMass / freqMass : 0
      row.push({ actionId, frequency: Number(frequency.toFixed(4)), ev: Number(ev.toFixed(2)) })
    }
    grid[cls] = row
  }
  return grid
}

function comboKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

/** Postflop action order, earliest (most out-of-position) first. */
const POSTFLOP_ORDER: readonly Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']

/** Whether `hero` acts before `villain` postflop (is out of position). */
function isOutOfPosition(hero: Position, villain: Position): boolean {
  return POSTFLOP_ORDER.indexOf(hero) < POSTFLOP_ORDER.indexOf(villain)
}

const ACTION_RANK: Record<string, number> = { fold: 0, check: 1, call: 2 }

/** Stable display order for the legend: fold, check, call, raises (ascending), all-in. */
function actionOrder(grid: Record<HandClass, ActionFrequency[]>): ActionId[] {
  const ids = new Set<ActionId>()
  for (const row of Object.values(grid)) for (const a of row) ids.add(a.actionId)
  return [...ids].sort((x, y) => rankAction(x) - rankAction(y))
}

function rankAction(id: ActionId): number {
  if (id in ACTION_RANK) return ACTION_RANK[id]!
  if (id === 'allIn') return 1000
  if (id.startsWith('raiseTo:')) return 10 + Number(id.slice('raiseTo:'.length))
  return 500
}
