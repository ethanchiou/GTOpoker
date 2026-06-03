import type { ReactNode } from 'react'

/** A segmented (pill) single-choice control, shared by the Live Solver inputs. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string; disabledOption?: boolean }[]
  value: T
  onChange: (v: T) => void
  disabled?: (v: T) => boolean
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-md border border-slate-700 bg-slate-900/60 p-1">
      {options.map((o) => {
        const isDisabled = o.disabledOption || disabled?.(o.value)
        const active = o.value === value
        return (
          <button
            key={o.value}
            disabled={isDisabled}
            onClick={() => onChange(o.value)}
            className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
              active
                ? 'bg-amber-400 text-slate-950'
                : isDisabled
                  ? 'cursor-not-allowed text-slate-600'
                  : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{children}</div>
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">{children}</div>
}
