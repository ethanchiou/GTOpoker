import { makeCard, NUM_RANKS, type Card } from '@gto/hand-eval'
import { cardFace } from '../lib/format'

// Ranks high→low for a natural left-to-right layout; suits in s,h,d,c order.
const RANK_ORDER = Array.from({ length: NUM_RANKS }, (_, i) => NUM_RANKS - 1 - i)
const SUIT_ORDER = [3, 2, 1, 0]

/**
 * The 52-card picking grid (rank × suit) shared by the hole-card and board
 * pickers. `disabled` cards (already placed elsewhere, or duplicates) are greyed
 * out and unclickable; clicking any other card calls `onPick`.
 */
export function CardGrid({ disabled, onPick }: { disabled: ReadonlySet<Card>; onPick: (card: Card) => void }) {
  return (
    <div className="space-y-1">
      {SUIT_ORDER.map((suit) => (
        <div key={suit} className="flex gap-1">
          {RANK_ORDER.map((rank) => {
            const card = makeCard(rank, suit)
            const f = cardFace(card)
            const isDisabled = disabled.has(card)
            return (
              <button
                key={card}
                disabled={isDisabled}
                onClick={() => onPick(card)}
                className={`flex h-7 w-7 items-center justify-center rounded border text-xs font-semibold leading-none transition ${
                  isDisabled
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
  )
}
