import type { Position } from '@gto/domain-config'
import type { Street } from '@gto/poker-engine'
import type { Classification, DecisionScore } from './score'

/**
 * Rolling accuracy/EV-loss aggregates (spec §7.5). Buckets accumulate by street
 * and position so leaks surface over time. A decision counts as "correct" when
 * it is Best or Correct; mistakes are Wrong or Blunder (Inaccuracy is neither).
 */
export interface Bucket {
  decisions: number
  correct: number
  mistakes: number
  evLossBb: number
}

export interface SessionStats {
  hands: number
  overall: Bucket
  byStreet: Partial<Record<Street, Bucket>>
  byPosition: Partial<Record<Position, Bucket>>
  byClassification: Record<Classification, number>
}

const CLASSIFICATIONS: Classification[] = ['best', 'correct', 'inaccuracy', 'wrong', 'blunder']

function emptyBucket(): Bucket {
  return { decisions: 0, correct: 0, mistakes: 0, evLossBb: 0 }
}

export function createSessionStats(): SessionStats {
  return {
    hands: 0,
    overall: emptyBucket(),
    byStreet: {},
    byPosition: {},
    byClassification: Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>,
  }
}

function update(bucket: Bucket, score: DecisionScore): void {
  bucket.decisions++
  bucket.evLossBb += score.evLossBb
  if (score.classification === 'best' || score.classification === 'correct') bucket.correct++
  if (score.classification === 'wrong' || score.classification === 'blunder') bucket.mistakes++
}

export interface DecisionContext {
  street: Street
  position: Position
}

/** Fold a scored decision into the running stats (mutates and returns `stats`). */
export function recordDecision(stats: SessionStats, score: DecisionScore, ctx: DecisionContext): SessionStats {
  update(stats.overall, score)
  update((stats.byStreet[ctx.street] ??= emptyBucket()), score)
  update((stats.byPosition[ctx.position] ??= emptyBucket()), score)
  stats.byClassification[score.classification]++
  return stats
}

export function noteHandComplete(stats: SessionStats): SessionStats {
  stats.hands++
  return stats
}

/** Fraction of decisions that were Best or Correct, in [0, 1]. */
export function accuracy(bucket: Bucket): number {
  return bucket.decisions === 0 ? 0 : bucket.correct / bucket.decisions
}

export function avgEvLossPerHand(stats: SessionStats): number {
  return stats.hands === 0 ? 0 : stats.overall.evLossBb / stats.hands
}

/**
 * Win-rate-style EV-loss expressed in mbb/g (milli-big-blinds per game).
 * 1 mbb/g = 0.001 bb/hand, so this is the average bb lost per hand × 1000.
 */
export function evLossMbbPerGame(stats: SessionStats): number {
  return avgEvLossPerHand(stats) * 1000
}
