import { HAND_CLASS_GRID, type NodeStrategy } from '@gto/strategy'
import { actionColor, actionLabel } from '../lib/format'

/** Build a horizontal hard-stop gradient representing a cell's action mix. */
function cellBackground(strategy: NodeStrategy, handClass: string): string {
  const row = strategy.grid[handClass]
  if (!row || row.length === 0) return '#1e293b'
  const stops: string[] = []
  let acc = 0
  for (const a of row) {
    const start = acc * 100
    acc += a.frequency
    const end = acc * 100
    stops.push(`${actionColor(a.actionId)} ${start.toFixed(1)}% ${end.toFixed(1)}%`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function StrategyGrid({
  strategy,
  highlight,
}: {
  strategy: NodeStrategy
  highlight?: string
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-300">
        {strategy.actions.map((a) => (
          <span key={a} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: actionColor(a) }} />
            {actionLabel(a)}
          </span>
        ))}
      </div>
      <div className="grid aspect-square w-full grid-cols-13 gap-px overflow-hidden rounded border border-slate-700 bg-slate-700">
        {HAND_CLASS_GRID.flat().map((cls) => (
          <div
            key={cls}
            title={cls}
            className={`relative flex items-center justify-center text-[8px] font-medium text-white/90 ${
              cls === highlight ? 'z-10 outline outline-2 outline-amber-300' : ''
            }`}
            style={{ background: cellBackground(strategy, cls) }}
          >
            <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">{cls}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
