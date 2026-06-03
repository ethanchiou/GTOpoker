'use client'

import { useState } from 'react'
import { LiveSolverPreflop } from './LiveSolverPreflop'
import { LiveSolverPostflop } from './LiveSolverPostflop'
import { Segmented } from './LiveSolverUI'

type Mode = 'preflop' | 'postflop'

export function LiveSolver() {
  const [mode, setMode] = useState<Mode>('preflop')

  return (
    <div className="space-y-5">
      <Segmented
        options={[
          { value: 'preflop' as const, label: 'Preflop' },
          { value: 'postflop' as const, label: 'Postflop' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'preflop' ? <LiveSolverPreflop /> : <LiveSolverPostflop />}
    </div>
  )
}
