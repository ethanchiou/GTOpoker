'use client'

import { useEffect, useState } from 'react'
import { LiveSolver } from '../components/LiveSolver'
import { TrainerView } from '../components/TrainerView'
import { liveSpotPresent } from '../lib/liveSolverUrl'

type Tab = 'trainer' | 'live'

const TABS: { id: Tab; label: string }[] = [
  { id: 'trainer', label: 'Trainer' },
  { id: 'live', label: 'Live Solver' },
]

export default function Home() {
  const [tab, setTab] = useState<Tab>('trainer')

  // A shared link carries a Live Solver spot in its query string; open that tab.
  // Done post-mount (not in the initial state) so the first client render matches
  // the static-export HTML and the Live Solver mounts client-only.
  useEffect(() => {
    if (liveSpotPresent()) setTab('live')
  }, [])

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">
          GTO Poker Trainer{' '}
          <span className="text-sm font-normal text-slate-400">· 6-max NLHE · 100bb</span>
        </h1>
        <nav className="inline-flex gap-1 rounded-md border border-slate-700 bg-slate-900/60 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-4 py-1.5 text-sm font-semibold transition ${
                tab === t.id ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'live' && (
        <p className="mb-4 text-sm text-slate-400">
          Enter a real spot to see the GTO answer — no hand is dealt. Preflop charts, plus heads-up
          flop/turn/river: deal a board, set the pot and the villain’s bet, and slide your own sizing.
        </p>
      )}

      {tab === 'trainer' ? <TrainerView /> : <LiveSolver />}
    </main>
  )
}
