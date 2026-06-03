'use client'

import { handClass, strategyForCombo, strategyForHand } from '@gto/strategy'
import { useEffect, useRef, useState } from 'react'
import { clearHandLinkFromUrl, copyHandLink, readHandLink } from '../lib/trainerUrl'
import { ActionControls } from './ActionControls'
import { FeedbackPanel } from './FeedbackPanel'
import { HandReviewPanel } from './HandReviewPanel'
import { PokerTable } from './PokerTable'
import { ReplayControls } from './ReplayControls'
import { SettingsMenu } from './SettingsMenu'
import { SessionStatsView } from './SessionStatsView'
import { StrategyGrid } from './StrategyGrid'
import { StrategyMix } from './StrategyMix'
import { DecisionStats } from './DecisionStats'
import { HERO_SEAT, usePlayStore } from '../lib/store'

export function TrainerView() {
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
    handDone,
    replaySteps,
    replayIndex,
    replayStrategies,
    newHand,
    loadHandFromLink,
    revealChart,
    heroAct,
    startReplay,
    exitReplay,
    replayGoto,
    replayStep,
  } = usePlayStore()

  // On first mount, deep-link a shared hand from the URL if present; otherwise
  // deal a fresh random hand (the normal session start).
  useEffect(() => {
    if (state) return
    const link = readHandLink()
    if (link) void loadHandFromLink(link)
    else void newHand()
  }, [state, newHand, loadHandFromLink])

  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const onCopyLink = async () => {
    if (!state) return
    const ok = await copyHandLink({
      seed: state.handId,
      buttonIndex: state.buttonIndex,
      actions: state.history.map((r) => r.action),
    })
    setCopied(ok)
    clearTimeout(copyTimer.current)
    if (ok) copyTimer.current = setTimeout(() => setCopied(false), 1500)
  }

  const replaying = replaySteps !== null
  const currentReplayStep = replaying ? replaySteps[replayIndex] ?? null : null
  // While replaying, the right-column chart follows the step so it visibly evolves
  // (street to street, and when the opponent raises) as the hand is scrubbed.
  const replayStrat = replaying && replayStrategies ? replayStrategies[replayIndex] ?? null : null

  // Arrow-key navigation while the replayer is open.
  useEffect(() => {
    if (!replaying) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') replayStep(-1)
      else if (e.key === 'ArrowRight') replayStep(1)
      else if (e.key === 'Escape') exitReplay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replaying, replayStep, exitReplay])

  const heroTurn = decision !== null
  const currentHand = heroTurn && decision ? handClass(decision.heroHoleCards[0], decision.heroHoleCards[1]) : null
  const hasReview = lastScore !== null && reviewStrategy !== null
  const showingCurrentChart = heroTurn && chartRevealed && strategy !== null
  const gridStrategy = replayStrat ? replayStrat.strategy : showingCurrentChart ? strategy : hasReview ? reviewStrategy : strategy
  const gridHand = replayStrat ? replayStrat.heroHand : showingCurrentChart ? currentHand : hasReview ? reviewHand : currentHand
  // On the *live* decision we hold the concrete cards, so show the combo-specific
  // mix (a made flush diverges from its class); replay/review fall back to the class row.
  const liveHeroCards = !replaying && heroTurn && decision ? decision.heroHoleCards : null
  const strategyRow = gridStrategy && gridHand
    ? liveHeroCards && gridStrategy === strategy
      ? strategyForCombo(gridStrategy, liveHeroCards[0], liveHeroCards[1])
      : strategyForHand(gridStrategy, gridHand)
    : null
  const canShowStrategy = replayStrat ? true : Boolean(gridStrategy && (chartRevealed || hasReview))
  const postflopTurn = heroTurn && decision !== null && decision.street !== 'preflop'
  const multiwayPostflop = postflopTurn && strategy === null
  const approxSolver =
    canShowStrategy && gridStrategy?.meta.source === 'solver' && gridStrategy.meta.version === 'baseline'

  // Replay overlays the live hand: the table shows the reconstructed step and the
  // last-move arrow follows the step (or the latest live action when not replaying).
  const tableState = currentReplayStep ? currentReplayStep.state : state
  const tableLastAction = currentReplayStep
    ? currentReplayStep.lastAction
    : state && state.history.length > 0
      ? state.history[state.history.length - 1]!
      : null
  const canReplay = Boolean(state && state.history.length > 0)

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-2">
        <SettingsMenu />
        {!replaying && (
          <>
            <button
              className="rounded-md border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-40"
              disabled={busy || !state}
              onClick={() => void onCopyLink()}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              className="rounded-md border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-40"
              disabled={busy || !canReplay}
              onClick={startReplay}
            >
              ↺ Replay hand
            </button>
          </>
        )}
        <button
          className="rounded-md bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
          disabled={busy || (!handDone && heroTurn)}
          onClick={() => {
            clearHandLinkFromUrl()
            void newHand()
          }}
        >
          {handDone ? 'Next hand →' : 'New hand'}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Left: table + actions */}
        <section className="space-y-4">
          {tableState && <PokerTable state={tableState} heroSeat={HERO_SEAT} lastAction={tableLastAction} />}

          <div className="min-h-[3rem] rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            {replaying && replaySteps ? (
              <ReplayControls
                steps={replaySteps}
                index={replayIndex}
                onStep={replayStep}
                onGoto={replayGoto}
                onExit={exitReplay}
              />
            ) : heroTurn && decision ? (
              <ActionControls decision={decision} onAct={(a) => void heroAct(a)} disabled={busy} />
            ) : handDone ? (
              <p className="text-sm text-slate-400">
                Hand complete. Review the feedback, then deal the next hand.
              </p>
            ) : (
              <p className="text-sm text-slate-400">Dealing…</p>
            )}
          </div>

          {heroTurn && decision && !replaying && (
            <DecisionStats
              decision={decision}
              strategyRow={strategy ? strategyForCombo(strategy, decision.heroHoleCards[0], decision.heroHoleCards[1]) : null}
            />
          )}

          <FeedbackPanel score={lastScore} uncharted={Boolean(handDone && !lastScore)} />
          <HandReviewPanel state={state} heroSeat={HERO_SEAT} />
        </section>

        {/* Right: strategy grid + stats */}
        <section className="space-y-5">
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              GTO strategy {canShowStrategy && gridStrategy ? `· ${gridStrategy.spotId}` : ''}
            </h2>
            {replaying && (
              <p className="mb-2 -mt-1 text-xs font-medium text-amber-300/90">
                {replayStrat
                  ? `Replay · ${replayStrat.label} — chart evolves as you step`
                  : replayStrategies === null
                    ? 'Deriving chart evolution…'
                    : 'No GTO chart at this step (multiway / uncharted)'}
              </p>
            )}
            {canShowStrategy && gridStrategy ? (
              <div className="space-y-3">
                {approxSolver && (
                  <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
                    Approximate baseline solver — EVs are estimates, not a true CFR solve. They become exact
                    once the postflop-solver WASM is built (see solver-worker/BUILD.md).
                  </p>
                )}
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
                  Reveal {postflopTurn ? 'solution' : 'chart'}
                </button>
              </div>
            ) : multiwayPostflop ? (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-300">
                Multiway postflop spot — not solved (flagged). Heads-up-by-the-flop pots are graded; play
                this one out without a GTO score.
              </div>
            ) : (
              <div className="rounded border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
                The strategy appears at charted preflop spots and heads-up postflop decisions.
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Session</h2>
            <SessionStatsView stats={stats} />
          </div>
        </section>
      </div>
    </>
  )
}
