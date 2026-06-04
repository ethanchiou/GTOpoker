'use client'

import { POSITIONS_6MAX, type Position } from '@gto/domain-config'
import {
  buildPreflopLineNode,
  equityVsRange,
  handClass,
  positionsAfter,
  positionsBefore,
  potOddsPct,
  strategyForHand,
  villainContinuingRange,
  type ActionFrequency,
  type NodeStrategy,
  type PreflopLine,
} from '@gto/strategy'
import { createRng, type Card as CardCode } from '@gto/hand-eval'
import { useEffect, useMemo, useState } from 'react'
import { actionLabel, bb } from '../lib/format'
import { holeFromCards, readDecodedSpot, writeSpotToUrl } from '../lib/liveSolverUrl'
import { strategyProvider } from '../lib/strategyProvider'
import { useSettledSpotCounter } from '../lib/useSettledSpotCounter'
import { ActionRandomizer } from './ActionRandomizer'
import { CardPicker, type HoleCards } from './CardPicker'
import { HandStrength } from './HandStrength'
import { Card, Label, Segmented } from './LiveSolverUI'
import { StatStrip, type Stat } from './StatStrip'
import { StrategyGrid } from './StrategyGrid'
import { StrategyMix } from './StrategyMix'

type LineKind = 'rfi' | 'vsRfi' | 'vs3bet' | 'vs4bet'

const LINE_OPTIONS: { kind: LineKind; label: string }[] = [
  { kind: 'rfi', label: 'No raise (you open)' },
  { kind: 'vsRfi', label: 'Facing a raise' },
  { kind: 'vs3bet', label: 'You opened, facing a 3-bet' },
  { kind: 'vs4bet', label: 'You 3-bet, facing a 4-bet' },
]

/** Resolve the UI selections into a concrete preflop line, or an error to show. */
function resolveLine(
  hero: Position,
  kind: LineKind,
  opener: Position | null,
  threeBettor: Position | null,
  fourBettor: Position | null,
): { line: PreflopLine } | { error: string } {
  if (kind === 'rfi') {
    if (hero === 'BB') return { error: 'The big blind is never first-in. Pick another seat or an action line.' }
    return { line: { kind: 'rfi', hero } }
  }
  if (kind === 'vsRfi') {
    const openers = positionsBefore(hero)
    if (openers.length === 0) return { error: 'UTG acts first — there is no one to have raised before it.' }
    const o = opener && openers.includes(opener) ? opener : openers[openers.length - 1]!
    return { line: { kind: 'vsRfi', hero, opener: o } }
  }
  if (kind === 'vs3bet') {
    const tbs = positionsAfter(hero)
    if (tbs.length === 0) return { error: 'The big blind acts last — no one can 3-bet over it.' }
    const tb = threeBettor && tbs.includes(threeBettor) ? threeBettor : tbs[0]!
    return { line: { kind: 'vs3bet', hero, threeBettor: tb } }
  }
  // vs4bet: hero 3-bet an earlier opener, who 4-bet back. The 4-bettor acts before hero.
  const fbs = positionsBefore(hero)
  if (fbs.length === 0) return { error: 'UTG acts first — it cannot have 3-bet over an earlier open.' }
  const fb = fourBettor && fbs.includes(fourBettor) ? fourBettor : fbs[fbs.length - 1]!
  return { line: { kind: 'vs4bet', hero, fourBettor: fb } }
}

interface Outcome {
  spotId: string
  strategy: NodeStrategy | null
  supported: boolean
  villain: Position | null
  equity: number | null
  potOdds: number | null
  facingBet: boolean
}

/** Initial inputs, seeded from a shared-link URL spot (preflop mode) when present. */
function initialInputs() {
  const spot = readDecodedSpot()
  const s = spot?.mode === 'preflop' ? spot : null
  return {
    hero: s?.hero ?? ('CO' as Position),
    lineKind: s?.lineKind ?? ('vsRfi' as LineKind),
    opener: s?.opener ?? null,
    threeBettor: s?.threeBettor ?? null,
    fourBettor: s?.fourBettor ?? null,
    cards: holeFromCards(s?.cards),
  }
}

export function LiveSolverPreflop() {
  const seed = useMemo(initialInputs, [])
  const [hero, setHero] = useState<Position>(seed.hero)
  const [lineKind, setLineKind] = useState<LineKind>(seed.lineKind)
  const [opener, setOpener] = useState<Position | null>(seed.opener)
  const [threeBettor, setThreeBettor] = useState<Position | null>(seed.threeBettor)
  const [fourBettor, setFourBettor] = useState<Position | null>(seed.fourBettor)
  const [cards, setCards] = useState<HoleCards>(seed.cards)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [loading, setLoading] = useState(false)

  // Mirror the inputs into the URL so the spot is shareable. Irrelevant fields
  // (opener unless vsRfi, 3-bettor unless vs3bet) are normalised out by the codec.
  useEffect(() => {
    writeSpotToUrl({
      mode: 'preflop',
      hero,
      lineKind,
      opener,
      threeBettor,
      fourBettor,
      cards: cards.filter((c): c is CardCode => c !== null),
    })
  }, [hero, lineKind, opener, threeBettor, fourBettor, cards])

  const resolved = useMemo(
    () => resolveLine(hero, lineKind, opener, threeBettor, fourBettor),
    [hero, lineKind, opener, threeBettor, fourBettor],
  )
  const lineError = 'error' in resolved ? resolved.error : null
  const line = 'line' in resolved ? resolved.line : null

  // One usage-metric event per spot the user settles on (debounced — see hook).
  useSettledSpotCounter(line ? describeSpot(line) : null, 'live-solver')

  const bothCards = cards[0] !== null && cards[1] !== null
  const heroHand = bothCards ? handClass(cards[0]!, cards[1]!) : null

  // Recompute the GTO answer whenever the spot or the hand changes. Async (chart
  // lookup → villain range → Monte-Carlo equity); a cancel flag guards stale runs.
  useEffect(() => {
    if (!line) {
      setOutcome(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { node, villain, facingBet } = buildPreflopLineNode(line)
      const supported = strategyProvider.supports(node)
      const strategy = supported ? await strategyProvider.getStrategy(node) : null
      const potOdds = facingBet ? potOddsPct(node.toCallChips ?? 0, node.potChips ?? 0) : null

      let equity: number | null = null
      if (bothCards) {
        const { range } = await villainContinuingRange(node, strategyProvider)
        if (range.length > 0) {
          const rng = createRng(`live:${strategy?.spotId ?? 'n'}:${cards[0]}:${cards[1]}`)
          equity = equityVsRange([cards[0]!, cards[1]!], range, node.board, { iterations: 12_000, rng })?.equity ?? null
        }
      }
      if (cancelled) return
      setOutcome({
        spotId: strategy?.spotId ?? describeSpot(line),
        strategy,
        supported,
        villain,
        equity,
        potOdds,
        facingBet,
      })
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [line, bothCards, cards])

  const strategyRow: ActionFrequency[] | null =
    outcome?.strategy && heroHand ? strategyForHand(outcome.strategy, heroHand) : null

  const stats: Stat[] = [
    {
      label: 'Pot odds',
      value: outcome?.potOdds != null ? `${(outcome.potOdds * 100).toFixed(0)}%` : '—',
      hint: outcome?.facingBet ? 'equity to call' : 'opening — n/a',
    },
    {
      label: 'Win chance',
      value: outcome?.equity != null ? `${(outcome.equity * 100).toFixed(0)}%` : '—',
      hint: outcome?.villain ? `vs ${outcome.villain} range` : bothCards ? 'no villain range' : 'pick your cards',
      tone: 'green',
    },
    { label: 'EV', value: '—', hint: 'solver only (postflop)' },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      {/* Left: inputs */}
      <section className="space-y-5">
        <div>
          <Label>Your seat</Label>
          <Segmented
            options={POSITIONS_6MAX.map((p) => ({ value: p, label: p }))}
            value={hero}
            onChange={(p) => setHero(p)}
          />
        </div>

        <div>
          <Label>Action before you</Label>
          <Segmented
            options={LINE_OPTIONS.map((o) => ({ value: o.kind, label: o.label }))}
            value={lineKind}
            onChange={(k) => setLineKind(k)}
          />
        </div>

        {lineKind === 'vsRfi' && positionsBefore(hero).length > 0 && (
          <div>
            <Label>Who opened</Label>
            <Segmented
              options={positionsBefore(hero).map((p) => ({ value: p, label: p }))}
              value={(line && line.kind === 'vsRfi' ? line.opener : positionsBefore(hero)[0]!) as Position}
              onChange={(p) => setOpener(p)}
            />
          </div>
        )}

        {lineKind === 'vs3bet' && positionsAfter(hero).length > 0 && (
          <div>
            <Label>Who 3-bet you</Label>
            <Segmented
              options={positionsAfter(hero).map((p) => ({ value: p, label: p }))}
              value={(line && line.kind === 'vs3bet' ? line.threeBettor : positionsAfter(hero)[0]!) as Position}
              onChange={(p) => setThreeBettor(p)}
            />
          </div>
        )}

        {lineKind === 'vs4bet' && positionsBefore(hero).length > 0 && (
          <div>
            <Label>Who 4-bet you</Label>
            <Segmented
              options={positionsBefore(hero).map((p) => ({ value: p, label: p }))}
              value={
                (line && line.kind === 'vs4bet'
                  ? line.fourBettor
                  : positionsBefore(hero)[positionsBefore(hero).length - 1]!) as Position
              }
              onChange={(p) => setFourBettor(p)}
            />
          </div>
        )}

        <div>
          <Label>Your hand</Label>
          <CardPicker value={cards} onChange={setCards} />
        </div>
      </section>

      {/* Right: GTO answer */}
      <section className="space-y-4">
        {lineError ? (
          <Card>
            <p className="text-sm text-amber-300">{lineError}</p>
          </Card>
        ) : outcome && !outcome.supported ? (
          <Card>
            <p className="text-sm text-amber-300">
              No charted strategy for {describeSpot(line!)} yet. The seed charts cover RFI, single-raise,
              and the 3-bet/4-bet/5-bet tree; multiway pots (squeezes, cold 4-bets) use a low-confidence
              approximation in the trainer but aren’t selectable here yet.
            </p>
          </Card>
        ) : outcome?.strategy ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                GTO · {outcome.spotId}
              </h2>
              {loading && <span className="text-xs text-slate-500">recomputing…</span>}
            </div>

            {bothCards && <HandStrength hole={[cards[0]!, cards[1]!]} />}

            {heroHand && strategyRow ? (
              <>
                <Recommendation hand={heroHand} row={strategyRow} bigBlindChips={100} />
                <StatStrip stats={stats} />
                <StrategyMix row={strategyRow} title={`${heroHand} mix`} />
                <ActionRandomizer row={strategyRow} />
              </>
            ) : (
              <Card>
                <p className="text-sm text-slate-400">
                  Pick your two cards to get the action mix, sizing, equity, and a “pick for us” roll.
                  The chart below shows the whole range.
                </p>
              </Card>
            )}

            <StrategyGrid strategy={outcome.strategy} highlight={heroHand ?? undefined} />
          </>
        ) : (
          <Card>
            <p className="text-sm text-slate-500">Choose a seat and the action before you.</p>
          </Card>
        )}
      </section>
    </div>
  )
}

/** A one-line GTO recommendation + the headline sizing for the picked hand. */
function Recommendation({ hand, row, bigBlindChips }: { hand: string; row: ActionFrequency[]; bigBlindChips: number }) {
  const sorted = [...row].filter((a) => a.frequency > 0.005).sort((a, b) => b.frequency - a.frequency)
  const top = sorted[0]
  if (!top) return null
  const pure = top.frequency > 0.999
  const raise = sorted.find((a) => a.actionId.startsWith('raiseTo:'))
  const raiseBb = raise ? Number(raise.actionId.slice('raiseTo:'.length)) : null
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
      <span className="text-amber-200">
        {pure ? 'Always ' : 'Mostly '}
        <span className="font-semibold text-amber-100">{actionLabel(top.actionId)}</span>
        {!pure && <span className="text-amber-200/80"> ({(top.frequency * 100).toFixed(0)}%)</span>}
        {raiseBb !== null && (
          <span className="text-amber-200/80">
            {' '}· raise to <span className="font-mono">{bb(Math.round(raiseBb * bigBlindChips), bigBlindChips)}bb</span>
          </span>
        )}
      </span>
    </div>
  )
}

function describeSpot(line: PreflopLine): string {
  if (line.kind === 'rfi') return `rfi/${line.hero}`
  if (line.kind === 'vsRfi') return `vsRfi/${line.hero}/vs${line.opener}`
  if (line.kind === 'vs3bet') return `vs3bet/${line.hero}/vs${line.threeBettor}`
  return `vs4bet/${line.hero}/vs${line.fourBettor}`
}
