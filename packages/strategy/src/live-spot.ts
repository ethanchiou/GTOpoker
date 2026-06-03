import { POSITIONS_6MAX, type Position } from '@gto/domain-config'
import { cardFromString, cardToString, type Card } from '@gto/hand-eval'
import type {
  PostflopActionLinePreset,
  PostflopPotType,
  PostflopStreet,
  PreflopAggressor,
} from './live-node'

/**
 * URL codec for Live Solver spots — the persistence layer behind shareable
 * spots. A spot is the full set of user inputs for one Live Solver mode, encoded
 * into a `URLSearchParams` string so a spot can be copied, reopened, and used as
 * a regression fixture. Pure (no DOM): the web layer reads/writes `location`.
 *
 * Decoding is deliberately lenient — every field is validated independently and
 * a malformed value is dropped (the caller fills its default) rather than
 * throwing, so a tampered or stale URL degrades to defaults instead of crashing.
 * The only hard requirement is a recognised `m` (mode); without it there is no
 * spot to restore.
 */

export type PreflopLineKind = 'rfi' | 'vsRfi' | 'vs3bet'

export interface LivePreflopSpot {
  mode: 'preflop'
  hero: Position
  lineKind: PreflopLineKind
  opener: Position | null
  threeBettor: Position | null
  /** Hole cards in slot order, 0–2 (no nulls; an empty slot is simply absent). */
  cards: Card[]
}

export interface LivePostflopSpot {
  mode: 'postflop'
  street: PostflopStreet
  hero: Position
  villain: Position
  potType: PostflopPotType
  aggressor: PreflopAggressor
  /** Community cards in slot order, 0–5. */
  board: Card[]
  /** Hole cards in slot order, 0–2. */
  cards: Card[]
  linePreset: PostflopActionLinePreset
  /** Pot before the current action, in big blinds. */
  potBb: number
  /** Manual line only: whether the villain has bet into the hero. */
  facing: boolean
  villainBetBb: number
  heroFirstBetBb: number
  villainRaiseBb: number
  /** The "preview my bet" slider position, in chips. */
  heroBetChips: number
}

export type LiveSolverSpot = LivePreflopSpot | LivePostflopSpot

/**
 * The result of decoding a URL: the mode plus whichever fields parsed cleanly.
 * Missing/invalid fields are simply absent so the caller can fall back to its
 * own defaults field-by-field.
 */
export type DecodedLiveSpot =
  | ({ mode: 'preflop' } & Partial<Omit<LivePreflopSpot, 'mode'>>)
  | ({ mode: 'postflop' } & Partial<Omit<LivePostflopSpot, 'mode'>>)

const LINE_KINDS: readonly PreflopLineKind[] = ['rfi', 'vsRfi', 'vs3bet']
const STREETS: readonly PostflopStreet[] = ['flop', 'turn', 'river']
const POT_TYPES: readonly PostflopPotType[] = ['srp', '3bet']
const AGGRESSORS: readonly PreflopAggressor[] = ['hero', 'villain']
const LINE_PRESETS: readonly PostflopActionLinePreset[] = [
  'manual',
  'flop-check-check',
  'flop-bet-call',
  'turn-bet-call',
  'hero-bet-facing-raise',
  'villain-donk-bet',
  'delayed-cbet',
  'probe',
]

function fromList<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : undefined
}

function asPosition(value: string | null): Position | undefined {
  return fromList(POSITIONS_6MAX, value)
}

/** Parse a positive big-blind / chip amount; reject non-finite or out-of-range junk. */
function asAmount(value: string | null, max: number): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined
}

/** Concatenated two-char card tokens, e.g. [As, Kh] → "AsKh". */
function encodeCards(cards: readonly Card[]): string {
  return cards.map(cardToString).join('')
}

/** Parse "AsKh" → [As, Kh]; reject odd length, unknown cards, dupes, or overflow. */
function decodeCards(token: string | null, max: number): Card[] | undefined {
  if (token === null) return undefined
  if (token.length === 0) return []
  if (token.length % 2 !== 0 || token.length > max * 2) return undefined
  const out: Card[] = []
  const seen = new Set<Card>()
  for (let i = 0; i < token.length; i += 2) {
    let card: Card
    try {
      card = cardFromString(token.slice(i, i + 2))
    } catch {
      return undefined
    }
    if (seen.has(card)) return undefined
    seen.add(card)
    out.push(card)
  }
  return out
}

const MAX_BB = 1_000
const MAX_CHIPS = 10_000_000

export function encodeLiveSolverSpot(spot: LiveSolverSpot): string {
  const p = new URLSearchParams()
  p.set('m', spot.mode)
  if (spot.mode === 'preflop') {
    p.set('h', spot.hero)
    p.set('l', spot.lineKind)
    if (spot.lineKind === 'vsRfi' && spot.opener) p.set('o', spot.opener)
    if (spot.lineKind === 'vs3bet' && spot.threeBettor) p.set('tb', spot.threeBettor)
    if (spot.cards.length > 0) p.set('c', encodeCards(spot.cards))
  } else {
    p.set('s', spot.street)
    p.set('h', spot.hero)
    p.set('v', spot.villain)
    p.set('pt', spot.potType)
    p.set('ag', spot.aggressor)
    p.set('lp', spot.linePreset)
    if (spot.board.length > 0) p.set('b', encodeCards(spot.board))
    if (spot.cards.length > 0) p.set('c', encodeCards(spot.cards))
    p.set('pot', String(spot.potBb))
    if (spot.facing) p.set('f', '1')
    p.set('vb', String(spot.villainBetBb))
    p.set('hb', String(spot.heroFirstBetBb))
    p.set('vr', String(spot.villainRaiseBb))
    p.set('bet', String(Math.round(spot.heroBetChips)))
  }
  return p.toString()
}

export function decodeLiveSolverSpot(input: string | URLSearchParams): DecodedLiveSpot | null {
  const p = typeof input === 'string' ? new URLSearchParams(input) : input
  const mode = p.get('m')

  if (mode === 'preflop') {
    const out: { mode: 'preflop' } & Partial<Omit<LivePreflopSpot, 'mode'>> = { mode: 'preflop' }
    const hero = asPosition(p.get('h'))
    if (hero) out.hero = hero
    const lineKind = fromList(LINE_KINDS, p.get('l'))
    if (lineKind) out.lineKind = lineKind
    const opener = asPosition(p.get('o'))
    if (opener) out.opener = opener
    const threeBettor = asPosition(p.get('tb'))
    if (threeBettor) out.threeBettor = threeBettor
    const cards = decodeCards(p.get('c'), 2)
    if (cards) out.cards = cards
    return out
  }

  if (mode === 'postflop') {
    const out: { mode: 'postflop' } & Partial<Omit<LivePostflopSpot, 'mode'>> = { mode: 'postflop' }
    const street = fromList(STREETS, p.get('s'))
    if (street) out.street = street
    const hero = asPosition(p.get('h'))
    if (hero) out.hero = hero
    const villain = asPosition(p.get('v'))
    if (villain) out.villain = villain
    const potType = fromList(POT_TYPES, p.get('pt'))
    if (potType) out.potType = potType
    const aggressor = fromList(AGGRESSORS, p.get('ag'))
    if (aggressor) out.aggressor = aggressor
    const linePreset = fromList(LINE_PRESETS, p.get('lp'))
    if (linePreset) out.linePreset = linePreset
    const board = decodeCards(p.get('b'), 5)
    if (board) out.board = board
    const cards = decodeCards(p.get('c'), 2)
    if (cards) out.cards = cards
    const potBb = asAmount(p.get('pot'), MAX_BB)
    if (potBb !== undefined) out.potBb = potBb
    if (p.get('f') === '1') out.facing = true
    const villainBetBb = asAmount(p.get('vb'), MAX_BB)
    if (villainBetBb !== undefined) out.villainBetBb = villainBetBb
    const heroFirstBetBb = asAmount(p.get('hb'), MAX_BB)
    if (heroFirstBetBb !== undefined) out.heroFirstBetBb = heroFirstBetBb
    const villainRaiseBb = asAmount(p.get('vr'), MAX_BB)
    if (villainRaiseBb !== undefined) out.villainRaiseBb = villainRaiseBb
    const heroBetChips = asAmount(p.get('bet'), MAX_CHIPS)
    if (heroBetChips !== undefined) out.heroBetChips = heroBetChips
    return out
  }

  return null
}
