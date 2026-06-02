import {
  DEFAULT_BET_SIZE_TREE,
  DEFAULT_TABLE_CONFIG,
  positionFor,
  type BetSizeTree,
  type TableConfig,
} from '@gto/domain-config'
import type { Card } from '@gto/hand-eval'
import { Deck } from './deck'
import { settleShowdown, settleUncontested, totalPot } from './showdown'
import type {
  Action,
  ActionRecord,
  DecisionPoint,
  GameNodeKey,
  HandState,
  LegalAction,
  SeatState,
  SizeOption,
  Street,
} from './types'

const NEXT_STREET: Record<Street, Street | null> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: null,
}

const STREET_DEAL: Record<Exclude<Street, 'preflop'>, number> = { flop: 3, turn: 1, river: 1 }

function clone(state: HandState): HandState {
  return {
    ...state,
    seats: state.seats.map((s) => ({ ...s })),
    board: [...state.board],
    history: [...state.history],
  }
}

function seatBy(state: HandState, seatIndex: number): SeatState {
  return state.seats[seatIndex]!
}

/** Move a seat's committed-this-street total up to `toTotal` (capped by stack). */
function commitTo(seat: SeatState, toTotal: number): void {
  const add = Math.min(toTotal - seat.committedThisStreet, seat.stack)
  seat.stack -= add
  seat.committedThisStreet += add
  seat.committedTotal += add
  if (seat.stack === 0 && seat.status === 'active') seat.status = 'allIn'
}

/** Next seat (clockwise from `fromSeatIndex`) that still owes action, or null. */
function nextToActFrom(state: HandState, fromSeatIndex: number): number | null {
  const n = state.seats.length
  for (let i = 1; i <= n; i++) {
    const idx = (fromSeatIndex + i) % n
    const s = state.seats[idx]!
    if (s.status === 'active' && (s.committedThisStreet < state.betToMatch || !s.hasActed)) return idx
  }
  return null
}

/** First seat to act postflop: first active seat clockwise from the button (SB-first). */
function firstActivePostflop(state: HandState): number | null {
  const n = state.seats.length
  for (let i = 1; i <= n; i++) {
    const idx = (state.buttonIndex + i) % n
    if (state.seats[idx]!.status === 'active') return idx
  }
  return null
}

export interface CreateHandOptions {
  handId: string
  buttonIndex: number
  /** Per-seat controller; defaults to 'bot'. */
  controllers?: ('human' | 'bot')[]
  heroSeat: number
  config?: TableConfig
  /** Seed for a fresh deck (ignored if `deck` is given). */
  seed?: string | number
  deck?: Deck
  /** Optional preset hole cards per seat (for tests/replay). */
  holeCards?: ReadonlyArray<readonly [Card, Card]>
}

export function createHand(opts: CreateHandOptions): HandState {
  const config = opts.config ?? DEFAULT_TABLE_CONFIG
  const n = config.numSeats
  const presetDead = (opts.holeCards ?? []).flat()
  const deck = opts.deck ?? new Deck(opts.seed ?? opts.handId, presetDead)

  const seats: SeatState[] = []
  for (let i = 0; i < n; i++) {
    const preset = opts.holeCards?.[i]
    const holeCards = preset ?? (deck.deal(2) as [Card, Card])
    seats.push({
      seatIndex: i,
      position: positionFor(i, opts.buttonIndex, n),
      stack: config.startingStackChips,
      committedThisStreet: 0,
      committedTotal: 0,
      status: 'active',
      holeCards,
      controller: opts.controllers?.[i] ?? 'bot',
      isHero: i === opts.heroSeat,
      hasActed: false,
    })
  }

  const state: HandState = {
    handId: opts.handId,
    config,
    buttonIndex: opts.buttonIndex,
    seats,
    board: [],
    street: 'preflop',
    phase: 'betting',
    toAct: null,
    betToMatch: 0,
    lastRaiseIncrement: config.bigBlindChips,
    history: [],
    result: null,
    deck,
  }

  // Post blinds (not counted as "acting"; the BB retains the option preflop).
  const sb = seats.find((s) => s.position === 'SB')!
  const bb = seats.find((s) => s.position === 'BB')!
  commitTo(sb, config.smallBlindChips)
  commitTo(bb, config.bigBlindChips)
  state.betToMatch = config.bigBlindChips

  state.toAct = nextToActFrom(state, bb.seatIndex)
  return state
}

function minOpenBet(state: HandState): number {
  return state.config.bigBlindChips
}

export function legalActions(state: HandState): LegalAction[] {
  if (state.toAct === null) return []
  const seat = seatBy(state, state.toAct)
  const diff = state.betToMatch - seat.committedThisStreet
  const out: LegalAction[] = []
  const maxTo = seat.committedThisStreet + seat.stack

  if (diff <= 0) {
    out.push({ type: 'check' })
    if (seat.stack > 0) {
      const minTo = seat.committedThisStreet + Math.min(seat.stack, minOpenBet(state))
      out.push({ type: 'bet', min: minTo, max: maxTo })
    }
    return out
  }

  out.push({ type: 'fold' })
  const callTo = seat.committedThisStreet + Math.min(seat.stack, diff)
  out.push({ type: 'call', min: callTo, max: callTo })

  // A raise is only allowed if action has not already closed for this seat
  // (a sub-min all-in does not reopen a seat that already acted — spec §5.5).
  if (!seat.hasActed && seat.stack > diff) {
    const minRaiseTo = state.betToMatch + state.lastRaiseIncrement
    out.push({ type: 'raise', min: Math.min(minRaiseTo, maxTo), max: maxTo })
  }
  return out
}

function clampToLegal(amount: number, legal: LegalAction): number {
  return Math.max(legal.min!, Math.min(legal.max!, Math.round(amount)))
}

function bbLabel(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function preflopRaiseCount(state: HandState): number {
  return state.history.filter((a) => a.street === 'preflop' && a.action.type === 'raise').length
}

export function sizeOptions(state: HandState): SizeOption[] {
  if (state.toAct === null) return []
  const seat = seatBy(state, state.toAct)
  const legal = legalActions(state)
  const tree: BetSizeTree = DEFAULT_BET_SIZE_TREE
  const bb = state.config.bigBlindChips
  const pot = totalPot(state.seats)
  const maxTo = seat.committedThisStreet + seat.stack
  const out: SizeOption[] = []

  const betLegal = legal.find((l) => l.type === 'bet')
  if (betLegal) {
    for (const frac of tree.postflopBetFractions) {
      out.push({
        label: `${Math.round(frac * 100)}% pot`,
        amount: clampToLegal(frac * pot, betLegal),
        kind: 'bet',
      })
    }
    out.push({ label: 'All-in', amount: maxTo, kind: 'allin' })
  }

  const raiseLegal = legal.find((l) => l.type === 'raise')
  if (raiseLegal) {
    if (state.street === 'preflop' && state.betToMatch === bb) {
      const openBbs = seat.position === 'SB' ? tree.preflopSbOpenBbs : tree.preflopOpenBbs
      for (const openBb of openBbs) {
        out.push({
          label: `Open ${bbLabel(openBb)}bb`,
          amount: clampToLegal(openBb * bb, raiseLegal),
          kind: 'open',
        })
      }
    } else if (state.street === 'preflop') {
      const raiseCount = preflopRaiseCount(state)
      const multipliers = raiseCount >= 2 ? tree.preflopFourBetMultipliers : tree.preflopReraiseMultipliers
      const label = raiseCount >= 1 ? `${raiseCount + 2}-bet` : 'Raise'
      for (const multiplier of multipliers) {
        const to = clampToLegal(state.betToMatch * multiplier, raiseLegal)
        out.push({ label: `${label} to ${bbLabel(to / bb)}bb`, amount: to, kind: 'raise' })
      }
    } else {
      const toCall = state.betToMatch - seat.committedThisStreet
      const potRaiseTo = clampToLegal(state.betToMatch + pot + toCall, raiseLegal)
      out.push({ label: 'Pot', amount: potRaiseTo, kind: 'raise' })
    }
    out.push({ label: 'All-in', amount: maxTo, kind: 'allin' })
  }

  // De-duplicate by amount, keeping the first label.
  const seen = new Set<number>()
  return out.filter((o) => (seen.has(o.amount) ? false : (seen.add(o.amount), true)))
}

function effectiveStack(state: HandState, seat: SeatState): number {
  let maxOther = 0
  for (const s of state.seats) {
    if (s.seatIndex !== seat.seatIndex && s.status !== 'folded') {
      maxOther = Math.max(maxOther, s.stack + s.committedThisStreet)
    }
  }
  return Math.min(seat.stack, maxOther)
}

function nodeKey(state: HandState, seat: SeatState): GameNodeKey {
  return {
    street: state.street,
    heroPosition: seat.position,
    board: [...state.board],
    history: [...state.history],
  }
}

export function decisionPoint(state: HandState): DecisionPoint | null {
  if (state.toAct === null || state.phase === 'complete') return null
  const seat = seatBy(state, state.toAct)
  return {
    handId: state.handId,
    street: state.street,
    seatIndex: seat.seatIndex,
    position: seat.position,
    heroHoleCards: seat.holeCards,
    board: [...state.board],
    potChips: totalPot(state.seats),
    toCallChips: Math.max(0, state.betToMatch - seat.committedThisStreet),
    effectiveStackChips: effectiveStack(state, seat),
    bigBlindChips: state.config.bigBlindChips,
    actionHistory: [...state.history],
    legalActions: legalActions(state),
    sizeOptions: sizeOptions(state),
    nodeKey: nodeKey(state, seat),
  }
}

function matches(action: Action, legal: LegalAction): boolean {
  if (action.type !== legal.type) return false
  if (legal.type === 'bet' || legal.type === 'raise') {
    const a = action.amount ?? -1
    return a >= legal.min! && a <= legal.max!
  }
  return true
}

function reopen(state: HandState, raiserSeatIndex: number): void {
  for (const s of state.seats) {
    if (s.status === 'active' && s.seatIndex !== raiserSeatIndex) s.hasActed = false
  }
}

/** Apply the current actor's action and advance the hand. Returns a new state. */
export function applyAction(state: HandState, action: Action): HandState {
  if (state.toAct === null) throw new Error('No seat to act')
  const legal = legalActions(state)
  if (!legal.some((l) => matches(action, l))) {
    throw new Error(`Illegal action: ${JSON.stringify(action)}`)
  }

  const next = clone(state)
  const seat = seatBy(next, state.toAct)
  let recorded: Action = action

  switch (action.type) {
    case 'fold':
      seat.status = 'folded'
      seat.hasActed = true
      break
    case 'check':
      seat.hasActed = true
      break
    case 'call': {
      const toTotal = Math.min(next.betToMatch, seat.committedThisStreet + seat.stack)
      commitTo(seat, toTotal)
      seat.hasActed = true
      recorded = { type: 'call', amount: seat.committedThisStreet }
      break
    }
    case 'bet': {
      const amount = action.amount!
      commitTo(seat, amount)
      next.lastRaiseIncrement = amount // opening bet sets the increment baseline
      next.betToMatch = seat.committedThisStreet
      seat.hasActed = true
      reopen(next, seat.seatIndex)
      break
    }
    case 'raise': {
      const amount = action.amount!
      const increment = amount - next.betToMatch
      commitTo(seat, amount)
      const newBet = seat.committedThisStreet
      const full = increment >= next.lastRaiseIncrement
      next.betToMatch = newBet
      if (full) {
        next.lastRaiseIncrement = increment
        reopen(next, seat.seatIndex)
      }
      seat.hasActed = true
      break
    }
  }

  next.history.push({
    seatIndex: seat.seatIndex,
    position: seat.position,
    street: next.street,
    action: recorded,
  })

  // If everyone but one player has folded, the hand ends immediately — even if
  // that last player (e.g. the BB with its option) hasn't formally acted.
  const inHand = next.seats.filter((s) => s.status !== 'folded')
  if (inHand.length === 1) {
    next.toAct = null
    return settleUncontested(next, inHand[0]!.seatIndex)
  }

  const nextActor = nextToActFrom(next, seat.seatIndex)
  if (nextActor !== null) {
    next.toAct = nextActor
    return next
  }
  // Betting round closed.
  next.toAct = null
  return closeRound(next)
}

function startStreet(state: HandState, street: Exclude<Street, 'preflop'>): HandState {
  const dealt = state.deck.deal(STREET_DEAL[street])
  state.board.push(...dealt)
  state.street = street
  state.betToMatch = 0
  state.lastRaiseIncrement = state.config.bigBlindChips
  for (const s of state.seats) {
    s.committedThisStreet = 0
    if (s.status === 'active') s.hasActed = false
  }
  state.toAct = firstActivePostflop(state)
  if (state.toAct === null) return runToShowdown(state)
  return state
}

function closeRound(state: HandState): HandState {
  const inHand = state.seats.filter((s) => s.status !== 'folded')
  if (inHand.length === 1) return settleUncontested(state, inHand[0]!.seatIndex)

  const canAct = state.seats.filter((s) => s.status === 'active')
  if (canAct.length <= 1) return runToShowdown(state)

  if (state.street === 'river') return settleShowdown(state)
  return startStreet(state, NEXT_STREET[state.street] as Exclude<Street, 'preflop'>)
}

/** Fast-forward: deal any remaining board cards (no further betting) and showdown. */
export function runToShowdown(state: HandState): HandState {
  let s = state
  while (s.street !== 'river') {
    const next = NEXT_STREET[s.street] as Exclude<Street, 'preflop'>
    const dealt = s.deck.deal(STREET_DEAL[next])
    s = { ...s, board: [...s.board, ...dealt], street: next, toAct: null }
  }
  return settleShowdown(s)
}

/** Convenience for tests/scripts: apply a sequence of actions in order. */
export function applyActions(state: HandState, actions: Action[]): HandState {
  return actions.reduce((s, a) => applyAction(s, a), state)
}
