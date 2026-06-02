'use client'

import { handClass } from '@gto/strategy'
import { useEffect } from 'react'
import { ActionControls } from '../components/ActionControls'
import { FeedbackPanel } from '../components/FeedbackPanel'
import { PokerTable } from '../components/PokerTable'
import { SessionStatsView } from '../components/SessionStatsView'
import { StrategyGrid } from '../components/StrategyGrid'
import { HERO_SEAT, usePlayStore } from '../lib/store'

export default function Home() {
  const {
    state,
    decision,
    strategy,
    reviewStrategy,
    reviewHand,
    lastScore,
    stats,
    busy,
    newHand,
    heroAct,
  } = usePlayStore()

  useEffect(() => {
    if (!state) void newHand()
  }, [state, newHand])

  const heroTurn = decision !== null
  const gridStrategy = heroTurn ? strategy : reviewStrategy
  const gridHand = heroTurn && decision ? handClass(decision.heroHoleCards[0], decision.heroHoleCards[1]) : reviewHand
  const handOver = state?.phase === 'complete'

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">
          GTO Poker Trainer <span className="text-sm font-normal text-slate-400">· 6-max NLHE · preflop MVP</span>
        </h1>
        <button
          className="rounded-md bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
          disabled={busy || (!handOver && heroTurn)}
          onClick={() => void newHand()}
        >
          {handOver ? 'Next hand →' : 'New hand'}
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Left: table + actions */}
        <section className="space-y-4">
          {state && <PokerTable state={state} heroSeat={HERO_SEAT} />}

          <div className="min-h-[3rem] rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            {heroTurn && decision ? (
              <ActionControls decision={decision} onAct={(a) => void heroAct(a)} disabled={busy} />
            ) : handOver ? (
              <p className="text-sm text-slate-400">
                Hand complete. Review the feedback, then deal the next hand.
              </p>
            ) : (
              <p className="text-sm text-slate-400">Dealing…</p>
            )}
          </div>

          <FeedbackPanel score={lastScore} />
        </section>

        {/* Right: strategy grid + stats */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              GTO strategy {gridStrategy ? `· ${gridStrategy.spotId}` : ''}
            </h2>
            {gridStrategy ? (
              <StrategyGrid strategy={gridStrategy} highlight={gridHand ?? undefined} />
            ) : (
              <div className="rounded border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
                The strategy grid appears when you reach a charted spot (RFI or single-raise pots).
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Session</h2>
            <SessionStatsView stats={stats} />
          </div>
        </section>
      </div>
    </main>
  )
}
