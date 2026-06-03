import { DEFAULT_TABLE_CONFIG, POSITIONS_6MAX, type Position } from '@gto/domain-config'
import type { Action, ActionRecord, GameNodeKey } from '@gto/poker-engine'

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

function rec(position: Position, action: Action): ActionRecord {
  return { seatIndex: ORDER.indexOf(position), position, street: 'preflop', action }
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
