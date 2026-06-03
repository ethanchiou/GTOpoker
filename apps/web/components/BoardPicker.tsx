import { type Card } from '@gto/hand-eval'
import { useState } from 'react'
import { CardGrid } from './CardGrid'
import { CardView } from './CardView'

/**
 * Community-board picker for 3–5 cards (flop/turn/river). Shows `count` slots; the
 * active slot is the one being filled. Clicking a card drops it into the active
 * slot and advances; clicking a filled slot clears it. Cards already on the board
 * or in `exclude` (the hero's hole cards) are disabled so nothing collides.
 */
export function BoardPicker({
  value,
  count,
  onChange,
  exclude,
}: {
  value: (Card | null)[]
  count: number
  onChange: (next: (Card | null)[]) => void
  exclude?: ReadonlySet<Card>
}) {
  const [active, setActive] = useState(0)
  const slots = Array.from({ length: count }, (_, i) => value[i] ?? null)
  const used = new Set<Card>(slots.filter((c): c is Card => c !== null))
  const disabled = new Set<Card>([...used, ...(exclude ?? [])])

  const activeSlot = active < count ? active : slots.findIndex((c) => c === null)

  const place = (card: Card) => {
    if (disabled.has(card)) return
    const slot = activeSlot >= 0 ? activeSlot : 0
    const next = slots.slice()
    next[slot] = card
    onChange(next)
    const nextEmpty = next.findIndex((c) => c === null)
    setActive(nextEmpty >= 0 ? nextEmpty : slot)
  }

  const clearSlot = (slot: number) => {
    const next = slots.slice()
    next[slot] = null
    onChange(next)
    setActive(slot)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {slots.map((card, slot) => (
          <button
            key={slot}
            onClick={() => (card !== null ? clearSlot(slot) : setActive(slot))}
            className={`rounded-md p-1 transition ${
              slot === activeSlot ? 'ring-2 ring-amber-400' : 'ring-1 ring-slate-700 hover:ring-slate-500'
            }`}
            aria-label={card !== null ? `Clear board card ${slot + 1}` : `Select board card ${slot + 1}`}
          >
            <CardView card={card ?? undefined} hidden={card === null} />
          </button>
        ))}
        <span className="text-xs text-slate-500">
          {used.size === count ? 'Click a card to change it.' : `Pick the ${slotName(activeSlot, count)}.`}
        </span>
      </div>

      <CardGrid disabled={disabled} onPick={place} />
    </div>
  )
}

/** Friendly name for the board slot being filled (flop cards, then turn, river). */
function slotName(slot: number, count: number): string {
  if (slot < 0) return 'next card'
  if (slot <= 2) return `flop card ${slot + 1}`
  if (slot === 3) return count >= 4 ? 'turn card' : 'card 4'
  return 'river card'
}
