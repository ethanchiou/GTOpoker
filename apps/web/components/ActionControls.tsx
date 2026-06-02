import type { Action, DecisionPoint } from '@gto/poker-engine'
import { bb } from '../lib/format'

export function ActionControls({
  decision,
  onAct,
  disabled,
}: {
  decision: DecisionPoint
  onAct: (action: Action) => void
  disabled?: boolean
}) {
  const legal = decision.legalActions
  const canFold = legal.some((l) => l.type === 'fold')
  const canCheck = legal.some((l) => l.type === 'check')
  const call = legal.find((l) => l.type === 'call')
  const raiseType = legal.find((l) => l.type === 'raise') ? 'raise' : legal.find((l) => l.type === 'bet') ? 'bet' : null

  const btn = 'rounded-md px-4 py-2 text-sm font-semibold transition disabled:opacity-40'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canFold && (
        <button className={`${btn} bg-slate-700 hover:bg-slate-600`} disabled={disabled} onClick={() => onAct({ type: 'fold' })}>
          Fold
        </button>
      )}
      {canCheck && (
        <button className={`${btn} bg-teal-700 hover:bg-teal-600`} disabled={disabled} onClick={() => onAct({ type: 'check' })}>
          Check
        </button>
      )}
      {call && (
        <button className={`${btn} bg-green-700 hover:bg-green-600`} disabled={disabled} onClick={() => onAct({ type: 'call' })}>
          Call {bb(decision.toCallChips, decision.bigBlindChips)}bb
        </button>
      )}
      {raiseType &&
        decision.sizeOptions.map((opt) => (
          <button
            key={`${opt.kind}-${opt.amount}`}
            className={`${btn} bg-red-700 hover:bg-red-600`}
            disabled={disabled}
            onClick={() => onAct({ type: raiseType, amount: opt.amount })}
          >
            {opt.label}
          </button>
        ))}
    </div>
  )
}
