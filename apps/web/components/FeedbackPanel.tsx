import type { DecisionScore } from '@gto/scoring'
import { actionColor, actionLabel, classificationStyle } from '../lib/format'

export function FeedbackPanel({ score }: { score: DecisionScore | null }) {
  if (!score) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        Make a decision to see GTO feedback. The grid above shows the optimal strategy for your spot.
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

      <div className="mt-3 space-y-1.5">
        {score.strategyRow.map((a) => (
          <div key={a.actionId} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-slate-300">{actionLabel(a.actionId)}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full"
                style={{ width: `${(a.frequency * 100).toFixed(1)}%`, background: actionColor(a.actionId) }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-slate-300">
              {(a.frequency * 100).toFixed(0)}%
            </span>
          </div>
        ))}
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
