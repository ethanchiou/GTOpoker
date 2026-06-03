import { describeHolding, HandCategory, type Card } from '@gto/hand-eval'

/** Strength tier → accent, so a made flush/boat visibly outranks a bare pair. */
export function handTone(category: HandCategory): string {
  if (category >= HandCategory.Flush) return 'text-emerald-300'
  if (category >= HandCategory.TwoPair) return 'text-amber-300'
  if (category === HandCategory.Pair) return 'text-slate-100'
  return 'text-slate-300'
}

/**
 * Shows what the player currently holds — the named made hand plus any pre-river
 * draws — wherever the hero has cards (Live Solver tabs and dealt hands in Play).
 * Preflop (no board) it names the two hole cards. Reads cards only; never the
 * strategy, so it is correct independent of whether a spot is solved.
 */
export function HandStrength({ hole, board = [] }: { hole: readonly [Card, Card]; board?: readonly Card[] }) {
  const { category, label, draws } = describeHolding(hole, board)
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">You have</span>
      <span className={`text-sm font-semibold ${handTone(category)}`}>{label}</span>
      {draws.map((d) => (
        <span
          key={d}
          className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300"
        >
          {d}
        </span>
      ))}
    </div>
  )
}
