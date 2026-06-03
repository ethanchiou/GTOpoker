export interface Stat {
  label: string
  value: string
  /** Sub-label under the value (e.g. "vs CO open"). */
  hint?: string
  /** Optional accent color for the value. */
  tone?: 'default' | 'amber' | 'green'
}

const TONE: Record<NonNullable<Stat['tone']>, string> = {
  default: 'text-slate-100',
  amber: 'text-amber-300',
  green: 'text-emerald-300',
}

/** A compact, labeled row of headline numbers (pot odds, equity, EV). */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</div>
          <div className={`font-mono text-lg font-semibold leading-tight ${TONE[s.tone ?? 'default']}`}>
            {s.value}
          </div>
          {s.hint && <div className="mt-0.5 truncate text-[10px] text-slate-500">{s.hint}</div>}
        </div>
      ))}
    </div>
  )
}
