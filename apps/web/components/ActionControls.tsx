import type { Action, DecisionPoint } from '@gto/poker-engine'
import { useEffect, useState } from 'react'
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
  const raiseLegal = legal.find((l) => l.type === 'raise') ?? legal.find((l) => l.type === 'bet')
  const raiseType = raiseLegal?.type ?? null

  // Preset raise buttons: the engine's size options minus all-in (shown on its
  // own). Trim to two — smallest + largest — for a cleaner row; the slider below
  // covers every amount in between.
  const raiseOptions = decision.sizeOptions.filter((o) => o.kind !== 'allin')
  const presets =
    raiseOptions.length > 2 ? [raiseOptions[0]!, raiseOptions[raiseOptions.length - 1]!] : raiseOptions
  const allIn = decision.sizeOptions.find((o) => o.kind === 'allin')

  const raiseMin = raiseLegal?.min ?? 0
  const raiseMax = raiseLegal?.max ?? 0
  const sliderUsable = raiseType !== null && raiseMax > raiseMin
  const raiseVerb = raiseType === 'bet' ? 'Bet' : 'Raise to'

  // Slider value (a precise "raise-to"/"bet-to" amount in chips), seeded to the
  // smallest preset and reset whenever the legal raise band changes (new spot).
  const defaultRaise = presets[0]?.amount ?? raiseMin
  const [raiseTo, setRaiseTo] = useState(defaultRaise)
  useEffect(() => {
    setRaiseTo(defaultRaise)
  }, [defaultRaise, raiseMin, raiseMax])

  const step = Math.max(1, Math.round(decision.bigBlindChips / 2))
  const btn = 'rounded-md px-4 py-2 text-sm font-semibold transition disabled:opacity-40'

  return (
    <div className="space-y-3">
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
          presets.map((opt) => (
            <button
              key={`${opt.kind}-${opt.amount}`}
              className={`${btn} bg-red-700 hover:bg-red-600`}
              disabled={disabled}
              onClick={() => onAct({ type: raiseType, amount: opt.amount })}
            >
              {opt.label}
            </button>
          ))}
        {raiseType && allIn && (
          <button
            className={`${btn} bg-orange-600 hover:bg-orange-500`}
            disabled={disabled}
            onClick={() => onAct({ type: raiseType, amount: allIn.amount })}
          >
            {allIn.label}
          </button>
        )}
      </div>

      {sliderUsable && raiseType && (
        <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
          <span className="shrink-0 font-mono text-[11px] text-slate-500">
            {bb(raiseMin, decision.bigBlindChips)}bb
          </span>
          <input
            type="range"
            aria-label="Raise amount"
            min={raiseMin}
            max={raiseMax}
            step={step}
            value={raiseTo}
            disabled={disabled}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-red-500 disabled:cursor-default disabled:opacity-40"
          />
          <span className="shrink-0 font-mono text-[11px] text-slate-500">
            {bb(raiseMax, decision.bigBlindChips)}bb
          </span>
          <button
            className={`${btn} w-32 shrink-0 bg-red-700 hover:bg-red-600`}
            disabled={disabled}
            onClick={() => onAct({ type: raiseType, amount: raiseTo })}
          >
            {raiseVerb} {bb(raiseTo, decision.bigBlindChips)}bb
          </button>
        </div>
      )}
    </div>
  )
}
