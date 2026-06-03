import { HAND_CLASS_GRID, type NodeStrategy } from '@gto/strategy'
import { useState } from 'react'
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

interface HoverState {
  cls: string
  x: number
  y: number
}

export function StrategyGrid({
  strategy,
  highlight,
}: {
  strategy: NodeStrategy
  highlight?: string
}) {
  const [hover, setHover] = useState<HoverState | null>(null)

  // The hovered cell's action mix, one row per action the node offers (0% if the
  // hand never takes it) so the tooltip always lists Fold/Call/Raise/All-in.
  const hoverMix = hover
    ? strategy.actions.map((actionId) => ({
        actionId,
        frequency: strategy.grid[hover.cls]?.find((a) => a.actionId === actionId)?.frequency ?? 0,
      }))
    : null

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
      <div
        className="grid aspect-square w-full grid-cols-13 gap-px overflow-hidden rounded border border-slate-700 bg-slate-700"
        onMouseLeave={() => setHover(null)}
      >
        {HAND_CLASS_GRID.flat().map((cls) => (
          <div
            key={cls}
            className={`relative flex cursor-default items-center justify-center text-[8px] font-medium text-white/90 ${
              cls === highlight ? 'z-10 outline outline-2 outline-amber-300' : ''
            }`}
            style={{ background: cellBackground(strategy, cls) }}
            onMouseEnter={(e) => setHover({ cls, x: e.clientX, y: e.clientY })}
          >
            <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">{cls}</span>
          </div>
        ))}
      </div>

      {hover && hoverMix && (
        <div
          className="pointer-events-none fixed z-50 w-44 rounded-md border border-slate-600 bg-slate-900/95 p-2 text-xs shadow-xl"
          style={{
            left: hover.x + 14,
            top: hover.y + 14,
            transform: `translate(${hover.x > window.innerWidth - 200 ? '-100%' : '0'}, ${
              hover.y > window.innerHeight - 160 ? '-100%' : '0'
            })`,
          }}
        >
          <div className="mb-1.5 font-semibold text-white">{hover.cls}</div>
          <div className="space-y-1">
            {hoverMix.map((a) => (
              <div key={a.actionId} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: actionColor(a.actionId) }}
                />
                <span className="flex-1 text-slate-300">{actionLabel(a.actionId)}</span>
                <span className="font-mono text-slate-100">{(a.frequency * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
