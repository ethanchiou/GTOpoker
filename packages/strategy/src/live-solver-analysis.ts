import { DEFAULT_BET_SIZE_TREE } from '@gto/domain-config'
import type { PostflopStreet } from './live-node'
import type { ActionFrequency } from './types'

export interface PostflopSizePreset {
  key: string
  /** Null for the all-in shortcut; otherwise the pot fraction represented by the button. */
  fraction: number | null
  chips: number
  allIn: boolean
}

export interface PostflopSizePresetOptions {
  street: PostflopStreet
  facing: boolean
  potChips: number
  toCallChips: number
  heroCommittedChips: number
  villainCommittedChips: number
  min: number
  max: number
  chipIncrement?: number
  includeAllIn?: boolean
}

export interface StrategyRowAnalysis {
  bestAction: ActionFrequency
  bestAggressive: ActionFrequency | null
  previewDeltaVsBest: number | null
}

export function postflopSizePresets(opts: PostflopSizePresetOptions): PostflopSizePreset[] {
  const increment = opts.chipIncrement ?? 25
  if (opts.max <= opts.min || opts.potChips <= 0 || increment <= 0) return []

  const fractions = DEFAULT_BET_SIZE_TREE.postflopBetFractionsByStreet[opts.street]
  const seen = new Set<string>()
  const presets: PostflopSizePreset[] = []

  for (const fraction of fractions) {
    const rawChips = opts.facing
      ? opts.villainCommittedChips + fraction * (opts.potChips + opts.toCallChips)
      : opts.heroCommittedChips + fraction * opts.potChips
    const chips = clamp(roundTo(rawChips, increment), opts.min, opts.max)
    const key = chipKey(chips)
    if (seen.has(key)) continue
    seen.add(key)
    presets.push({ key: `${opts.street}-${fraction}`, fraction, chips, allIn: false })
  }

  if (opts.includeAllIn ?? true) {
    const key = chipKey(opts.max)
    if (!seen.has(key)) presets.push({ key: 'all-in', fraction: null, chips: opts.max, allIn: true })
  }
  return presets
}

export function analyzeActionRow(
  row: readonly ActionFrequency[],
  preview: ActionFrequency | null,
): StrategyRowAnalysis | null {
  const bestAction = bestActionByEv(row)
  if (!bestAction) return null
  const bestAggressive = bestActionByEv(row.filter((a) => isAggressiveActionId(a.actionId)))
  const previewDeltaVsBest =
    preview?.ev !== undefined && bestAction.ev !== undefined ? normalizeDelta(preview.ev - bestAction.ev) : null
  return { bestAction, bestAggressive, previewDeltaVsBest }
}

export function bestActionByEv(row: readonly ActionFrequency[]): ActionFrequency | null {
  let best: ActionFrequency | null = null
  for (const action of row) {
    if (!best || compareActionQuality(action, best) > 0) best = action
  }
  return best
}

export function isAggressiveActionId(actionId: string): boolean {
  return actionId === 'allIn' || raiseToBb(actionId) !== null
}

export function raiseToBb(actionId: string): number | null {
  const m = /^raiseTo:([\d.]+)$/.exec(actionId)
  return m ? Number(m[1]) : null
}

function compareActionQuality(a: ActionFrequency, b: ActionFrequency): number {
  if (a.ev !== undefined && b.ev !== undefined && a.ev !== b.ev) return a.ev - b.ev
  if (a.ev !== undefined && b.ev === undefined) return 1
  if (a.ev === undefined && b.ev !== undefined) return -1
  return a.frequency - b.frequency
}

function normalizeDelta(delta: number): number {
  const rounded = Number(delta.toFixed(2))
  return Math.abs(rounded) < 0.005 ? 0 : rounded
}

function roundTo(value: number, increment: number): number {
  return Math.round(value / increment) * increment
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function chipKey(chips: number): string {
  return chips.toFixed(4)
}
