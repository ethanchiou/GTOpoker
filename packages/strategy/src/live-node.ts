import { DEFAULT_TABLE_CONFIG, POSITIONS_6MAX, type Position } from '@gto/domain-config'
import type { Card } from '@gto/hand-eval'
import type { Action, ActionRecord, GameNodeKey, Street } from '@gto/poker-engine'

/**
 * Fabricate a `GameNodeKey` (plus chip context) for an arbitrary preflop line
 * *without playing a hand* — the node builder behind the Live Solver. The line is
 * one of: hero opens first-in (RFI), hero faces a single opener (vs-RFI), or hero
 * (the opener) faces a 3-bet (vs-3bet). It maps 1:1 onto `classifyPreflop` spot
 * ids, so the same chart provider that grades real hands serves these nodes.
 *
 * Pot / to-call / effective-stack are deterministic from the blinds and the
 * standard open/3-bet sizes below (kept aligned with the seed charts so the
 * villain-range read lands on the charted action; `recordedActionId` snaps anyway).
 * Kept street-agnostic in spirit: a later postflop build adds a board + bet inputs
 * rather than reworking this shape.
 */

const BB = DEFAULT_TABLE_CONFIG.bigBlindChips
const SB = DEFAULT_TABLE_CONFIG.smallBlindChips
const STACK = DEFAULT_TABLE_CONFIG.startingStackChips

/** Preflop action order (UTG first ... BB last); openers act before the hero, 3-bettors after. */
const ORDER = POSITIONS_6MAX

export type PreflopLine =
  | { kind: 'rfi'; hero: Position }
  | { kind: 'vsRfi'; hero: Position; opener: Position }
  /** Hero is the opener facing a 3-bet from `threeBettor`. */
  | { kind: 'vs3bet'; hero: Position; threeBettor: Position }

export interface PreflopLineNode {
  node: GameNodeKey
  /** The opponent whose range the hero faces (null for an opening RFI spot). */
  villain: Position | null
  /** False for an RFI (opening) spot, where pot odds are not meaningful. */
  facingBet: boolean
}

function blindChips(pos: Position): number {
  return pos === 'SB' ? SB : pos === 'BB' ? BB : 0
}

/** Standard first-in open size (bb): SB opens a touch larger, matching the charts. */
function openToChips(opener: Position): number {
  return Math.round((opener === 'SB' ? 3 : 2.5) * BB)
}

/** Standard 3-bet size (bb), aligned with the seed vs-RFI charts (BB ~11, SB ~10). */
function threeBetToChips(threeBettor: Position): number {
  return Math.round((threeBettor === 'SB' ? 10 : 11) * BB)
}

function rec(position: Position, action: Action, street: Street = 'preflop'): ActionRecord {
  return { seatIndex: ORDER.indexOf(position), position, street, action }
}

/** Dead blinds left in the pot by players neither involved seat posted. */
function deadBlinds(involved: readonly Position[]): number {
  let d = 0
  for (const b of ['SB', 'BB'] as const) if (!involved.includes(b)) d += blindChips(b)
  return d
}

export function buildPreflopLineNode(line: PreflopLine): PreflopLineNode {
  const hero = line.hero
  let history: ActionRecord[]
  let pot: number
  let toCall: number
  let heroCommit: number
  let villainCommit: number
  let villain: Position | null

  if (line.kind === 'rfi') {
    // First-in: only the blinds are in. An open raises rather than calls, so the
    // node carries the BB-to-match for completeness but pot odds are suppressed.
    history = []
    villain = null
    heroCommit = blindChips(hero)
    villainCommit = BB
    pot = SB + BB
    toCall = BB - heroCommit
  } else if (line.kind === 'vsRfi') {
    const openTo = openToChips(line.opener)
    history = [rec(line.opener, { type: 'raise', amount: openTo })]
    villain = line.opener
    heroCommit = blindChips(hero)
    villainCommit = openTo
    pot = openTo + heroCommit + deadBlinds([line.opener, hero])
    toCall = openTo - heroCommit
  } else {
    const openTo = openToChips(hero)
    const threeBetTo = threeBetToChips(line.threeBettor)
    history = [
      rec(hero, { type: 'raise', amount: openTo }),
      rec(line.threeBettor, { type: 'raise', amount: threeBetTo }),
    ]
    villain = line.threeBettor
    heroCommit = openTo
    villainCommit = threeBetTo
    pot = threeBetTo + openTo + deadBlinds([hero, line.threeBettor])
    toCall = threeBetTo - openTo
  }

  const node: GameNodeKey = {
    street: 'preflop',
    heroPosition: hero,
    board: [],
    history,
    potChips: pot,
    toCallChips: toCall,
    effectiveStackChips: STACK - Math.max(heroCommit, villainCommit),
    bigBlindChips: BB,
  }
  return { node, villain, facingBet: line.kind !== 'rfi' }
}

/** Positions that act before `hero` preflop (candidate openers for a vs-RFI line). */
export function positionsBefore(hero: Position): Position[] {
  const i = ORDER.indexOf(hero)
  return ORDER.filter((_, j) => j < i)
}

/** Positions that act after `hero` preflop (candidate 3-bettors over the hero's open). */
export function positionsAfter(hero: Position): Position[] {
  const i = ORDER.indexOf(hero)
  return ORDER.filter((_, j) => j > i)
}

// ───────────────────────── postflop live nodes ─────────────────────────
//
// The Live Solver's postflop extension. Same idea as the preflop builder above —
// fabricate a `GameNodeKey` (+ chip context) for a spot *without playing a hand* —
// but for a heads-up flop/turn/river node. The fabricated node is exactly the
// shape `PostflopSolverProvider` serves: a 2-player preflop history (so the §6.4
// range handoff derives both ranges), a board, and optional explicit postflop
// action records before the hero's decision. The same solver path the trainer
// uses then answers it.

export type PostflopStreet = Exclude<Street, 'preflop'>
export type PostflopPotType = 'srp' | '3bet'
/** Who made the last preflop raise: the opener (SRP) or the 3-bettor (3-bet pot). */
export type PreflopAggressor = 'hero' | 'villain'
export type PostflopActionActor = 'hero' | 'villain'
export type PostflopActionLinePreset =
  | 'manual'
  | 'flop-check-check'
  | 'flop-bet-call'
  | 'turn-bet-call'
  | 'hero-bet-facing-raise'
  | 'villain-donk-bet'
  | 'delayed-cbet'
  | 'probe'

export interface PostflopActionStep {
  street: PostflopStreet
  actor: PostflopActionActor
  action: 'check' | 'bet' | 'call' | 'raise'
  /** Total chips committed by this actor on the step's street after the action. */
  amountChips?: number
}

export interface PostflopActionLine {
  preset?: PostflopActionLinePreset
  label: string
  steps: readonly PostflopActionStep[]
}

/** Board card count by street (flop 3, turn 4, river 5). */
export const POSTFLOP_BOARD_LEN: Record<PostflopStreet, number> = { flop: 3, turn: 4, river: 5 }

export interface PostflopLineSpec {
  street: PostflopStreet
  hero: Position
  villain: Position
  potType: PostflopPotType
  aggressor: PreflopAggressor
  board: readonly Card[]
  /**
   * Pot before this node's current-street action records. Completed prior-street
   * action lines should already be reflected here; this chip context is
   * authoritative for the solve.
   */
  potBeforeChips: number
  /**
   * Legacy convenience for the old Live Solver path: append one current-street
   * villain bet when no explicit actionLine is supplied.
   */
  facingBetChips?: number
  /** Explicit postflop action records before the hero's decision. */
  actionLine?: PostflopActionLine
}

export interface PostflopLineNode {
  node: GameNodeKey
  villain: Position
  facingBet: boolean
  lineLabel: string
  /** Pot entering the flop from the preflop line (chips) — the natural pot default. */
  flopPotChips: number
  /** Each player's preflop commitment (chips); the basis for the effective stack. */
  preflopInvestChips: number
  /** Current-street commitment already made by the hero before this decision. */
  currentStreetHeroCommitmentChips: number
  /** Current-street commitment already made by the villain before this decision. */
  currentStreetVillainCommitmentChips: number
  /** Minimum legal bet/raise-to total for the hero's aggressive option. */
  minRaiseToChips: number
  effectiveStackChips: number
}

/** The two-player preflop history that seeds both ranges, by pot type + aggressor. */
function postflopPreflopHistory(spec: PostflopLineSpec): {
  history: ActionRecord[]
  investChips: number
  involved: [Position, Position]
} {
  const { hero, villain, potType, aggressor } = spec
  if (potType === 'srp') {
    // Single raised pot: the aggressor opens, the other flat-calls to the flop.
    const opener = aggressor === 'hero' ? hero : villain
    const caller = aggressor === 'hero' ? villain : hero
    const openTo = openToChips(opener)
    return {
      history: [
        rec(opener, { type: 'raise', amount: openTo }),
        rec(caller, { type: 'call', amount: openTo }),
      ],
      investChips: openTo,
      involved: [opener, caller],
    }
  }
  // 3-bet pot: the opener opens, the aggressor 3-bets, the opener calls to the flop.
  const threeBettor = aggressor === 'hero' ? hero : villain
  const opener = aggressor === 'hero' ? villain : hero
  const openTo = openToChips(opener)
  const threeBetTo = threeBetToChips(threeBettor)
  return {
    history: [
      rec(opener, { type: 'raise', amount: openTo }),
      rec(threeBettor, { type: 'raise', amount: threeBetTo }),
      rec(opener, { type: 'call', amount: threeBetTo }),
    ],
    investChips: threeBetTo,
    involved: [opener, threeBettor],
  }
}

function recForStep(step: PostflopActionStep, hero: Position, villain: Position): ActionRecord {
  const position = step.actor === 'hero' ? hero : villain
  const action: Action =
    step.action === 'check' ? { type: 'check' } : { type: step.action, amount: step.amountChips ?? 0 }
  return rec(position, action, step.street)
}

function currentStreetSizingContext(
  history: readonly ActionRecord[],
  street: PostflopStreet,
  hero: Position,
  villain: Position,
  bigBlindChips: number,
): {
  heroCommitted: number
  villainCommitted: number
  betToMatch: number
  toCall: number
  minRaiseTo: number
} {
  const committed = new Map<Position, number>()
  let betToMatch = 0
  let lastFullRaiseIncrement = bigBlindChips

  for (const r of history) {
    if (r.street !== street) continue
    const amount = r.action.amount
    if (amount === undefined) continue

    if (r.action.type === 'bet') {
      committed.set(r.position, amount)
      betToMatch = amount
      lastFullRaiseIncrement = amount
    } else if (r.action.type === 'raise') {
      committed.set(r.position, amount)
      const increment = amount - betToMatch
      betToMatch = amount
      if (increment >= lastFullRaiseIncrement) lastFullRaiseIncrement = increment
    } else if (r.action.type === 'call') {
      committed.set(r.position, amount)
    }
  }

  const heroCommitted = committed.get(hero) ?? 0
  const villainCommitted = committed.get(villain) ?? 0
  const toCall = Math.max(0, betToMatch - heroCommitted)
  const minRaiseTo =
    betToMatch > heroCommitted ? betToMatch + lastFullRaiseIncrement : heroCommitted + bigBlindChips

  return { heroCommitted, villainCommitted, betToMatch, toCall, minRaiseTo }
}

/**
 * Fabricate a heads-up postflop `GameNodeKey` for the Live Solver. The pot/stack
 * math is deterministic: both players commit the preflop raise size, dead blinds
 * stay in, and any pot beyond that flop baseline is treated as symmetric earlier
 * -street betting (so the effective stack behind is `STACK − invest − postflop
 * investment`). Explicit current-street records let the solver read the correct
 * to-call, committed amounts, and min-raise for bets, raises, donks, probes, and
 * delayed c-bet nodes.
 */
export function buildPostflopLineNode(spec: PostflopLineSpec): PostflopLineNode {
  const { hero, villain, street, board, potBeforeChips } = spec
  const { history: preflopHistory, investChips, involved } = postflopPreflopHistory(spec)

  const flopPotChips = 2 * investChips + deadBlinds(involved)

  const history: ActionRecord[] = [...preflopHistory]
  if (spec.actionLine) {
    for (const step of spec.actionLine.steps) history.push(recForStep(step, hero, villain))
  } else if ((spec.facingBetChips ?? 0) > 0) {
    history.push(rec(villain, { type: 'bet', amount: spec.facingBetChips }, street))
  }

  const sizing = currentStreetSizingContext(history, street, hero, villain, BB)
  const postflopInvestPerPlayer = Math.max(0, (potBeforeChips - flopPotChips) / 2)
  const stackBeforeCurrentStreetDecision = Math.max(0, STACK - investChips - postflopInvestPerPlayer)
  const effectiveStackChips = Math.max(0, stackBeforeCurrentStreetDecision - sizing.heroCommitted)
  const currentStreetPotChips = sizing.heroCommitted + sizing.villainCommitted
  const facing = sizing.toCall > 0

  const node: GameNodeKey = {
    street,
    heroPosition: hero,
    board: [...board],
    history,
    potChips: potBeforeChips + currentStreetPotChips,
    toCallChips: sizing.toCall,
    effectiveStackChips,
    bigBlindChips: BB,
  }
  return {
    node,
    villain,
    facingBet: facing,
    lineLabel: spec.actionLine?.label ?? (facing ? 'Villain bet' : 'No postflop line'),
    flopPotChips,
    preflopInvestChips: investChips,
    currentStreetHeroCommitmentChips: sizing.heroCommitted,
    currentStreetVillainCommitmentChips: sizing.villainCommitted,
    minRaiseToChips: sizing.minRaiseTo,
    effectiveStackChips,
  }
}

/**
 * The pot-fraction that yields a hero "bet-to"/"raise-to" of `targetToChips` under
 * the postflop solver's sizing rule — the bridge for the Live Solver's bet slider.
 * Facing a bet, the fraction applies to the post-call pot above the villain's bet;
 * first to act, it is a straight fraction of the pot. Scale-invariant, so chips and
 * big blinds give the same answer.
 */
export function potFractionForBetTo(
  potChips: number,
  toCallChips: number,
  villainCommittedThisStreetChips: number,
  targetToChips: number,
): number {
  if (toCallChips > 0) {
    const denom = potChips + toCallChips
    return denom > 0 ? Math.max(0, (targetToChips - villainCommittedThisStreetChips) / denom) : 0
  }
  return potChips > 0 ? Math.max(0, targetToChips / potChips) : 0
}
