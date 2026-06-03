import { DEFAULT_TABLE_CONFIG, type TableConfig } from '@gto/domain-config'
import { applyActions, createHand } from './hand'
import type { Action, HandState } from './types'

/**
 * URL codec for a single trainer hand — the persistence layer behind shareable
 * trainer spots. A hand is fully reproducible from its seed (which seeds the
 * deck, so hole cards *and* board are fixed), the button seat, and the action
 * sequence applied to the post-blinds state (spec §5.6, §10 — the engine is a
 * pure, seed-driven reducer). Encode those three and a recipient reconstructs the
 * identical hand by re-dealing from the seed and replaying the actions.
 *
 * Pure (no DOM): the web layer maps this to/from `location`. Decoding validates
 * each field and returns `null` on anything malformed, so a tampered or stale URL
 * degrades to a fresh hand instead of throwing.
 */

export interface HandLink {
  /** The hand's seed (== handId). Fully determines the deck: deal + board runout. */
  seed: string
  /** Button seat index (0..numSeats-1). */
  buttonIndex: number
  /** The actions applied to the post-blinds state, in order. */
  actions: Action[]
}

const ACTION_CHAR: Record<Action['type'], string> = {
  fold: 'f',
  check: 'x',
  call: 'c',
  bet: 'b',
  raise: 'r',
}

function encodeAction(a: Action): string {
  // bet/raise carry a "to" amount; fold/check/call re-derive on replay.
  return a.type === 'bet' || a.type === 'raise' ? `${ACTION_CHAR[a.type]}${a.amount ?? 0}` : ACTION_CHAR[a.type]
}

function decodeAction(token: string): Action | null {
  if (token === 'f') return { type: 'fold' }
  if (token === 'x') return { type: 'check' }
  if (token === 'c') return { type: 'call' }
  const m = /^([br])(\d+)$/.exec(token)
  if (!m) return null
  const amount = Number(m[2])
  if (!Number.isInteger(amount) || amount < 0) return null
  return { type: m[1] === 'b' ? 'bet' : 'raise', amount }
}

export function encodeHandLink(link: HandLink): string {
  const p = new URLSearchParams()
  p.set('hand', link.seed)
  p.set('btn', String(link.buttonIndex))
  if (link.actions.length > 0) p.set('a', link.actions.map(encodeAction).join('.'))
  return p.toString()
}

export function decodeHandLink(input: string | URLSearchParams): HandLink | null {
  const p = typeof input === 'string' ? new URLSearchParams(input) : input
  const seed = p.get('hand')
  if (!seed) return null

  const buttonIndex = Number(p.get('btn'))
  if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= DEFAULT_TABLE_CONFIG.numSeats) return null

  const raw = p.get('a')
  let actions: Action[] = []
  if (raw) {
    const decoded = raw.split('.').map(decodeAction)
    if (decoded.some((a) => a === null)) return null
    actions = decoded as Action[]
  }
  return { seed, buttonIndex, actions }
}

export interface ReconstructParams {
  heroSeat: number
  controllers: ('human' | 'bot')[]
  config?: TableConfig
}

/**
 * Rebuild the `HandState` a link describes: deal from the seed, then replay the
 * recorded actions. Throws if an action is illegal for the reconstructed state
 * (a corrupt link); callers should fall back to a fresh hand.
 */
export function reconstructHandFromLink(link: HandLink, params: ReconstructParams): HandState {
  const initial = createHand({
    handId: link.seed,
    seed: link.seed,
    buttonIndex: link.buttonIndex,
    heroSeat: params.heroSeat,
    controllers: params.controllers,
    config: params.config,
  })
  return applyActions(initial, link.actions)
}
