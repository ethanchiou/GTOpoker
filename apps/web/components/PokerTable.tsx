import { describeHolding } from '@gto/hand-eval'
import type { ActionRecord, HandState } from '@gto/poker-engine'
import { actionShort, bb } from '../lib/format'
import { CardView } from './CardView'
import { SeatView } from './SeatView'

// Display slot coordinates (% of container), slot 0 = hero at bottom, clockwise.
const SLOTS: Array<{ x: number; y: number }> = [
  { x: 50, y: 88 }, // bottom (hero)
  { x: 12, y: 66 }, // lower-left
  { x: 12, y: 22 }, // upper-left
  { x: 50, y: 8 }, // top
  { x: 88, y: 22 }, // upper-right
  { x: 88, y: 66 }, // lower-right
]

export function PokerTable({
  state,
  heroSeat,
  lastAction,
}: {
  state: HandState
  heroSeat: number
  /** The most recent action, marked on the table with a "last move" arrow. */
  lastAction?: ActionRecord | null
}) {
  const n = state.seats.length
  const complete = state.phase === 'complete'
  const pot = state.seats.reduce((s, x) => s + x.committedTotal, 0)

  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-3xl">
      {/* Felt */}
      <div className="absolute inset-[8%] rounded-[45%] border-8 border-amber-950/60 bg-gradient-to-b from-felt to-felt-dark shadow-2xl" />

      {/* Center: pot + board */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <div className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-amber-200">
          Pot {bb(pot, state.config.bigBlindChips)}bb
        </div>
        <div className="flex gap-1.5">
          {state.board.length === 0 ? (
            <span className="text-xs text-emerald-200/60">preflop</span>
          ) : (
            state.board.map((c, i) => <CardView key={i} card={c} size="md" />)
          )}
        </div>
      </div>

      {/* Seats */}
      {state.seats.map((seat) => {
        const slot = (seat.seatIndex - heroSeat + n) % n
        const pos = SLOTS[slot]!
        const reveal = seat.isHero || complete
        // The hero's current made hand, shown beside their seat once a board is out.
        const madeHand =
          seat.isHero && reveal && seat.status !== 'folded' && state.board.length >= 3
            ? describeHolding(seat.holeCards, state.board)
            : undefined
        return (
          <div
            key={seat.seatIndex}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <SeatView
              seat={seat}
              reveal={reveal}
              isButton={seat.seatIndex === state.buttonIndex}
              isToAct={state.toAct === seat.seatIndex}
              bigBlindChips={state.config.bigBlindChips}
              lastActionLabel={
                lastAction && lastAction.seatIndex === seat.seatIndex
                  ? actionShort(lastAction.action, state.config.bigBlindChips)
                  : undefined
              }
              madeHand={madeHand}
            />
          </div>
        )
      })}
    </div>
  )
}
