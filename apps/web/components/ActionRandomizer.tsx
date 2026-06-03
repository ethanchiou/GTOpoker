import type { ActionFrequency } from '@gto/strategy'
import { useState } from 'react'
import { actionColor, actionLabel } from '../lib/format'

interface Roll {
  /** The rolled value in [0, 1), shown transparently. */
  x: number
  actionId: string
}

/** Pick the action whose cumulative frequency band contains `x`. */
function landOn(row: ActionFrequency[], x: number): string {
  let acc = 0
  for (const a of row) {
    acc += a.frequency
    if (x < acc) return a.actionId
  }
  return row[row.length - 1]!.actionId
}

/**
 * "Pick for us" — when the GTO mix is non-pure, sample one action weighted by its
 * frequency (the same weighted sampling bots use) and show *where the roll landed*
 * on the mix so the draw is transparent. Only acts when the user asks.
 */
export function ActionRandomizer({ row }: { row: ActionFrequency[] }) {
  const [roll, setRoll] = useState<Roll | null>(null)
  const sorted = [...row].sort((a, b) => b.frequency - a.frequency)
  const pure = sorted[0] && sorted[0].frequency > 0.999

  if (pure) {
    return (
      <div className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
        Pure strategy — always <span className="font-semibold text-slate-200">{actionLabel(sorted[0]!.actionId)}</span>.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pick for us</span>
        <button
          className="rounded bg-amber-400 px-3 py-1 text-xs font-bold text-slate-950 transition hover:bg-amber-300"
          onClick={() => {
            const x = Math.random()
            setRoll({ x, actionId: landOn(row, x) })
          }}
        >
          🎲 Roll
        </button>
      </div>

      {/* The mix as a weighted bar; the marker shows exactly where the roll landed. */}
      <div className="relative h-4 overflow-hidden rounded bg-slate-800">
        {(() => {
          let acc = 0
          return row.map((a) => {
            const left = acc * 100
            acc += a.frequency
            return (
              <div
                key={a.actionId}
                className="absolute top-0 h-full"
                style={{ left: `${left}%`, width: `${a.frequency * 100}%`, background: actionColor(a.actionId) }}
              />
            )
          })
        })()}
        {roll && (
          <div
            className="absolute top-0 h-full w-0.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)] transition-[left] duration-500 ease-out"
            style={{ left: `${roll.x * 100}%` }}
          />
        )}
      </div>

      <div className="mt-2 min-h-[1.25rem] text-xs">
        {roll ? (
          <span className="text-slate-300">
            Rolled <span className="font-mono text-slate-100">{roll.x.toFixed(3)}</span> →{' '}
            <span className="font-semibold" style={{ color: actionColor(roll.actionId) }}>
              {actionLabel(roll.actionId)}
            </span>
          </span>
        ) : (
          <span className="text-slate-500">Roll to sample an action at the GTO frequencies.</span>
        )}
      </div>
    </div>
  )
}
