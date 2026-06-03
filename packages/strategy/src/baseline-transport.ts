import { allCards, createRng, evaluateHand, makeCard, type Card, type SeededRng } from '@gto/hand-eval'
import { comboCount, handClass, rankIndex, type HandClass } from './hand-class'
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

function round2(x: number): number {
  return Number(x.toFixed(2))
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
 * EV (bb) of an aggressive action (bet or raise) in the baseline one-shot model:
 * villain folds with probability `fe` (hero wins the current pot), else calls and
 * goes to showdown. `heroInvest` is the hero's total street commitment (the
 * raise-TO amount); `toCallBb` is what the hero faced (0 for a first bet).
 * `eCalled` is the hero's showdown equity *against the range that continues* —
 * lower than the full-range equity for larger sizes, which is what makes medium
 * sizings (not always the max) best.
 */
function aggroEv(eCalled: number, potBb: number, heroInvest: number, toCallBb: number, fe: number): number {
  const finalPot = potBb + 2 * heroInvest - toCallBb
  return fe * potBb + (1 - fe) * (eCalled * finalPot - heroInvest)
}

/** Convert action EVs to a mixed strategy via softmax, zeroing clearly-dominated actions. */
function softmaxMix(evs: number[], tau: number): number[] {
  const best = Math.max(...evs)
  const cutoff = best - 3 * tau
  const weights = evs.map((ev) => (ev < cutoff ? 0 : Math.exp((ev - best) / tau)))
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0) return evs.map((_, i) => (i === evs.indexOf(best) ? 1 : 0))
  return weights.map((w) => w / sum)
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

    // Deterministic per-node seed → reproducible EVs and a sound solve cache.
    const seed = `pf:${board.join('.')}:${heroRange.length}x${villainRange.length}:${req.potChips}:${req.toCallChips}`
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
    const foldEquityForThreshold = (threshold: number): number => {
      let folding = 0
      for (const { cls, mass } of villainMasses) {
        if ((villainEquity.get(cls) ?? 0.5) < threshold) folding += mass
      }
      return Math.min(0.85, folding / totalVillainMass)
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
    const continueScale = (threshold: number): number => {
      let contMass = 0
      let eqSum = 0
      for (const { cls, mass } of villainMasses) {
        const v = villainEquity.get(cls) ?? 0.5
        if (v >= threshold) {
          contMass += mass
          eqSum += mass * (1 - v)
        }
      }
      if (contMass <= 0 || avgHeroEqVsFull <= 0) return 1
      return Math.min(1, eqSum / contMass / avgHeroEqVsFull)
    }

    const tau = Math.max(1.5, 0.3 * potBb)
    const strategyByClass = new Map<HandClass, ActionFrequency[]>()

    for (const { cls } of heroMasses) {
      const rep = representativeCombo(cls, board)
      const e = rep ? equityVsRange(rep, sampleVillain, board, this.iterations, rng) : 0.5
      strategyByClass.set(
        cls,
        this.classStrategy(e, potBb, toCallBb, stackBb, req.betFractions, tau, foldEquityForThreshold, continueScale),
      )
    }

    const hero: ComboStrategy[] = heroRange.map(({ hand }) => ({
      hand,
      actions: strategyByClass.get(handClass(hand[0], hand[1])) ?? [{ actionId: 'fold', frequency: 1, ev: 0 }],
    }))

    return { hero, meta: { confidence: 'low', approximate: true, label: 'baseline' } }
  }

  private classStrategy(
    e: number,
    potBb: number,
    toCallBb: number,
    stackBb: number,
    betFractions: readonly number[],
    tau: number,
    fe: (threshold: number) => number,
    continueScale: (threshold: number) => number,
  ): ActionFrequency[] {
    const ids: ActionId[] = []
    const evs: number[] = []

    // EV of committing `heroInvest` bb now as a bet/raise (the raise-TO amount).
    // Returns null when it is not a strictly aggressive size (≤ the call).
    const aggro = (heroInvest: number): number | null => {
      const facing = heroInvest - toCallBb // chips the villain must call beyond its own bet
      if (facing <= 0) return null
      const threshold = facing / (potBb + heroInvest + facing) // villain's break-even calling equity
      const eCalled = e * continueScale(threshold)
      return aggroEv(eCalled, potBb, heroInvest, toCallBb, fe(threshold))
    }

    if (toCallBb <= 0) {
      ids.push('check')
      evs.push(e * potBb)
    } else {
      ids.push('fold')
      evs.push(0)
      ids.push('call')
      evs.push(e * (potBb + toCallBb) - toCallBb)
    }

    // Sized bets/raises from the pot-fraction tree. A raise is sized as the call
    // plus a pot-fraction of the post-call pot — a real raise-TO amount — so bots
    // can raise (and check-raise) facing a bet, not only fold/call.
    const seen = new Set<number>()
    for (const f of betFractions) {
      const heroInvest = round2(toCallBb <= 0 ? f * potBb : toCallBb + f * (potBb + toCallBb))
      if (heroInvest <= toCallBb || heroInvest >= stackBb || seen.has(heroInvest)) continue
      const ev = aggro(heroInvest)
      if (ev === null) continue
      seen.add(heroInvest)
      ids.push(`raiseTo:${heroInvest}`)
      evs.push(ev)
    }

    // All-in only at low SPR (see ALLIN_SPR_MAX); otherwise early streets collapse
    // to fold-or-jam instead of mixing real sizings.
    if (stackBb > toCallBb && stackBb <= ALLIN_SPR_MAX * potBb && !seen.has(round2(stackBb))) {
      const ev = aggro(stackBb)
      if (ev !== null) {
        ids.push('allIn')
        evs.push(ev)
      }
    }

    const freqs = softmaxMix(evs, tau)
    return ids.map((actionId, i) => ({ actionId, frequency: round2(freqs[i]!), ev: round2(evs[i]!) }))
  }
}
