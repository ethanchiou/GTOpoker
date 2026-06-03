import { makeCard, NUM_RANKS, type Card } from '@gto/hand-eval'
import { useState } from 'react'
import { cardFace } from '../lib/format'
import { CardView } from './CardView'

export type HoleCards = [Card | null, Card | null]

// Ranks high→low for a natural left-to-right layout; suits in s,h,d,c order.
const RANK_ORDER = Array.from({ length: NUM_RANKS }, (_, i) => NUM_RANKS - 1 - i)
const SUIT_ORDER = [3, 2, 1, 0]

/**
 * Two-card hole-card picker (rank × suit, no duplicates). One slot is "active";
 * clicking a card fills it and advances to the other slot. Used cards are
 * disabled so the two cards can never collide.
 */
export function CardPicker({ value, onChange }: { value: HoleCards; onChange: (next: HoleCards) => void }) {
  const [active, setActive] = useState<0 | 1>(0)
  const used = new Set<Card>(value.filter((c): c is Card => c !== null))

  const place = (card: Card) => {
    if (used.has(card)) return
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

      <div className="space-y-1">
        {SUIT_ORDER.map((suit) => (
          <div key={suit} className="flex gap-1">
            {RANK_ORDER.map((rank) => {
              const card = makeCard(rank, suit)
              const f = cardFace(card)
              const isUsed = used.has(card)
              return (
                <button
                  key={card}
                  disabled={isUsed}
                  onClick={() => place(card)}
                  className={`flex h-7 w-7 items-center justify-center rounded border text-xs font-semibold leading-none transition ${
                    isUsed
                      ? 'cursor-not-allowed border-slate-800 bg-slate-800/40 text-slate-600'
                      : `border-slate-300 bg-white hover:ring-2 hover:ring-amber-400 ${
                          f.red ? 'text-red-600' : 'text-slate-900'
                        }`
                  }`}
                  aria-label={`${f.rank}${f.suit}`}
                >
                  <span>{f.rank}</span>
                  <span className="text-[9px]">{f.suit}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
