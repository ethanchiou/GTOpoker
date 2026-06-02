import type { Action, ActionRecord, HandState } from '@gto/poker-engine'
import { bb } from '../lib/format'

function actionText(action: Action, bigBlindChips: number): string {
  switch (action.type) {
    case 'fold':
      return 'Fold'
    case 'check':
      return 'Check'
    case 'call':
      return action.amount ? `Call ${bb(action.amount, bigBlindChips)}bb` : 'Call'
    case 'bet':
      return `Bet ${bb(action.amount ?? 0, bigBlindChips)}bb`
    case 'raise':
      return `Raise to ${bb(action.amount ?? 0, bigBlindChips)}bb`
  }
}

function actionLine(record: ActionRecord, bigBlindChips: number): string {
  return `${record.position} ${actionText(record.action, bigBlindChips)}`
}

export function HandReviewPanel({
  state,
  heroSeat,
}: {
  state: HandState | null
  heroSeat: number
}) {
  if (!state || state.phase !== 'complete' || !state.result) return null

  const bigBlindChips = state.config.bigBlindChips
  const potBb = bb(state.result.pots.reduce((sum, pot) => sum + pot.amount, 0), bigBlindChips)
  const winners = Object.keys(state.result.payouts)
    .map((seatIndex) => state.seats[Number(seatIndex)])
    .filter(Boolean)
  const heroWon = winners.some((seat) => seat!.seatIndex === heroSeat)
  const recentHistory = state.history.slice(-8)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hand result</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">
            {heroWon ? 'You won' : `${winners.map((seat) => seat!.position).join(', ')} won`} {potBb}bb
          </div>
        </div>
        <span className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300">
          {state.result.wentToShowdown ? 'Showdown' : 'Uncontested'}
        </span>
      </div>

      {recentHistory.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {recentHistory.map((record, index) => (
            <span
              key={`${record.street}-${record.seatIndex}-${index}`}
              className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
            >
              {actionLine(record, bigBlindChips)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
