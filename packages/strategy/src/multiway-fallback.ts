import type { GameNodeKey } from '@gto/poker-engine'
import { ALL_HAND_CLASSES, type HandClass } from './hand-class'
import type { PreflopChartProvider } from './preflop-chart'
import type { ActionFrequency, ActionId, NodeStrategy, StrategyMeta, StrategyProvider } from './types'

/**
 * Derived, low-confidence strategy for *multiway* preflop spots — lines with a
 * cold-caller that the linear {@link classifyPreflop} deliberately skips
 * (squeezes, cold 4-bets, facing a squeeze). There is no solved multiway data, so
 * rather than silently fold (the old behavior) we approximate each spot by
 * transforming the nearest heads-up chart:
 *
 *   - squeeze (face an open + caller)      → the hero's vs-RFI range, as-is (3-bet
 *                                            the 3-bet hands, over-call the flats)
 *   - opener facing a squeeze              → the hero's vs-3bet range, as-is
 *   - cold 4-bet (third party vs open+3bet)→ the opener's vs-3bet *aggressive* part
 *                                            only (4-bet/jam the value, fold the rest;
 *                                            cold-calling a 3-bet is dropped)
 *
 * Every node is flagged `confidence: 'low'` so the trainer/Live Solver can label it
 * "approximate". Bots play it (no more multiway auto-folds) and the scorer grades
 * against it directionally. Deeper multiway trees (3+ raises) fall through to the
 * conservative check-or-fold fallback in `bot.ts`.
 */

type DeriveMode = 'aggressiveOnly' | 'asIs'

export interface MultiwayRef {
  /** Heads-up chart spot to derive from. */
  refSpotId: string
  mode: DeriveMode
  /** A human-readable id for the derived spot (shown in the UI / review). */
  displayId: string
}

/** Map a multiway preflop node onto a heads-up reference chart, or null if out of scope. */
export function classifyMultiway(node: GameNodeKey): MultiwayRef | null {
  if (node.street !== 'preflop') return null
  const hero = node.heroPosition
  const raises = node.history.filter((a) => a.action.type === 'raise')
  const hasCaller = node.history.some((a) => a.action.type === 'call')

  if (raises.length === 1) {
    if (!hasCaller) return null // heads-up vs-RFI — the linear classifier owns it
    const opener = raises[0]!.position
    if (opener === hero) return null
    // Squeeze / over-call: approximate by the hero's heads-up defense vs the opener.
    return { refSpotId: `vsRfi/${hero}/vs${opener}`, mode: 'asIs', displayId: `squeeze/${hero}/vs${opener}` }
  }

  if (raises.length === 2) {
    const opener = raises[0]!.position
    const threeBettor = raises[1]!.position
    if (hero === threeBettor) return null // 3-bettor waits for the 4-bet (linear vs4bet)
    if (hero === opener) {
      if (!hasCaller) return null // heads-up vs-3bet — the linear classifier owns it
      // Opener facing a squeeze: approximate by the heads-up opener-vs-3bet response.
      return { refSpotId: `vs3bet/${hero}/vs${threeBettor}`, mode: 'asIs', displayId: `vsSqueeze/${hero}/vs${threeBettor}` }
    }
    // Third party facing an open + 3-bet: a cold 4-bet — value 4-bet/jam only.
    return {
      refSpotId: `vs3bet/${opener}/vs${threeBettor}`,
      mode: 'aggressiveOnly',
      displayId: `coldFourBet/${hero}/vs${threeBettor}`,
    }
  }

  return null // 3+ raises in a multiway pot — out of the derived tree
}

/** Keep only aggressive (bet/raise/jam) actions; fold the passive remainder. */
function aggressiveOnly(row: ActionFrequency[]): ActionFrequency[] {
  const kept = row.filter((a) => a.actionId.startsWith('raiseTo:') || a.actionId === 'allIn')
  const sum = kept.reduce((s, a) => s + a.frequency, 0)
  const out = [...kept]
  if (1 - sum > 1e-6) out.push({ actionId: 'fold', frequency: 1 - sum })
  return out
}

function deriveGrid(
  base: Record<HandClass, ActionFrequency[]>,
  mode: DeriveMode,
): Record<HandClass, ActionFrequency[]> {
  if (mode === 'asIs') return base
  const grid: Record<HandClass, ActionFrequency[]> = {}
  for (const cls of ALL_HAND_CLASSES) grid[cls] = aggressiveOnly(base[cls] ?? [])
  return grid
}

function actionsFromGrid(grid: Record<HandClass, ActionFrequency[]>): ActionId[] {
  const seen = new Set<ActionId>()
  for (const row of Object.values(grid)) for (const a of row) seen.add(a.actionId)
  return [...seen]
}

/** Serves derived, low-confidence strategy for multiway preflop nodes (spec §6.1 fallback). */
export class MultiwayFallbackProvider implements StrategyProvider {
  private readonly meta: StrategyMeta

  constructor(
    private readonly charts: PreflopChartProvider,
    version = 'multiway-derived-v1',
  ) {
    this.meta = {
      source: 'chart',
      confidence: 'low',
      rakeAssumption: 'derived from heads-up charts — multiway approximation',
      version,
    }
  }

  supports(node: GameNodeKey): boolean {
    const ref = classifyMultiway(node)
    return ref !== null && this.charts.hasSpot(ref.refSpotId)
  }

  async getStrategy(node: GameNodeKey): Promise<NodeStrategy> {
    const ref = classifyMultiway(node)
    const base = ref && this.charts.strategyForSpot(ref.refSpotId)
    if (!ref || !base) throw new Error('MultiwayFallbackProvider does not support this node')
    const grid = deriveGrid(base.grid, ref.mode)
    return { spotId: ref.displayId, actions: actionsFromGrid(grid), grid, meta: this.meta }
  }
}
