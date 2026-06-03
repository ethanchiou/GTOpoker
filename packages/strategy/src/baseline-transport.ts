import {
  allCards,
  categoryOf,
  createRng,
  evaluateHand,
  HandCategory,
  makeCard,
  rankOf,
  suitOf,
  type Card,
  type SeededRng,
} from '@gto/hand-eval'
import { handClass, rankIndex, type HandClass } from './hand-class'
import type { ComboStrategy, Range, SolveRequest, SolveResult, SolverTransport } from './postflop-types'
import type { ActionFrequency, ActionId } from './types'

/**
 * BASELINE postflop transport — a deliberately simple, clearly-labeled stand-in
 * for the real postflop-solver WASM. It is NOT a CFR equilibrium: it estimates
 * per-action EV from a one-shot showdown model driven by Monte-Carlo equity vs
 * the opponent's range, with a size-based fold-equity term, and turns those EVs
 * into a mixed strategy via a softmax. It exists so the full Phase-2 pipeline
 * (range handoff → provider → scoring → UI) runs and is verifiable today; the
 * WASM transport drops into the same `SolverTransport` interface and replaces
 * these approximate EVs with true equilibrium EVs, with zero consumer changes.
 *
 * Documented limitations (all resolved by the real solver):
 *  - one street of action only (no future-street range narrowing / implied odds),
 *    so all-in is gated to low SPR and value-when-called is a coarse continue-range
 *    scale rather than a solved future-EV;
 *  - equity is computed per hand class via a representative combo (no per-combo
 *    suit specificity beyond the class);
 *  - fold equity is a coarse function of bet size and the opponent's equity
 *    distribution, not a solved continue range.
 */

export interface BaselineOptions {
  /** Monte-Carlo iterations per class equity estimate. */
  iterations?: number
}

const DEFAULT_ITERATIONS = 500

/**
 * All-in is only offered when the effective stack is within this multiple of the
 * pot (i.e. low SPR). Higher-SPR spots — most flops — get sized bets/raises, not
 * jams; this is what stops the baseline from collapsing to "fold or all-in" on
 * early streets.
 */
const ALLIN_SPR_MAX = 2

type PostflopStreet = 'flop' | 'turn' | 'river'

interface BoardProfile {
  street: PostflopStreet
  paired: boolean
  twoTone: boolean
  monotone: boolean
  flushPossible: boolean
  straightiness: number
  wetness: number
}

interface HandFeatures {
  category: HandCategory
  madeStrength: number
  drawScore: number
  blockerScore: number
}

interface ClassContext {
  cls: HandClass
  equity: number
  percentile: number
  features: HandFeatures
}

interface VillainResponse {
  foldEquity: number
  continueScale: number
}

function round2(x: number): number {
  return Number(x.toFixed(2))
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x))
}

function clamp01(x: number): number {
  return clamp(x, 0, 1)
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function streetForBoard(board: readonly Card[]): PostflopStreet {
  if (board.length >= 5) return 'river'
  if (board.length === 4) return 'turn'
  return 'flop'
}

function maxStraightWindowHits(cards: readonly Card[]): number {
  const ranks = new Set(cards.map(rankOf))
  let best = 0
  for (let low = 0; low <= 8; low++) {
    let hits = 0
    for (let r = low; r < low + 5; r++) if (ranks.has(r)) hits++
    best = Math.max(best, hits)
  }
  // Wheel window A-2-3-4-5.
  let wheel = ranks.has(12) ? 1 : 0
  for (let r = 0; r <= 3; r++) if (ranks.has(r)) wheel++
  return Math.max(best, wheel)
}

function boardProfile(board: readonly Card[]): BoardProfile {
  const suitCounts = new Array<number>(4).fill(0)
  const rankCounts = new Array<number>(13).fill(0)
  for (const c of board) {
    suitCounts[suitOf(c)]!++
    rankCounts[rankOf(c)]!++
  }

  const maxSuit = Math.max(...suitCounts)
  const paired = rankCounts.some((n) => n >= 2)
  const straightiness = board.length === 0 ? 0 : maxStraightWindowHits(board) / Math.min(5, board.length)
  const twoTone = board.length === 3 && maxSuit === 2
  const monotone = board.length >= 3 && maxSuit >= 3
  const flushPossible = maxSuit >= 3
  const wetness = clamp01(
    (twoTone ? 0.2 : 0) +
      (monotone ? 0.35 : 0) +
      (flushPossible && board.length > 3 ? 0.2 : 0) +
      straightiness * 0.35 -
      (paired ? 0.08 : 0),
  )

  return { street: streetForBoard(board), paired, twoTone, monotone, flushPossible, straightiness, wetness }
}

function madeStrength(category: HandCategory): number {
  switch (category) {
    case HandCategory.StraightFlush:
    case HandCategory.Quads:
      return 1
    case HandCategory.FullHouse:
      return 0.96
    case HandCategory.Flush:
      return 0.9
    case HandCategory.Straight:
      return 0.84
    case HandCategory.Trips:
      return 0.72
    case HandCategory.TwoPair:
      return 0.56
    case HandCategory.Pair:
      return 0.34
    default:
      return 0.08
  }
}

function drawScore(hero: readonly [Card, Card], board: readonly Card[]): number {
  if (board.length >= 5) return 0

  const cards = [...hero, ...board]
  const suitCounts = new Array<number>(4).fill(0)
  for (const c of cards) suitCounts[suitOf(c)]!++
  const maxSuit = Math.max(...suitCounts)
  const flushDraw = maxSuit >= 4 ? 0.45 : board.length === 3 && maxSuit === 3 ? 0.12 : 0

  const straightHits = maxStraightWindowHits(cards)
  const straightDraw = straightHits >= 4 ? 0.35 : board.length === 3 && straightHits === 3 ? 0.12 : 0

  const boardMax = Math.max(...board.map(rankOf))
  const overcards = hero.filter((c) => rankOf(c) > boardMax).length
  const overcardScore = board.length === 3 ? overcards * 0.08 : overcards * 0.04

  return clamp01(flushDraw + straightDraw + overcardScore)
}

function blockerScore(hero: readonly [Card, Card], board: readonly Card[], profile: BoardProfile): number {
  if (board.length < 5) return 0

  let score = 0
  if (profile.flushPossible) {
    const boardSuits = new Array<number>(4).fill(0)
    for (const c of board) boardSuits[suitOf(c)]!++
    const flushSuit = boardSuits.findIndex((n) => n >= 3)
    if (flushSuit >= 0) {
      for (const c of hero) {
        if (suitOf(c) === flushSuit && rankOf(c) >= 10) score += 0.25
      }
    }
  }
  if (profile.straightiness >= 0.8) {
    for (const c of hero) if (rankOf(c) >= 9) score += 0.1
  }
  return clamp01(score)
}

function handFeatures(hero: readonly [Card, Card], board: readonly Card[], profile: BoardProfile): HandFeatures {
  const category = categoryOf(evaluateHand([hero[0], hero[1], ...board]))
  return {
    category,
    madeStrength: madeStrength(category),
    drawScore: drawScore(hero, board),
    blockerScore: blockerScore(hero, board, profile),
  }
}

function fallbackFeatures(profile: BoardProfile): HandFeatures {
  return {
    category: HandCategory.HighCard,
    madeStrength: 0.08,
    drawScore: profile.street === 'river' ? 0 : 0.05,
    blockerScore: 0,
  }
}

/** A concrete combo representing a hand class, choosing suits not on the board. */
function representativeCombo(cls: HandClass, board: readonly Card[]): [Card, Card] | null {
  const onBoard = new Set(board)
  const r1 = rankIndex(cls[0]!)
  const r2 = rankIndex(cls[1]!)
  const suited = cls.length === 3 && cls[2] === 's'
  const pair = cls.length === 2

  if (pair) {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) {
        const a = makeCard(r1, s1)
        const b = makeCard(r1, s2)
        if (!onBoard.has(a) && !onBoard.has(b)) return [a, b]
      }
    }
    return null
  }

  if (suited) {
    for (let s = 0; s < 4; s++) {
      const a = makeCard(r1, s)
      const b = makeCard(r2, s)
      if (!onBoard.has(a) && !onBoard.has(b)) return [a, b]
    }
    return null
  }

  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (s1 === s2) continue
      const a = makeCard(r1, s1)
      const b = makeCard(r2, s2)
      if (!onBoard.has(a) && !onBoard.has(b)) return [a, b]
    }
  }
  return null
}

interface ClassMass {
  cls: HandClass
  /** Total range mass for the class (per-combo weight × combos). */
  mass: number
}

/** Collapse a combo range to per-class mass (probability the player holds the class). */
function classMasses(range: Range): ClassMass[] {
  const byClass = new Map<HandClass, number>()
  for (const { hand, weight } of range) {
    const cls = handClass(hand[0], hand[1])
    byClass.set(cls, (byClass.get(cls) ?? 0) + weight)
  }
  return [...byClass.entries()].map(([cls, mass]) => ({ cls, mass }))
}

/** Weighted sampler over class representatives (returns a concrete combo). */
function makeSampler(masses: ClassMass[], board: readonly Card[], rng: SeededRng): () => [Card, Card] | null {
  const reps: Array<{ combo: [Card, Card] | null; cum: number }> = []
  let total = 0
  for (const { cls, mass } of masses) {
    total += mass
    reps.push({ combo: representativeCombo(cls, board), cum: total })
  }
  return () => {
    if (total <= 0) return null
    const x = rng.nextFloat() * total
    for (const r of reps) if (x <= r.cum) return r.combo
    return reps[reps.length - 1]!.combo
  }
}

function sampleBoardCompletion(dead: Set<Card>, need: number, rng: SeededRng): Card[] {
  const pool = allCards().filter((c) => !dead.has(c))
  for (let i = 0; i < need; i++) {
    const j = i + rng.nextInt(pool.length - i)
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }
  return pool.slice(0, need)
}

/** Monte-Carlo equity of a concrete combo vs a sampled opponent range. */
function equityVsRange(
  hero: [Card, Card],
  sampleOpp: () => [Card, Card] | null,
  board: readonly Card[],
  iterations: number,
  rng: SeededRng,
): number {
  const need = 5 - board.length
  let win = 0
  let tie = 0
  let valid = 0
  for (let i = 0; i < iterations; i++) {
    const opp = sampleOpp()
    if (!opp) continue
    if (opp[0] === hero[0] || opp[0] === hero[1] || opp[1] === hero[0] || opp[1] === hero[1]) continue
    if (board.includes(opp[0]) || board.includes(opp[1])) continue
    const dead = new Set<Card>([...hero, ...opp, ...board])
    const completion = sampleBoardCompletion(dead, need, rng)
    const full = [...board, ...completion]
    const h = evaluateHand([hero[0], hero[1], ...full])
    const o = evaluateHand([opp[0], opp[1], ...full])
    if (h > o) win++
    else if (h === o) tie++
    valid++
  }
  return valid === 0 ? 0.5 : (win + tie / 2) / valid
}

/**
 * EV (bb) of an aggressive action (bet or raise) in the baseline one-shot model.
 * `heroAdd` and `villainAddWhenCalled` are incremental chips from this decision,
 * not total street commitments, so check-raises and later re-raises size
 * correctly once prior street commitments are present in the request.
 */
function aggroEv(
  eCalled: number,
  potBb: number,
  heroAdd: number,
  villainAddWhenCalled: number,
  fe: number,
): number {
  const finalPot = potBb + heroAdd + villainAddWhenCalled
  return fe * potBb + (1 - fe) * (eCalled * finalPot - heroAdd)
}

/** Convert action EVs to a mixed strategy via prior-weighted softmax. */
function strategyMix(evs: number[], priors: number[], tau: number): number[] {
  const best = Math.max(...evs)
  const cutoff = best - Math.max(1.2, 4 * tau)
  const weights = evs.map((ev, i) => (ev < cutoff ? 0 : priors[i]! * Math.exp((ev - best) / tau)))
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0) return evs.map((_, i) => (i === evs.indexOf(best) ? 1 : 0))
  return weights.map((w) => w / sum)
}

function roundedFrequencies(freqs: readonly number[]): number[] {
  const rounded = freqs.map(round2)
  const sum = round2(rounded.reduce((s, f) => s + f, 0))
  if (rounded.length === 0 || sum === 1) return rounded
  let best = 0
  for (let i = 1; i < freqs.length; i++) if (freqs[i]! > freqs[best]!) best = i
  rounded[best] = round2(clamp01(rounded[best]! + (1 - sum)))
  return rounded
}

function checkRealization(profile: BoardProfile, heroIsOop: boolean, features: HandFeatures): number {
  if (profile.street === 'river') return heroIsOop ? 0.94 : 0.99
  return clamp((heroIsOop ? 0.82 : 0.94) + features.drawScore * 0.08 - profile.wetness * 0.04, 0.68, 1.02)
}

function callRealization(profile: BoardProfile, heroIsOop: boolean, features: HandFeatures): number {
  if (profile.street === 'river') return 1
  return clamp((heroIsOop ? 0.88 : 0.97) + features.drawScore * 0.08 - profile.wetness * 0.03, 0.72, 1.05)
}

function foldPrior(ctx: ClassContext, potOdds: number, profile: BoardProfile): number {
  const underPriced = smoothstep(-0.08, 0.18, potOdds - ctx.equity)
  const weakNoDraw = (1 - ctx.features.madeStrength) * (1 - ctx.features.drawScore)
  const streetFactor = profile.street === 'river' ? 1.35 : profile.street === 'turn' ? 1.05 : 0.85
  const value = 0.04 + streetFactor * (0.85 * underPriced + 0.55 * (1 - ctx.percentile) * weakNoDraw)
  return clamp(value - ctx.features.drawScore * 0.45, 0.02, 2.8)
}

function callPrior(ctx: ClassContext, potOdds: number, profile: BoardProfile): number {
  const priceOk = smoothstep(-0.12, 0.18, ctx.equity - potOdds)
  const middle = clamp01(1 - Math.abs(ctx.percentile - 0.55) / 0.55)
  const topRangePenalty = smoothstep(0.86, 1, ctx.percentile)
  const streetBonus = profile.street === 'river' ? ctx.features.madeStrength * 0.55 : ctx.features.drawScore * 0.65
  return clamp(0.08 + priceOk * 1.15 + middle * 1.1 + streetBonus - topRangePenalty * 0.75, 0.03, 3.2)
}

function checkPrior(ctx: ClassContext, profile: BoardProfile, heroIsOop: boolean): number {
  const middle = clamp01(1 - Math.abs(ctx.percentile - 0.52) / 0.55)
  const topRangePenalty = smoothstep(profile.street === 'river' ? 0.88 : 0.84, 1, ctx.percentile)
  const showdown = profile.street === 'river' ? ctx.features.madeStrength * 0.7 : ctx.features.drawScore * 0.45
  return clamp(0.1 + middle * 1.35 + (heroIsOop ? 0.45 : 0.8) + showdown - topRangePenalty * 0.85, 0.04, 3.4)
}

function preferredFraction(ctx: ClassContext, profile: BoardProfile): number {
  const polar =
    ctx.percentile > (profile.street === 'river' ? 0.88 : profile.street === 'turn' ? 0.84 : 0.78) ||
    (profile.street === 'river'
      ? ctx.features.blockerScore > 0.15 && ctx.percentile < 0.4
      : ctx.features.drawScore > 0.35 && ctx.percentile < 0.82)

  if (profile.street === 'flop') return polar ? 0.75 : 0.33
  if (profile.street === 'turn') return polar ? 1.25 : 0.75
  return polar ? 1.5 : 1
}

function aggressivePrior(ctx: ClassContext, profile: BoardProfile, fraction: number, facingBet: boolean): number {
  const valueCutoff = profile.street === 'river' ? 0.88 : profile.street === 'turn' ? 0.83 : 0.75
  const value = smoothstep(valueCutoff, 1, ctx.percentile) * (0.8 + ctx.features.madeStrength)
  const semiBluff =
    profile.street === 'river'
      ? 0
      : ctx.features.drawScore *
        (0.35 + 0.65 * smoothstep(0.2, 0.75, ctx.percentile)) *
        (1 - smoothstep(0.82, 1, ctx.percentile)) *
        (facingBet ? 1.1 : 0.9)
  const riverBluff =
    profile.street === 'river'
      ? ctx.features.blockerScore * smoothstep(0, 0.38, 0.38 - ctx.percentile) * (1 - ctx.features.madeStrength)
      : 0
  const merged =
    profile.street === 'flop'
      ? smoothstep(0.58, 0.82, ctx.percentile) * 0.35 * (1 - profile.wetness)
      : profile.street === 'turn'
        ? smoothstep(0.7, 0.86, ctx.percentile) * 0.18
        : 0
  const target = preferredFraction(ctx, profile)
  const sizeBias = Math.exp(-Math.abs(Math.log(clamp(fraction, 0.05, 4) / target)) * (profile.street === 'flop' ? 1 : 1.35))
  return clamp(0.015 + (value + semiBluff + riverBluff + merged) * sizeBias * (facingBet ? 1.35 : 1.1), 0.005, 4)
}

function aggressionReadiness(ctx: ClassContext, profile: BoardProfile): number {
  const valueCutoff = profile.street === 'river' ? 0.88 : profile.street === 'turn' ? 0.83 : 0.75
  const value = smoothstep(valueCutoff, 1, ctx.percentile) * (0.75 + ctx.features.madeStrength)
  const draw =
    profile.street === 'river'
      ? ctx.features.blockerScore * smoothstep(0, 0.38, 0.38 - ctx.percentile)
      : ctx.features.drawScore *
        (0.35 + 0.65 * smoothstep(0.2, 0.78, ctx.percentile)) *
        (1 - smoothstep(0.86, 1, ctx.percentile))
  const merged = profile.street === 'flop' ? smoothstep(0.62, 0.82, ctx.percentile) * 0.25 * (1 - profile.wetness) : 0
  return clamp01(value + draw + merged)
}

function aggressionRiskPenalty(ctx: ClassContext, profile: BoardProfile, fraction: number, potBb: number): number {
  const streetFactor = profile.street === 'river' ? 0.42 : profile.street === 'turn' ? 0.22 : 0.12
  const pressure = clamp(fraction, 0.35, 2)
  return (1 - aggressionReadiness(ctx, profile)) * streetFactor * pressure * potBb
}

interface ClassStrategyParams {
  ctx: ClassContext
  profile: BoardProfile
  potBb: number
  toCallBb: number
  heroCommittedBb: number
  villainCommittedBb: number
  maxHeroInvestBb: number
  minRaiseToBb: number
  betFractions: readonly number[]
  tau: number
  heroIsOop: boolean
  responseFor: (threshold: number, potFraction: number) => VillainResponse
}

export class BaselineSolverTransport implements SolverTransport {
  private readonly iterations: number

  constructor(opts: BaselineOptions = {}) {
    this.iterations = opts.iterations ?? DEFAULT_ITERATIONS
  }

  async solve(req: SolveRequest): Promise<SolveResult> {
    const { board, heroRange, villainRange } = req
    const bb = req.bigBlindChips
    const potBb = req.potChips / bb
    const toCallBb = req.toCallChips / bb
    const stackBb = req.effectiveStackChips / bb
    const heroCommittedBb = (req.heroCommittedThisStreetChips ?? 0) / bb
    const villainCommittedBb = (req.villainCommittedThisStreetChips ?? req.toCallChips) / bb
    const maxHeroInvestBb = heroCommittedBb + stackBb
    const minRaiseToBb =
      req.minRaiseToChips !== undefined
        ? req.minRaiseToChips / bb
        : toCallBb > 0
          ? villainCommittedBb + 1
          : heroCommittedBb + 1
    const profile = boardProfile(board)

    // Deterministic per-node seed → reproducible EVs and a sound solve cache.
    const seed = `pf:${profile.street}:${board.join('.')}:${heroRange.length}x${villainRange.length}:${req.potChips}:${req.toCallChips}:${req.heroCommittedThisStreetChips ?? 0}:${req.villainCommittedThisStreetChips ?? 0}`
    const rng = createRng(seed)

    const heroMasses = classMasses(heroRange)
    const villainMasses = classMasses(villainRange)
    const totalVillainMass = villainMasses.reduce((s, m) => s + m.mass, 0) || 1

    const sampleVillain = makeSampler(villainMasses, board, rng)
    const sampleHero = makeSampler(heroMasses, board, rng)

    // Equity of each villain class vs the hero range → fold-equity model.
    const villainEquity = new Map<HandClass, number>()
    for (const { cls } of villainMasses) {
      const rep = representativeCombo(cls, board)
      villainEquity.set(cls, rep ? equityVsRange(rep, sampleHero, board, this.iterations, rng) : 0.5)
    }
    const responseFor = (threshold: number, potFraction: number): VillainResponse => {
      let folding = 0
      let continuing = 0
      let eqSum = 0
      const width =
        profile.street === 'river'
          ? 0.055
          : profile.street === 'turn'
            ? 0.075 + profile.wetness * 0.02
            : 0.105 + profile.wetness * 0.03
      const thresholdAdj =
        threshold +
        (profile.street === 'river' ? 0.018 * potFraction : -0.02) -
        (profile.street !== 'river' ? profile.wetness * 0.025 : 0)
      for (const { cls, mass } of villainMasses) {
        const villainEq = villainEquity.get(cls) ?? 0.5
        const foldProb = clamp(sigmoid((thresholdAdj - villainEq) / width), 0, 0.98)
        const continueMass = mass * (1 - foldProb)
        folding += mass * foldProb
        continuing += continueMass
        eqSum += continueMass * (1 - villainEq)
      }
      const cap = profile.street === 'river' ? 0.86 : profile.street === 'turn' ? 0.78 : 0.7
      const foldEquity = Math.min(cap, folding / totalVillainMass)
      const continueScale =
        continuing <= 0 || avgHeroEqVsFull <= 0 ? 1 : clamp(eqSum / continuing / avgHeroEqVsFull, 0.35, 1.08)
      return { foldEquity, continueScale }
    }

    // Hero's showdown equity vs the *continuing* (non-folding) part of the villain
    // range, relative to the full range. Larger sizes fold out more weak hands, so
    // the calling range is stronger and this scale shrinks — the asymmetry that
    // makes medium bets (not always the max) best for value (villain equity vs the
    // hero range is used as a proxy for hero equity, 1 − villainEquity).
    const avgHeroEqVsFull =
      totalVillainMass > 0
        ? villainMasses.reduce((s, { cls, mass }) => s + mass * (1 - (villainEquity.get(cls) ?? 0.5)), 0) /
          totalVillainMass
        : 0.5
    const contexts = new Map<HandClass, ClassContext>()
    const equityRows = heroMasses.map(({ cls }) => {
      const rep = representativeCombo(cls, board)
      const equity = rep ? equityVsRange(rep, sampleVillain, board, this.iterations, rng) : 0.5
      const features = rep ? handFeatures(rep, board, profile) : fallbackFeatures(profile)
      return { cls, equity, features }
    })
    const sorted = [...equityRows].sort((a, b) => a.equity - b.equity)
    const denom = Math.max(1, sorted.length - 1)
    sorted.forEach((row, i) => {
      contexts.set(row.cls, { ...row, percentile: i / denom })
    })

    const tau = Math.max(
      profile.street === 'river' ? 0.55 : 0.75,
      Math.min(4, potBb * (profile.street === 'river' ? 0.12 : profile.street === 'turn' ? 0.16 : 0.22)),
    )
    const strategyByClass = new Map<HandClass, ActionFrequency[]>()

    for (const { cls } of heroMasses) {
      const ctx = contexts.get(cls) ?? {
        cls,
        equity: 0.5,
        percentile: 0.5,
        features: fallbackFeatures(profile),
      }
      strategyByClass.set(
        cls,
        this.classStrategy({
          ctx,
          profile,
          potBb,
          toCallBb,
          heroCommittedBb,
          villainCommittedBb,
          maxHeroInvestBb,
          minRaiseToBb,
          betFractions: req.betFractions,
          tau,
          heroIsOop: req.heroIsOop ?? false,
          responseFor,
        }),
      )
    }

    const hero: ComboStrategy[] = heroRange.map(({ hand }) => ({
      hand,
      actions: strategyByClass.get(handClass(hand[0], hand[1])) ?? [{ actionId: 'fold', frequency: 1, ev: 0 }],
    }))

    return { hero, meta: { confidence: 'low', approximate: true, label: 'baseline' } }
  }

  private classStrategy(params: ClassStrategyParams): ActionFrequency[] {
    const {
      ctx,
      profile,
      potBb,
      toCallBb,
      heroCommittedBb,
      villainCommittedBb,
      maxHeroInvestBb,
      minRaiseToBb,
      betFractions,
      tau,
      heroIsOop,
      responseFor,
    } = params
    const e = ctx.equity
    const ids: ActionId[] = []
    const evs: number[] = []
    const priors: number[] = []
    const facingBet = toCallBb > 0
    const potOdds = facingBet ? toCallBb / (potBb + toCallBb) : 0

    const add = (actionId: ActionId, ev: number, prior: number): void => {
      ids.push(actionId)
      evs.push(ev)
      priors.push(prior)
    }

    const aggro = (heroInvest: number, potFraction: number): number | null => {
      const heroAdd = heroInvest - heroCommittedBb
      const villainAdd = Math.max(0, heroInvest - villainCommittedBb)
      if (heroAdd <= 0 || villainAdd <= 0) return null

      const finalPot = potBb + heroAdd + villainAdd
      const threshold = villainAdd / finalPot
      const response = responseFor(threshold, potFraction)
      const discount = 1 - (1 - response.continueScale) * (1 - 0.5 * ctx.percentile)
      const eCalled = clamp01(e * discount + (profile.street === 'river' ? 0 : ctx.features.drawScore * 0.02))
      return aggroEv(eCalled, potBb, heroAdd, villainAdd, response.foldEquity)
    }

    if (!facingBet) {
      add('check', e * potBb * checkRealization(profile, heroIsOop, ctx.features), checkPrior(ctx, profile, heroIsOop))
    } else {
      add('fold', 0, foldPrior(ctx, potOdds, profile))
      const realizedEquity = clamp01(e * callRealization(profile, heroIsOop, ctx.features))
      add('call', realizedEquity * (potBb + toCallBb) - toCallBb, callPrior(ctx, potOdds, profile))
    }

    // Sized bets/raises from the pot-fraction tree. Facing a bet, the fraction
    // applies to the post-call pot and the resulting amount is a raise-to total.
    const seen = new Set<number>()
    for (const f of betFractions) {
      const rawInvest = facingBet ? villainCommittedBb + f * (potBb + toCallBb) : heroCommittedBb + f * potBb
      const heroInvest = round2(Math.max(minRaiseToBb, rawInvest))
      if (heroInvest <= heroCommittedBb || heroInvest <= villainCommittedBb || heroInvest >= maxHeroInvestBb || seen.has(heroInvest)) {
        continue
      }
      const ev = aggro(heroInvest, f)
      if (ev === null) continue
      const strategicEv = ev - aggressionRiskPenalty(ctx, profile, f, potBb)
      seen.add(heroInvest)
      add(`raiseTo:${heroInvest}`, strategicEv, aggressivePrior(ctx, profile, f, facingBet))
    }

    // All-in only at low/medium SPR; otherwise early streets collapse to jams.
    const allInSprMax = profile.street === 'river' ? ALLIN_SPR_MAX + 1.2 : profile.street === 'turn' ? ALLIN_SPR_MAX + 0.6 : ALLIN_SPR_MAX
    if (
      maxHeroInvestBb > Math.max(heroCommittedBb, villainCommittedBb) &&
      maxHeroInvestBb - heroCommittedBb <= allInSprMax * potBb &&
      !seen.has(round2(maxHeroInvestBb))
    ) {
      const allInFraction = facingBet
        ? (maxHeroInvestBb - villainCommittedBb) / (potBb + toCallBb)
        : (maxHeroInvestBb - heroCommittedBb) / potBb
      const ev = aggro(maxHeroInvestBb, allInFraction)
      if (ev !== null) {
        add(
          'allIn',
          ev - aggressionRiskPenalty(ctx, profile, allInFraction, potBb),
          aggressivePrior(ctx, profile, allInFraction, facingBet),
        )
      }
    }

    const freqs = roundedFrequencies(strategyMix(evs, priors, tau))
    return ids.map((actionId, i) => ({ actionId, frequency: freqs[i]!, ev: round2(evs[i]!) }))
  }
}
