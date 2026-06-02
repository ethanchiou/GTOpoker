import type { DecisionScore } from '@gto/scoring'
import { actionLabel, classificationStyle } from '../lib/format'
import { StrategyMix } from './StrategyMix'

function bbLabel(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

export function FeedbackPanel({
  score,
  uncharted = false,
}: {
  score: DecisionScore | null
  uncharted?: boolean
}) {
  if (!score) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        {uncharted
          ? 'This hand ended after an uncharted decision, so no GTO score was recorded. Review the hand result below.'
          : 'Make a decision to see GTO feedback and mixed-strategy frequencies.'}
      </div>
    )
  }

  const cls = classificationStyle(score.classification)
  const youPlayed = actionLabel(score.chosenActionId)
  const best = actionLabel(score.bestActionId)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <span
          className="rounded-md px-2.5 py-1 text-sm font-bold text-slate-950"
          style={{ background: cls.color }}
        >
          {cls.label}
        </span>
        <span className="text-sm text-slate-300">
          EV loss{' '}
          <span className="font-mono font-semibold text-slate-100">
            {score.evLossBb.toFixed(2)} bb
          </span>
          {score.estimated && <span className="ml-1 text-amber-400">(est.)</span>}
        </span>
      </div>

      <div className="mt-3 text-sm text-slate-300">
        You played <span className="font-semibold text-slate-100">{youPlayed}</span>
        {score.chosenActionId !== score.bestActionId && (
          <>
            {' '}· GTO favors <span className="font-semibold text-slate-100">{best}</span>
          </>
        )}
        {score.sizeSnapped && <span className="ml-1 text-slate-400">(graded as {youPlayed})</span>}
      </div>

      {score.raiseSizeTarget && (
        <p className="mt-2 text-xs text-slate-400">
          Target raise size {bbLabel(score.raiseSizeTarget.minBb)}-{bbLabel(score.raiseSizeTarget.maxBb)}bb
          {' '}({bbLabel(score.raiseSizeTarget.targetBb)}bb chart size).
        </p>
      )}

      <div className="mt-3">
        <StrategyMix row={score.strategyRow} title="GTO mix" framed={false} />
      </div>

      {score.estimated && (
        <p className="mt-3 text-xs text-slate-500">
          EV loss is estimated from chart frequencies (no per-action EV in the seed data); confidence:{' '}
          {score.confidence}. It becomes exact once the postflop solver / solved preflop data is wired in.
        </p>
      )}
    </div>
  )
}
