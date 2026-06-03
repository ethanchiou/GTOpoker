import { actionShort } from '../lib/format'
import type { ReplayStep } from '../lib/replay'

export function ReplayControls({
  steps,
  index,
  onStep,
  onGoto,
  onExit,
}: {
  steps: ReplayStep[]
  index: number
  onStep: (delta: number) => void
  onGoto: (index: number) => void
  onExit: () => void
}) {
  const step = steps[index]!
  const lastIndex = steps.length - 1
  const bigBlindChips = step.state.config.bigBlindChips
  const description = step.lastAction
    ? `${step.lastAction.position} ${actionShort(step.lastAction.action, bigBlindChips)}`
    : 'Hand start — blinds posted'

  const btn = 'rounded-md px-3 py-2 text-sm font-semibold transition disabled:opacity-30'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 rounded bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-950">
        Replay
      </span>
      <button className={`${btn} bg-slate-700 hover:bg-slate-600`} disabled={index === 0} onClick={() => onGoto(0)} aria-label="First move">
        ⏮
      </button>
      <button className={`${btn} bg-slate-700 hover:bg-slate-600`} disabled={index === 0} onClick={() => onStep(-1)} aria-label="Previous move">
        ◀
      </button>
      <button
        className={`${btn} bg-slate-700 hover:bg-slate-600`}
        disabled={index === lastIndex}
        onClick={() => onStep(1)}
        aria-label="Next move"
      >
        ▶
      </button>
      <button
        className={`${btn} bg-slate-700 hover:bg-slate-600`}
        disabled={index === lastIndex}
        onClick={() => onGoto(lastIndex)}
        aria-label="Last move"
      >
        ⏭
      </button>
      <div className="ml-1 text-sm">
        <span className="font-mono text-slate-400">
          {index}/{lastIndex}
        </span>{' '}
        <span className="text-xs uppercase text-slate-500">{step.state.street}</span>{' '}
        <span className="text-slate-200">· {description}</span>
      </div>
      <button className={`${btn} ml-auto bg-amber-400 text-slate-950 hover:bg-amber-300`} onClick={onExit}>
        Exit replay
      </button>
    </div>
  )
}
