import { DEFAULT_SCORING_THRESHOLDS, type ScoringThresholds } from '@gto/domain-config'
import type { Action, DecisionPoint } from '@gto/poker-engine'
import {
  handClass,
  strategyForHand,
  type ActionFrequency,
  type ActionId,
  type NodeStrategy,
  type StrategyMeta,
} from '@gto/strategy'

export type Classification = 'best' | 'correct' | 'inaccuracy' | 'wrong' | 'blunder'

export interface RaiseSizeTarget {
  actionId: ActionId
  targetBb: number
  minBb: number
  maxBb: number
}

export interface DecisionScore {
  chosenActionId: ActionId
  bestActionId: ActionId
  classification: Classification
  /** EV loss in big blinds (real when the backend has EV; otherwise estimated). */
  evLossBb: number
  /** Per-decision partial credit = frequency of the chosen action in the GTO mix (spec §7.3). */
  frequencyCredit: number
  /** Whether the EV loss is an estimate (chart-only data, spec §7.2) rather than solver-derived. */
  estimated: boolean
  confidence: StrategyMeta['confidence']
  /** True when the chosen bet/raise size was snapped to a different tree size for grading. */
  sizeSnapped: boolean
  /** Acceptable bet/raise size band for the nearest charted raise action. */
  raiseSizeTarget: RaiseSizeTarget | null
  /** The full GTO mix for the acting hand (for the feedback panel). */
  strategyRow: ActionFrequency[]
}

function isRaiseId(id: ActionId): boolean {
  return id.startsWith('raiseTo:')
}

function raiseToBb(id: ActionId): number {
  return Number(id.slice('raiseTo:'.length))
}

function actionIdForRaiseTo(bb: number): ActionId {
  return `raiseTo:${Number(bb.toFixed(2))}`
}

function legalSizeFor(action: Action, dp: DecisionPoint): { min?: number; max?: number } | null {
  if (action.type !== 'bet' && action.type !== 'raise') return null
  return dp.legalActions.find((l) => l.type === action.type) ?? null
}

function raiseSizeTarget(actionId: ActionId): RaiseSizeTarget {
  const targetBb = raiseToBb(actionId)
  const toleranceBb = Math.max(0.5, targetBb * 0.1)
  return {
    actionId,
    targetBb,
    minBb: Number(Math.max(0, targetBb - toleranceBb).toFixed(2)),
    maxBb: Number((targetBb + toleranceBb).toFixed(2)),
  }
}

/** Map the user's engine Action to an actionId in the mix, snapping only inside an acceptable size band. */
function mapChosen(
  action: Action,
  row: ActionFrequency[],
  dp: DecisionPoint,
): { id: ActionId; snapped: boolean; raiseSizeTarget: RaiseSizeTarget | null } {
  if (action.type === 'fold') return { id: 'fold', snapped: false, raiseSizeTarget: null }
  if (action.type === 'check') return { id: 'check', snapped: false, raiseSizeTarget: null }
  if (action.type === 'call') return { id: 'call', snapped: false, raiseSizeTarget: null }

  const legalSize = legalSizeFor(action, dp)
  const isAllIn = legalSize?.max !== undefined && Math.abs((action.amount ?? 0) - legalSize.max) <= 1
  if (isAllIn && row.some((r) => r.actionId === 'allIn')) {
    return { id: 'allIn', snapped: false, raiseSizeTarget: null }
  }

  const targetBb = (action.amount ?? 0) / dp.bigBlindChips
  const raiseIds = row.map((r) => r.actionId).filter(isRaiseId)
  if (raiseIds.length === 0) {
    // The mix has no raise here; represent the chosen size as its own (freq-0) id.
    return { id: actionIdForRaiseTo(targetBb), snapped: false, raiseSizeTarget: null }
  }
  let bestId = raiseIds[0]!
  let bestDiff = Infinity
  for (const id of raiseIds) {
    const diff = Math.abs(raiseToBb(id) - targetBb)
    if (diff < bestDiff) {
      bestDiff = diff
      bestId = id
    }
  }
  const target = raiseSizeTarget(bestId)
  const inTargetBand = targetBb >= target.minBb && targetBb <= target.maxBb
  return {
    id: inTargetBand ? bestId : actionIdForRaiseTo(targetBb),
    snapped: inTargetBand && Math.abs(raiseToBb(bestId) - targetBb) > 0.01,
    raiseSizeTarget: target,
  }
}

function freqOf(row: ActionFrequency[], id: ActionId): number {
  return row.find((a) => a.actionId === id)?.frequency ?? 0
}

function evOf(row: ActionFrequency[], id: ActionId): number | undefined {
  return row.find((a) => a.actionId === id)?.ev
}

/** Highest-EV action if EV is available, else the highest-frequency (modal) action. */
function bestAction(row: ActionFrequency[], hasEv: boolean): ActionId {
  let best = row[0]!
  for (const a of row) {
    if (hasEv) {
      if ((a.ev ?? -Infinity) > (best.ev ?? -Infinity)) best = a
    } else if (a.frequency > best.frequency) best = a
  }
  return best.actionId
}

function classifyByEvLoss(evLossBb: number, t: ScoringThresholds): Classification {
  if (evLossBb <= t.correctBb) return 'correct'
  if (evLossBb <= t.inaccuracyBb) return 'inaccuracy'
  if (evLossBb <= t.wrongBb) return 'wrong'
  return 'blunder'
}

/**
 * Estimated EV loss for a pure mistake (chosen frequency 0) when no per-action EV
 * is available (chart-only data). This is intentionally rough and flagged
 * low-confidence — see spec §7.2. It scales with pot size, and folding a hand the
 * GTO mix essentially always continues with is treated as more costly.
 */
function estimateEvLoss(chosenId: ActionId, bestId: ActionId, row: ActionFrequency[], dp: DecisionPoint): number {
  const potBb = dp.potChips / dp.bigBlindChips
  if (isRaiseId(chosenId) && isRaiseId(bestId)) {
    const sizeMissBb = Math.abs(raiseToBb(chosenId) - raiseToBb(bestId))
    return Math.min(0.1 + 0.12 * sizeMissBb + 0.03 * potBb, 3)
  }
  const modalFreq = Math.max(...row.map((a) => a.frequency))
  if (chosenId === 'fold') {
    // Folding something the GTO strategy keeps: forfeited EV scales with how
    // dominant the continue is and how big the pot is.
    return Math.min(0.5 + 0.3 * potBb * modalFreq, 8)
  }
  // Putting chips in when the correct play is (mostly) to fold/decline.
  const overcommitBb = dp.toCallChips / dp.bigBlindChips
  return Math.min(0.5 + 0.2 * potBb + 0.3 * overcommitBb, 8)
}

export interface ScoreParams {
  chosen: Action
  decisionPoint: DecisionPoint
  /** The acting hand's GTO mix (e.g. via strategyForHand). */
  strategyRow: ActionFrequency[]
  meta: StrategyMeta
  thresholds?: ScoringThresholds
}

export function scoreDecision(params: ScoreParams): DecisionScore {
  const { chosen, decisionPoint: dp, strategyRow: row, meta } = params
  const thresholds = params.thresholds ?? DEFAULT_SCORING_THRESHOLDS
  const hasEv = row.some((a) => a.ev !== undefined)

  const { id: chosenActionId, snapped, raiseSizeTarget } = mapChosen(chosen, row, dp)
  const bestActionId = bestAction(row, hasEv)
  const chosenFreq = freqOf(row, chosenActionId)

  let evLossBb: number
  let classification: Classification
  let estimated: boolean
  let confidence = meta.confidence

  if (hasEv) {
    // Real EV loss against the best action.
    const bestEv = evOf(row, bestActionId) ?? 0
    const chosenEv = evOf(row, chosenActionId) ?? bestEv - estimateEvLoss(chosenActionId, bestActionId, row, dp)
    evLossBb = Math.max(0, bestEv - chosenEv)
    estimated = evOf(row, chosenActionId) === undefined
    classification =
      chosenActionId === bestActionId ? 'best' : evLossBb <= thresholds.correctBb ? 'correct' : classifyByEvLoss(evLossBb, thresholds)
  } else if (chosenFreq > 0) {
    // In the GTO mix → at worst "Correct" (mixed actions are ~EV-equal at equilibrium, spec §7.2).
    evLossBb = 0
    estimated = false
    classification = chosenActionId === bestActionId ? 'best' : 'correct'
  } else {
    // Pure mistake with no EV available → estimate, flagged low-confidence.
    evLossBb = estimateEvLoss(chosenActionId, bestActionId, row, dp)
    estimated = true
    confidence = 'low'
    classification = classifyByEvLoss(evLossBb, thresholds)
    if (classification === 'correct') classification = 'inaccuracy' // freq 0 is never "correct"
  }

  return {
    chosenActionId,
    bestActionId,
    classification,
    evLossBb,
    frequencyCredit: chosenFreq,
    estimated,
    confidence,
    sizeSnapped: snapped,
    raiseSizeTarget,
    strategyRow: row,
  }
}

/** Convenience: score directly from a NodeStrategy using the actor's hole cards. */
export function scoreFromStrategy(
  chosen: Action,
  decisionPoint: DecisionPoint,
  strategy: NodeStrategy,
  thresholds?: ScoringThresholds,
): DecisionScore {
  const row = strategyForHand(strategy, handClass(decisionPoint.heroHoleCards[0], decisionPoint.heroHoleCards[1]))
  return scoreDecision({ chosen, decisionPoint, strategyRow: row, meta: strategy.meta, thresholds })
}
