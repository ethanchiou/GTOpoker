import { type Card } from '@gto/hand-eval'
import { useState } from 'react'
import { CardGrid } from './CardGrid'
import { CardView } from './CardView'

export type HoleCards = [Card | null, Card | null]

/**
 * Two-card hole-card picker (rank × suit, no duplicates). One slot is "active";
 * clicking a card fills it and advances to the other slot. Cards already used —
 * either in the other slot or in `exclude` (e.g. the board) — are disabled so the
 * hole cards can never collide with them.
 */
export function CardPicker({
  value,
  onChange,
  exclude,
}: {
  value: HoleCards
  onChange: (next: HoleCards) => void
  /** Cards unavailable for selection (e.g. the community board). */
  exclude?: ReadonlySet<Card>
}) {
  const [active, setActive] = useState<0 | 1>(0)
  const used = new Set<Card>(value.filter((c): c is Card => c !== null))
  const disabled = new Set<Card>([...used, ...(exclude ?? [])])

  const place = (card: Card) => {
    if (disabled.has(card)) return
    const next: HoleCards = [value[0], value[1]]
    next[active] = card
    onChange(next)
    setActive(active === 0 ? 1 : 0)
  }

  const clearSlot = (slot: 0 | 1) => {
    const next: HoleCards = [value[0], value[1]]
    next[slot] = null
    onChange(next)
    setActive(slot)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {[0, 1].map((slot) => {
          const card = value[slot as 0 | 1]
          const isActive = active === slot
          return (
            <button
              key={slot}
              onClick={() => (card !== null ? clearSlot(slot as 0 | 1) : setActive(slot as 0 | 1))}
              className={`rounded-md p-1 transition ${
                isActive ? 'ring-2 ring-amber-400' : 'ring-1 ring-slate-700 hover:ring-slate-500'
              }`}
              aria-label={card !== null ? `Clear card ${slot + 1}` : `Select card ${slot + 1}`}
            >
              <CardView card={card ?? undefined} hidden={card === null} />
            </button>
          )
        })}
        <span className="text-xs text-slate-500">
          {value[0] !== null && value[1] !== null
            ? 'Click a card to change it.'
            : `Pick card ${active + 1}.`}
        </span>
      </div>

      <CardGrid disabled={disabled} onPick={place} />
    </div>
  )
}
