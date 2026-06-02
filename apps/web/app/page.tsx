'use client'

import { handClass, strategyForHand } from '@gto/strategy'
import { useEffect } from 'react'
import { ActionControls } from '../components/ActionControls'
import { FeedbackPanel } from '../components/FeedbackPanel'
import { HandReviewPanel } from '../components/HandReviewPanel'
import { PokerTable } from '../components/PokerTable'
import { SessionStatsView } from '../components/SessionStatsView'
import { StrategyGrid } from '../components/StrategyGrid'
import { StrategyMix } from '../components/StrategyMix'
import { HERO_SEAT, usePlayStore } from '../lib/store'

export default function Home() {
  const {
    state,
    decision,
    strategy,
    reviewStrategy,
    reviewHand,
    chartRevealed,
    lastScore,
    stats,
    busy,
    newHand,
    revealChart,
    heroAct,
  } = usePlayStore()

  useEffect(() => {
    if (!state) void newHand()
  }, [state, newHand])

  const heroTurn = decision !== null
  const currentHand = heroTurn && decision ? handClass(decision.heroHoleCards[0], decision.heroHoleCards[1]) : null
  const hasReview = lastScore !== null && reviewStrategy !== null
  const showingCurrentChart = heroTurn && chartRevealed && strategy !== null
  const gridStrategy = showingCurrentChart ? strategy : hasReview ? reviewStrategy : strategy
  const gridHand = showingCurrentChart ? currentHand : hasReview ? reviewHand : currentHand
  const strategyRow = gridStrategy && gridHand ? strategyForHand(gridStrategy, gridHand) : null
  const canShowStrategy = Boolean(gridStrategy && (chartRevealed || hasReview))
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

          <FeedbackPanel score={lastScore} uncharted={Boolean(handOver && !lastScore)} />
          <HandReviewPanel state={state} heroSeat={HERO_SEAT} />
        </section>

        {/* Right: strategy grid + stats */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              GTO strategy {canShowStrategy && gridStrategy ? `· ${gridStrategy.spotId}` : ''}
            </h2>
            {canShowStrategy && gridStrategy ? (
              <div className="space-y-3">
                {strategyRow && <StrategyMix row={strategyRow} title={gridHand ? `${gridHand} mix` : 'Hand mix'} />}
                <StrategyGrid strategy={gridStrategy} highlight={gridHand ?? undefined} />
              </div>
            ) : gridStrategy ? (
              <div className="rounded border border-slate-800 bg-slate-900/40 p-6 text-center">
                <p className="text-sm text-slate-400">Chart hidden for this decision.</p>
                <button
                  className="mt-3 rounded-md bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
                  disabled={busy}
                  onClick={revealChart}
                >
                  Reveal chart
                </button>
              </div>
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
