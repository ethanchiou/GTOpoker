'use client'

import { POSITIONS_6MAX, type Position } from '@gto/domain-config'
import { createRng, type Card } from '@gto/hand-eval'
import {
  buildPostflopLineNode,
  equityVsRange,
  handClass,
  POSTFLOP_BOARD_LEN,
  potFractionForBetTo,
  potOddsPct,
  strategyForHand,
  villainContinuingRange,
  type ActionFrequency,
  type NodeStrategy,
  type PostflopActionActor,
  type PostflopActionLine,
  type PostflopActionLinePreset,
  type PostflopActionStep,
  type PostflopPotType,
  type PostflopStreet,
  type PreflopAggressor,
} from '@gto/strategy'
import { useEffect, useMemo, useState } from 'react'
import { actionLabel, bb } from '../lib/format'
import { postflopProvider, strategyProvider } from '../lib/strategyProvider'
import { ActionRandomizer } from './ActionRandomizer'
import { BoardPicker } from './BoardPicker'
import { CardPicker, type HoleCards } from './CardPicker'
import { Card as Panel, Label, Segmented } from './LiveSolverUI'
import { StatStrip, type Stat } from './StatStrip'
import { StrategyGrid } from './StrategyGrid'
import { StrategyMix } from './StrategyMix'

const BB_CHIPS = 100
const STREETS: { value: PostflopStreet; label: string }[] = [
  { value: 'flop', label: 'Flop' },
  { value: 'turn', label: 'Turn' },
  { value: 'river', label: 'River' },
]
const POT_TYPES: { value: PostflopPotType; label: string }[] = [
  { value: 'srp', label: 'Single-raised' },
  { value: '3bet', label: '3-bet pot' },
]
const ACTION_LINES: { value: PostflopActionLinePreset; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'flop-check-check', label: 'Flop x/x' },
  { value: 'flop-bet-call', label: 'Flop bet/call' },
  { value: 'turn-bet-call', label: 'Turn bet/call' },
  { value: 'hero-bet-facing-raise', label: 'Bet vs raise' },
  { value: 'villain-donk-bet', label: 'Donk bet' },
  { value: 'delayed-cbet', label: 'Delayed c-bet' },
  { value: 'probe', label: 'Probe' },
]
const POSTFLOP_ORDER: readonly Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const roundChips = (x: number) => Math.round(x / 25) * 25 // 0.25bb granularity

interface Equity {
  villain: Position | null
  equity: number | null
}

export function LiveSolverPostflop() {
  const [street, setStreet] = useState<PostflopStreet>('flop')
  const [hero, setHero] = useState<Position>('BB')
  const [villain, setVillain] = useState<Position>('BTN')
  const [potType, setPotType] = useState<PostflopPotType>('srp')
  const [aggressor, setAggressor] = useState<PreflopAggressor>('villain')
  const [board, setBoard] = useState<(Card | null)[]>([])
  const [cards, setCards] = useState<HoleCards>([null, null])
  const [linePreset, setLinePreset] = useState<PostflopActionLinePreset>('manual')
  const [potBb, setPotBb] = useState(5.5)
  const [facing, setFacing] = useState(false)
  const [villainBetBb, setVillainBetBb] = useState(3)
  const [heroFirstBetBb, setHeroFirstBetBb] = useState(3)
  const [villainRaiseBb, setVillainRaiseBb] = useState(9)
  const [heroBetChips, setHeroBetChips] = useState(400)

  const [equity, setEquity] = useState<Equity | null>(null)
  const [strategy, setStrategy] = useState<NodeStrategy | null>(null)
  const [solving, setSolving] = useState(false)

  const boardLen = POSTFLOP_BOARD_LEN[street]
  const boardCards = board.slice(0, boardLen).filter((c): c is Card => c !== null)
  const boardComplete = boardCards.length === boardLen
  const positionsOk = hero !== villain
  const boardKey = boardCards.join(',')

  const bothCards = cards[0] !== null && cards[1] !== null
  const heroHand = bothCards ? handClass(cards[0]!, cards[1]!) : null

  // The flop pot is deterministic from the pot type + seats; it seeds the pot
  // input and gives the natural default each time that structure changes.
  const flopPotChips = useMemo(
    () =>
      positionsOk
        ? buildPostflopLineNode({
            street: 'flop',
            hero,
            villain,
            potType,
            aggressor,
            board: [],
            potBeforeChips: 0,
            facingBetChips: 0,
          }).flopPotChips
        : 0,
    [hero, villain, potType, aggressor, positionsOk],
  )
  useEffect(() => {
    if (flopPotChips > 0) setPotBb(defaultPotBeforeLine(linePreset, flopPotChips) / BB_CHIPS)
  }, [flopPotChips, linePreset])

  useEffect(() => {
    if (!linePresetAllowedOnStreet(linePreset, street)) setLinePreset('manual')
  }, [linePreset, street])

  const setActionLine = (next: PostflopActionLinePreset) => {
    setLinePreset(next)
    const defaultStreet = defaultStreetForLine(next)
    if (defaultStreet) setStreet(defaultStreet)
  }

  const potMinChips = Math.max(flopPotChips || BB_CHIPS, minimumPotBeforeLine(linePreset, flopPotChips || BB_CHIPS))
  const potBeforeChips = Math.max(potMinChips, Math.round(potBb * BB_CHIPS))
  const heroFirstBetChips = roundChips(heroFirstBetBb * BB_CHIPS)
  const villainBetChips = roundChips(villainBetBb * BB_CHIPS)
  const villainRaiseChips = roundChips(villainRaiseBb * BB_CHIPS)
  const actionLine = useMemo(
    () =>
      buildPostflopActionLine({
        preset: linePreset,
        street,
        hero,
        villain,
        aggressor,
        manualFacingBet: facing,
        potBeforeChips,
        flopPotChips,
        villainBetChips,
        heroFirstBetChips,
        villainRaiseChips,
      }),
    [
      linePreset,
      street,
      hero,
      villain,
      aggressor,
      facing,
      potBeforeChips,
      flopPotChips,
      villainBetChips,
      heroFirstBetChips,
      villainRaiseChips,
    ],
  )

  // The fabricated node (null until the board is complete and seats are distinct).
  const lineNode = useMemo(() => {
    if (!boardComplete || !positionsOk) return null
    return buildPostflopLineNode({
      street,
      hero,
      villain,
      potType,
      aggressor,
      board: boardCards,
      potBeforeChips,
      actionLine,
    })
    // boardKey stands in for boardCards; the rest are primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, hero, villain, potType, aggressor, boardKey, potBeforeChips, actionLine, boardComplete, positionsOk])

  const node = lineNode?.node ?? null
  const facingBet = lineNode?.facingBet ?? false
  const heroCommittedChips = lineNode?.currentStreetHeroCommitmentChips ?? 0
  const villainCommittedChips = lineNode?.currentStreetVillainCommitmentChips ?? 0
  const effStackChips = lineNode?.effectiveStackChips ?? 0

  // Hero preview slider is a total current-street commitment. If the hero has
  // already bet and faces a raise, the max is current commitment plus stack behind.
  const heroBetMax = heroCommittedChips + effStackChips
  const heroBetMin = facingBet
    ? Math.min(lineNode?.minRaiseToChips ?? heroBetMax, heroBetMax)
    : Math.min(heroCommittedChips + BB_CHIPS, heroBetMax)
  const nodeKey = node
    ? `${node.street}|${node.heroPosition}|${node.board.join(',')}|${historyKey(node.history)}|${node.potChips}|${node.toCallChips}|${node.effectiveStackChips}`
    : ''
  useEffect(() => {
    if (!node) return
    const postCallPot = (node.potChips ?? 0) + (node.toCallChips ?? 0)
    const def = facingBet
      ? clamp(roundChips(villainCommittedChips + 0.75 * postCallPot), heroBetMin, heroBetMax)
      : clamp(roundChips(0.66 * (node.potChips ?? 0)), heroBetMin, heroBetMax)
    setHeroBetChips(def)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey])

  const heroBet = clamp(heroBetChips, heroBetMin, heroBetMax)
  const isAllInPreview = heroBetMax > 0 && heroBet >= heroBetMax - 1
  const previewFraction = node
    ? potFractionForBetTo(node.potChips ?? 0, node.toCallChips ?? 0, villainCommittedChips, heroBet)
    : 0

  // Equity: hero hand vs the villain's continuing (preflop chart) range on this
  // board. Independent of the bet sizing, so it does not re-run while you slide.
  useEffect(() => {
    if (!node || !bothCards) {
      setEquity(null)
      return
    }
    let cancelled = false
    void (async () => {
      const { villain: v, range } = await villainContinuingRange(node, strategyProvider)
      let eq: number | null = null
      if (range.length > 0) {
        const rng = createRng(`livePF:${node.heroPosition}:${boardKey}:${cards[0]}:${cards[1]}`)
        eq = equityVsRange([cards[0]!, cards[1]!], range, node.board, { iterations: 12_000, rng })?.equity ?? null
      }
      if (!cancelled) setEquity({ villain: v, equity: eq })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, bothCards, cards[0], cards[1]])

  // Solve: the GTO mix for the node, including the slider's exact size. Re-runs on
  // node changes and on the (snapped) bet size, with a cancel flag for stale runs.
  useEffect(() => {
    if (!node) {
      setStrategy(null)
      return
    }
    let cancelled = false
    setSolving(true)
    void (async () => {
      const extra = previewFraction > 0 ? [previewFraction] : []
      const s = await postflopProvider.getStrategyWithSizes(node, extra)
      if (!cancelled) {
        setStrategy(s)
        setSolving(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, previewFraction])

  // A hand class only has a solved row when it carries positive weight into the
  // flop — i.e. it actually plays this preflop line. Hands the chart 3-bets or
  // folds (AQo as a BB flat vs a BTN open) never reach here; flag that rather than
  // showing a misleading pure-fold mix.
  const heroInRange = Boolean(strategy && heroHand && strategy.grid[heroHand])
  const row: ActionFrequency[] | null =
    strategy && heroHand && heroInRange ? strategyForHand(strategy, heroHand) : null
  const potOdds = node && (node.toCallChips ?? 0) > 0 ? potOddsPct(node.toCallChips ?? 0, node.potChips ?? 0) : null
  const yourSize = row ? findYourSize(row, heroBet, isAllInPreview) : null

  const stats: Stat[] = [
    {
      label: 'Pot odds',
      value: potOdds != null ? `${(potOdds * 100).toFixed(0)}%` : '—',
      hint: facingBet ? 'equity to call' : 'no bet to face',
    },
    {
      label: 'Win chance',
      value: equity?.equity != null ? `${(equity.equity * 100).toFixed(0)}%` : '—',
      hint: equity?.villain ? `vs ${equity.villain} range` : bothCards ? '—' : 'pick your cards',
      tone: 'green',
    },
    {
      label: 'EV (approx)',
      value: row ? evHeadline(row) : '—',
      hint: 'baseline solver',
      tone: 'amber',
    },
  ]

  const spotId = node ? `postflop/${street}/${hero}v${villain}` : ''
  const aggLabels: { value: PreflopAggressor; label: string }[] =
    potType === '3bet'
      ? [
          { value: 'villain', label: 'Villain 3-bet' },
          { value: 'hero', label: 'You 3-bet' },
        ]
      : [
          { value: 'villain', label: 'Villain opened' },
          { value: 'hero', label: 'You opened' },
        ]
  const showVillainBetSlider = lineUsesVillainBetSlider(linePreset, aggressor, facing)
  const showHeroFacingRaiseSliders = linePreset === 'hero-bet-facing-raise'
  const villainBetLabel = currentVillainBetLabel(linePreset, aggressor)
  const heroLeadForRaise = Math.max(BB_CHIPS, heroFirstBetChips)
  const minVillainRaiseChips = Math.max(heroLeadForRaise + BB_CHIPS, 2 * heroLeadForRaise)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      {/* Left: inputs */}
      <section className="space-y-5">
        <div>
          <Label>Street</Label>
          <Segmented options={STREETS} value={street} onChange={setStreet} />
        </div>

        <div className="flex flex-wrap gap-6">
          <div>
            <Label>Your seat</Label>
            <Segmented
              options={POSITIONS_6MAX.map((p) => ({ value: p, label: p }))}
              value={hero}
              onChange={setHero}
              disabled={(p) => p === villain}
            />
          </div>
          <div>
            <Label>Villain seat</Label>
            <Segmented
              options={POSITIONS_6MAX.map((p) => ({ value: p, label: p }))}
              value={villain}
              onChange={setVillain}
              disabled={(p) => p === hero}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <div>
            <Label>Preflop pot</Label>
            <Segmented options={POT_TYPES} value={potType} onChange={setPotType} />
          </div>
          <div>
            <Label>Preflop aggressor</Label>
            <Segmented options={aggLabels} value={aggressor} onChange={setAggressor} />
          </div>
        </div>

        <div>
          <Label>Action line</Label>
          <Segmented options={ACTION_LINES} value={linePreset} onChange={setActionLine} />
          {lineNode && <p className="mt-2 text-xs text-slate-500">{lineNode.lineLabel}</p>}
        </div>

        <div>
          <Label>Board ({street})</Label>
          <BoardPicker
            value={board}
            count={boardLen}
            onChange={setBoard}
            exclude={new Set(cards.filter((c): c is Card => c !== null))}
          />
        </div>

        <div>
          <Label>Pot before current action</Label>
          <SliderRow
            min={potMinChips}
            max={20000}
            step={25}
            value={potBeforeChips}
            onChange={(chips) => setPotBb(chips / BB_CHIPS)}
            format={(chips) => `${bb(chips, BB_CHIPS)}bb`}
          />
        </div>

        {linePreset === 'manual' && (
          <div>
            <Label>Current action</Label>
            <Segmented
              options={[
                { value: 'first', label: 'Checked / first' },
                { value: 'bet', label: 'Villain bets' },
              ]}
              value={facing ? 'bet' : 'first'}
              onChange={(v) => setFacing(v === 'bet')}
            />
          </div>
        )}

        {showHeroFacingRaiseSliders && (
          <div className="space-y-3">
            <Label>Current action</Label>
            <SliderRow
              label="Your first bet"
              min={BB_CHIPS}
              max={Math.max(BB_CHIPS * 2, Math.round(2 * potBeforeChips))}
              step={25}
              value={heroLeadForRaise}
              onChange={(chips) => setHeroFirstBetBb(chips / BB_CHIPS)}
              format={(chips) => `${bb(chips, BB_CHIPS)}bb (${potPct(chips, potBeforeChips)})`}
            />
            <SliderRow
              label="Villain raises to"
              min={minVillainRaiseChips}
              max={Math.max(minVillainRaiseChips, Math.round(4 * potBeforeChips))}
              step={25}
              value={Math.max(villainRaiseChips, minVillainRaiseChips)}
              onChange={(chips) => setVillainRaiseBb(chips / BB_CHIPS)}
              format={(chips) => `${bb(chips, BB_CHIPS)}bb`}
              accent="red"
            />
          </div>
        )}

        {showVillainBetSlider && (
          <div>
            <Label>Current action</Label>
            <SliderRow
              label={villainBetLabel}
              min={25}
              max={Math.max(200, Math.round(3 * potBeforeChips))}
              step={25}
              value={villainBetChips}
              onChange={(chips) => setVillainBetBb(chips / BB_CHIPS)}
              format={(chips) => `${bb(chips, BB_CHIPS)}bb (${potPct(chips, potBeforeChips)})`}
              accent="red"
            />
          </div>
        )}

        <div>
          <Label>Your hand</Label>
          <CardPicker
            value={cards}
            onChange={setCards}
            exclude={new Set(boardCards)}
          />
        </div>
      </section>

      {/* Right: GTO answer */}
      <section className="space-y-4">
        {!positionsOk ? (
          <Panel>
            <p className="text-sm text-amber-300">Pick two different seats for you and the villain.</p>
          </Panel>
        ) : !boardComplete ? (
          <Panel>
            <p className="text-sm text-slate-400">
              Deal the {street} ({boardLen} cards) to solve. Then set the pot, villain’s action, and your hand.
            </p>
          </Panel>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">GTO · {spotId}</h2>
              {solving && <span className="text-xs text-slate-500">solving…</span>}
            </div>

            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
              Approximate baseline solver — EVs are estimates, not a true CFR solve (they become exact once the
              postflop-solver WASM is built). Frequencies and the mix are directional.
            </p>

            {heroHand && row ? (
              <>
                <Recommendation row={row} facing={facingBet} />
                <StatStrip stats={stats} />
                <BetSlider
                  facing={facingBet}
                  min={heroBetMin}
                  max={heroBetMax}
                  value={heroBet}
                  onChange={setHeroBetChips}
                  fraction={previewFraction}
                  yourSize={yourSize}
                  allIn={isAllInPreview}
                />
                <StrategyMix row={row} title={`${heroHand} mix`} />
                <ActionRandomizer row={row} />
              </>
            ) : heroHand && strategy && !heroInRange ? (
              <>
                <Panel>
                  <p className="text-sm text-amber-300">
                    <span className="font-semibold">{heroHand}</span> isn’t in {hero}’s range on this line — the
                    chart 3-bets or folds it preflop, so it never reaches this {street}. Win chance below assumes you
                    hold it; pick a hand that continues this line, or change the preflop pot to one that keeps it.
                  </p>
                </Panel>
                <StatStrip stats={stats} />
              </>
            ) : (
              <Panel>
                <p className="text-sm text-slate-400">
                  Pick your two cards for the action mix, equity, EV, and the bet-size preview. The chart below
                  shows the whole range.
                </p>
              </Panel>
            )}

            {strategy && <StrategyGrid strategy={strategy} highlight={heroHand ?? undefined} />}
          </>
        )}
      </section>
    </div>
  )
}

function defaultStreetForLine(preset: PostflopActionLinePreset): PostflopStreet | null {
  if (
    preset === 'flop-check-check' ||
    preset === 'flop-bet-call' ||
    preset === 'delayed-cbet' ||
    preset === 'probe'
  ) {
    return 'turn'
  }
  if (preset === 'turn-bet-call') return 'river'
  return null
}

function linePresetAllowedOnStreet(preset: PostflopActionLinePreset, street: PostflopStreet): boolean {
  const required = defaultStreetForLine(preset)
  return required === null || required === street
}

function defaultPotBeforeLine(preset: PostflopActionLinePreset, flopPotChips: number): number {
  if (flopPotChips <= 0) return BB_CHIPS
  if (preset === 'flop-bet-call' || preset === 'turn-bet-call') return roundChips(2 * flopPotChips)
  return flopPotChips
}

function minimumPotBeforeLine(preset: PostflopActionLinePreset, flopPotChips: number): number {
  if (flopPotChips <= 0) return BB_CHIPS
  if (preset === 'flop-bet-call' || preset === 'turn-bet-call') return flopPotChips + 2 * BB_CHIPS
  return flopPotChips
}

function historyKey(
  history: readonly { position: Position; street: string; action: { type: string; amount?: number } }[],
): string {
  return history.map((r) => `${r.street}:${r.position}:${r.action.type}:${r.action.amount ?? ''}`).join('>')
}

function lineUsesVillainBetSlider(
  preset: PostflopActionLinePreset,
  aggressor: PreflopAggressor,
  manualFacingBet: boolean,
): boolean {
  if (preset === 'manual') return manualFacingBet
  if (preset === 'villain-donk-bet') return true
  if (preset === 'delayed-cbet') return aggressor === 'villain'
  if (preset === 'probe') return aggressor === 'hero'
  return false
}

function currentVillainBetLabel(preset: PostflopActionLinePreset, aggressor: PreflopAggressor): string {
  if (preset === 'villain-donk-bet') return 'Villain donks to'
  if (preset === 'delayed-cbet' && aggressor === 'villain') return 'Villain c-bets to'
  if (preset === 'probe' && aggressor === 'hero') return 'Villain probes to'
  return 'Villain bets to'
}

interface ActionLineBuildOptions {
  preset: PostflopActionLinePreset
  street: PostflopStreet
  hero: Position
  villain: Position
  aggressor: PreflopAggressor
  manualFacingBet: boolean
  potBeforeChips: number
  flopPotChips: number
  villainBetChips: number
  heroFirstBetChips: number
  villainRaiseChips: number
}

function buildPostflopActionLine(opts: ActionLineBuildOptions): PostflopActionLine | undefined {
  const pfa = opts.aggressor === 'hero' ? 'hero' : 'villain'
  const nonPfa = otherActor(pfa)
  const villainBet = Math.max(25, opts.villainBetChips)

  if (opts.preset === 'manual') {
    if (!opts.manualFacingBet) return undefined
    return {
      preset: 'manual',
      label: 'Manual: villain bets',
      steps: currentBetSteps(opts.street, 'villain', villainBet, opts.hero, opts.villain),
    }
  }

  if (opts.preset === 'flop-check-check') {
    return {
      preset: opts.preset,
      label: 'Flop check-check -> turn',
      steps: checkCheckSteps('flop', opts.hero, opts.villain),
    }
  }

  if (opts.preset === 'flop-bet-call') {
    const bet = completedStreetBet(opts.potBeforeChips, opts.flopPotChips)
    return {
      preset: opts.preset,
      label: `${actorLabel(pfa)} bet flop, ${actorLabel(nonPfa).toLowerCase()} called -> turn`,
      steps: betCallSteps('flop', pfa, bet, opts.hero, opts.villain),
    }
  }

  if (opts.preset === 'turn-bet-call') {
    const bet = completedStreetBet(opts.potBeforeChips, opts.flopPotChips)
    return {
      preset: opts.preset,
      label: `Flop check-check, ${actorLabel(pfa).toLowerCase()} bet turn -> river`,
      steps: [...checkCheckSteps('flop', opts.hero, opts.villain), ...betCallSteps('turn', pfa, bet, opts.hero, opts.villain)],
    }
  }

  if (opts.preset === 'hero-bet-facing-raise') {
    const heroBet = Math.max(BB_CHIPS, opts.heroFirstBetChips)
    const raiseTo = Math.max(opts.villainRaiseChips, heroBet + BB_CHIPS, 2 * heroBet)
    const checksBeforeHero = isActorInPosition('hero', opts.hero, opts.villain)
      ? [step('villain', opts.street, 'check')]
      : []
    return {
      preset: opts.preset,
      label: 'You bet, villain raised',
      steps: [
        ...checksBeforeHero,
        step('hero', opts.street, 'bet', heroBet),
        step('villain', opts.street, 'raise', raiseTo),
      ],
    }
  }

  if (opts.preset === 'villain-donk-bet') {
    return {
      preset: opts.preset,
      label: 'Villain donk bet',
      steps: currentBetSteps(opts.street, 'villain', villainBet, opts.hero, opts.villain),
    }
  }

  if (opts.preset === 'delayed-cbet') {
    const turnSteps =
      pfa === 'villain'
        ? currentBetSteps(opts.street, 'villain', villainBet, opts.hero, opts.villain)
        : heroDecisionSteps(opts.street, opts.hero, opts.villain)
    return {
      preset: opts.preset,
      label: pfa === 'villain' ? 'Flop check-check, villain delayed c-bets' : 'Flop check-check, delayed c-bet node',
      steps: [...checkCheckSteps('flop', opts.hero, opts.villain), ...turnSteps],
    }
  }

  if (opts.preset === 'probe') {
    const turnSteps =
      nonPfa === 'villain'
        ? currentBetSteps(opts.street, 'villain', villainBet, opts.hero, opts.villain)
        : heroDecisionSteps(opts.street, opts.hero, opts.villain)
    return {
      preset: opts.preset,
      label: nonPfa === 'villain' ? 'Flop check-check, villain probes' : 'Flop check-check, probe node',
      steps: [...checkCheckSteps('flop', opts.hero, opts.villain), ...turnSteps],
    }
  }

  return undefined
}

function completedStreetBet(potBeforeChips: number, previousPotChips: number): number {
  return Math.max(BB_CHIPS, roundChips((potBeforeChips - previousPotChips) / 2))
}

function checkCheckSteps(street: PostflopStreet, hero: Position, villain: Position): PostflopActionStep[] {
  return [step(outOfPositionActor(hero, villain), street, 'check'), step(inPositionActor(hero, villain), street, 'check')]
}

function currentBetSteps(
  street: PostflopStreet,
  actor: PostflopActionActor,
  amountChips: number,
  hero: Position,
  villain: Position,
): PostflopActionStep[] {
  const before = isActorInPosition(actor, hero, villain) ? [step(outOfPositionActor(hero, villain), street, 'check')] : []
  return [...before, step(actor, street, 'bet', amountChips)]
}

function heroDecisionSteps(street: PostflopStreet, hero: Position, villain: Position): PostflopActionStep[] {
  return isActorInPosition('hero', hero, villain) ? [step('villain', street, 'check')] : []
}

function betCallSteps(
  street: PostflopStreet,
  bettor: PostflopActionActor,
  amountChips: number,
  hero: Position,
  villain: Position,
): PostflopActionStep[] {
  const caller = otherActor(bettor)
  const before = isActorInPosition(bettor, hero, villain) ? [step(outOfPositionActor(hero, villain), street, 'check')] : []
  return [...before, step(bettor, street, 'bet', amountChips), step(caller, street, 'call', amountChips)]
}

function step(
  actor: PostflopActionActor,
  street: PostflopStreet,
  action: PostflopActionStep['action'],
  amountChips?: number,
): PostflopActionStep {
  return amountChips === undefined ? { actor, street, action } : { actor, street, action, amountChips }
}

function otherActor(actor: PostflopActionActor): PostflopActionActor {
  return actor === 'hero' ? 'villain' : 'hero'
}

function actorLabel(actor: PostflopActionActor): string {
  return actor === 'hero' ? 'You' : 'Villain'
}

function outOfPositionActor(hero: Position, villain: Position): PostflopActionActor {
  return POSTFLOP_ORDER.indexOf(hero) < POSTFLOP_ORDER.indexOf(villain) ? 'hero' : 'villain'
}

function inPositionActor(hero: Position, villain: Position): PostflopActionActor {
  return otherActor(outOfPositionActor(hero, villain))
}

function isActorInPosition(actor: PostflopActionActor, hero: Position, villain: Position): boolean {
  return actor === inPositionActor(hero, villain)
}

/** A labeled slider with a live readout, used for pot / villain bet inputs. */
function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
  accent = 'amber',
}: {
  label?: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
  accent?: 'amber' | 'red'
}) {
  const v = clamp(value, min, max)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        {label && <span className="text-slate-400">{label}</span>}
        <span className="ml-auto font-mono text-slate-200">{format(v)}</span>
      </div>
      <input
        type="range"
        aria-label={label ?? 'value'}
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-1.5 w-full cursor-pointer ${accent === 'red' ? 'accent-red-500' : 'accent-amber-400'}`}
      />
    </div>
  )
}

/** The hero "preview my bet" slider + a readout of how GTO treats that exact size. */
function BetSlider({
  facing,
  min,
  max,
  value,
  onChange,
  fraction,
  yourSize,
  allIn,
}: {
  facing: boolean
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  fraction: number
  yourSize: ActionFrequency | null
  allIn: boolean
}) {
  const verb = facing ? 'Raise to' : 'Bet'
  const usable = max > min
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview my bet</span>
        <span className="font-mono text-sm text-slate-100">
          {allIn ? 'All-in' : `${verb} ${bb(value, BB_CHIPS)}bb`}
          <span className="ml-1 text-xs text-slate-500">({(fraction * 100).toFixed(0)}% pot)</span>
        </span>
      </div>
      {usable ? (
        <input
          type="range"
          aria-label="My bet size"
          min={min}
          max={max}
          step={25}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-red-500"
        />
      ) : (
        <p className="text-xs text-slate-500">No room to {facing ? 'raise' : 'bet'} — stacks are committed.</p>
      )}
      <div className="mt-2 text-xs">
        {yourSize ? (
          <span className="text-slate-300">
            GTO plays this size{' '}
            <span className="font-mono text-slate-100">{(yourSize.frequency * 100).toFixed(0)}%</span>
            {yourSize.ev !== undefined && (
              <>
                {' '}
                · EV{' '}
                <span className="font-mono text-slate-100">
                  {yourSize.ev >= 0 ? '+' : ''}
                  {yourSize.ev.toFixed(2)}bb
                </span>
              </>
            )}
          </span>
        ) : (
          <span className="text-slate-500">Slide to see how GTO treats that exact size.</span>
        )}
      </div>
    </div>
  )
}

/** One-line headline of the dominant GTO action at the node. */
function Recommendation({ row, facing }: { row: ActionFrequency[]; facing: boolean }) {
  const sorted = [...row].filter((a) => a.frequency > 0.005).sort((a, b) => b.frequency - a.frequency)
  const top = sorted[0]
  if (!top) return null
  const pure = top.frequency > 0.999
  const aggregateRaise = row
    .filter((a) => a.actionId === 'allIn' || a.actionId.startsWith('raiseTo:'))
    .reduce((s, a) => s + a.frequency, 0)
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
      <span className="text-amber-200">
        {pure ? 'Always ' : 'Mostly '}
        <span className="font-semibold text-amber-100">{actionLabel(top.actionId)}</span>
        {!pure && <span className="text-amber-200/80"> ({(top.frequency * 100).toFixed(0)}%)</span>}
        {!pure && aggregateRaise > 0.005 && !top.actionId.startsWith('raiseTo') && top.actionId !== 'allIn' && (
          <span className="text-amber-200/80"> · {facing ? 'raise' : 'bet'} {(aggregateRaise * 100).toFixed(0)}%</span>
        )}
      </span>
    </div>
  )
}

/**
 * The mix entry that best matches the previewed bet size. The solve is fed the
 * exact slider fraction, so a `raiseTo:` close to the target should exist; pick
 * the nearest one (or the all-in entry when the slider is maxed).
 */
function findYourSize(row: ActionFrequency[], targetChips: number, allIn: boolean): ActionFrequency | null {
  if (allIn) {
    const ai = row.find((a) => a.actionId === 'allIn')
    if (ai) return ai
  }
  const targetBb = targetChips / BB_CHIPS
  let best: ActionFrequency | null = null
  let bestDiff = Infinity
  for (const a of row) {
    if (!a.actionId.startsWith('raiseTo:')) continue
    const diff = Math.abs(Number(a.actionId.slice('raiseTo:'.length)) - targetBb)
    if (diff < bestDiff) {
      bestDiff = diff
      best = a
    }
  }
  return best
}

/** Headline EV: the EV of the action GTO takes most often. */
function evHeadline(row: ActionFrequency[]): string {
  const top = [...row].sort((a, b) => b.frequency - a.frequency)[0]
  if (!top || top.ev === undefined) return '—'
  return `${top.ev >= 0 ? '+' : ''}${top.ev.toFixed(2)}bb`
}

/** Format a bet as a percent of the given pot (chips). */
function potPct(betChips: number, potChips: number): string {
  if (potChips <= 0) return '—'
  return `${Math.round((betChips / potChips) * 100)}% pot`
}
