import type { ActionFrequency } from '@gto/strategy'
import { actionColor, actionLabel } from '../lib/format'

export function StrategyMix({
  row,
  title = 'Hand mix',
  framed = true,
}: {
  row: ActionFrequency[]
  title?: string
  framed?: boolean
}) {
  return (
    <div className={framed ? 'rounded border border-slate-800 bg-slate-900/50 p-3' : ''}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <div className="space-y-1.5">
        {row.map((a) => (
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
            {a.ev !== undefined && (
              <span className="w-16 shrink-0 text-right font-mono text-slate-400">
                {a.ev >= 0 ? '+' : ''}
                {a.ev.toFixed(2)}bb
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
