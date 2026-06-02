import type { SeatState } from '@gto/poker-engine'
import { bb } from '../lib/format'
import { CardView } from './CardView'

export function SeatView({
  seat,
  reveal,
  isButton,
  isToAct,
  bigBlindChips,
}: {
  seat: SeatState
  reveal: boolean
  isButton: boolean
  isToAct: boolean
  bigBlindChips: number
}) {
  const folded = seat.status === 'folded'
  return (
    <div className={`flex flex-col items-center gap-1 ${folded ? 'opacity-40' : ''}`}>
      <div className="flex gap-1">
        <CardView card={seat.holeCards[0]} hidden={!reveal} size="sm" />
        <CardView card={seat.holeCards[1]} hidden={!reveal} size="sm" />
      </div>
      <div
        className={`relative rounded-md border px-2 py-1 text-center ${
          isToAct ? 'border-amber-300 bg-slate-800' : 'border-slate-700 bg-slate-900/80'
        }`}
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          {seat.position}
          {seat.isHero && <span className="rounded bg-amber-400 px-1 text-[9px] text-slate-950">YOU</span>}
          {isButton && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[8px] font-bold text-slate-900">
              D
            </span>
          )}
        </div>
        <div className="font-mono text-[11px] text-slate-400">
          {seat.status === 'allIn' ? 'ALL-IN' : `${bb(seat.stack, bigBlindChips)}bb`}
        </div>
      </div>
      {seat.committedThisStreet > 0 && (
        <div className="rounded-full bg-yellow-500/90 px-2 text-[10px] font-bold text-slate-950">
          {bb(seat.committedThisStreet, bigBlindChips)}bb
        </div>
      )}
    </div>
  )
}
