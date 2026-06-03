'use client'

import { useEffect, useRef, useState } from 'react'
import { copyCurrentUrl, urlModeIsPostflop } from '../lib/liveSolverUrl'
import { LiveSolverPreflop } from './LiveSolverPreflop'
import { LiveSolverPostflop } from './LiveSolverPostflop'
import { Segmented } from './LiveSolverUI'

type Mode = 'preflop' | 'postflop'

// Seed the mode from a shared link. Safe to read synchronously: the Live Solver
// only mounts on the client (the tab is switched in via an effect), so it is
// never part of the static-export HTML and cannot cause a hydration mismatch.
function initialMode(): Mode {
  return urlModeIsPostflop() ? 'postflop' : 'preflop'
}

export function LiveSolver() {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const onCopy = async () => {
    const ok = await copyCurrentUrl()
    setCopied(ok)
    clearTimeout(copyTimer.current)
    if (ok) copyTimer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={[
            { value: 'preflop' as const, label: 'Preflop' },
            { value: 'postflop' as const, label: 'Postflop' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <button
          onClick={onCopy}
          className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800"
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      {mode === 'preflop' ? <LiveSolverPreflop /> : <LiveSolverPostflop />}
    </div>
  )
}
