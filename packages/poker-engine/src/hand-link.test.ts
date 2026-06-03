import { describe, expect, it } from 'vitest'
import { applyAction, createHand, decisionPoint } from './hand'
import { decodeHandLink, encodeHandLink, reconstructHandFromLink, type HandLink } from './hand-link'
import type { Action, HandState } from './types'

const opts = {
  handId: 'handlink-seed-1',
  seed: 'handlink-seed-1',
  buttonIndex: 2,
  heroSeat: 0,
  controllers: Array.from({ length: 6 }, () => 'bot' as const),
}
const params = { heroSeat: opts.heroSeat, controllers: opts.controllers }

// A deterministic line that exercises every action type: raise first-in, else
// call a bet, else check.
const policy = (state: HandState): Action => {
  const dp = decisionPoint(state)!
  if (dp.toCallChips === 0 && dp.legalActions.some((l) => l.type === 'bet')) {
    const bet = dp.legalActions.find((l) => l.type === 'bet')!
    return { type: 'bet', amount: bet.min! }
  }
  if (dp.legalActions.some((l) => l.type === 'call')) return { type: 'call' }
  if (dp.legalActions.some((l) => l.type === 'check')) return { type: 'check' }
  return { type: 'fold' }
}

function playOut(): HandState {
  let state = createHand(opts)
  let guard = 0
  while (state.phase === 'betting' && guard++ < 100) state = applyAction(state, policy(state))
  return state
}

describe('hand-link encode/decode', () => {
  it('round-trips a played-out hand: encode → decode → reconstruct === live hand', () => {
    const live = playOut()
    const link: HandLink = {
      seed: live.handId,
      buttonIndex: live.buttonIndex,
      actions: live.history.map((r) => r.action),
    }

    const decoded = decodeHandLink(encodeHandLink(link))
    expect(decoded).not.toBeNull()

    const rebuilt = reconstructHandFromLink(decoded!, params)
    expect(rebuilt.phase).toBe('complete')
    expect(rebuilt.board).toEqual(live.board)
    expect(rebuilt.result?.payouts).toEqual(live.result?.payouts)
    expect(rebuilt.seats.map((s) => s.holeCards)).toEqual(live.seats.map((s) => s.holeCards))
    expect(rebuilt.history.map((r) => r.action)).toEqual(live.history.map((r) => r.action))
  })

  it('reconstructs a mid-hand prefix to the same pending decision', () => {
    const live = playOut()
    const actions = live.history.map((r) => r.action)
    const prefix = actions.slice(0, 3)
    const link: HandLink = { seed: live.handId, buttonIndex: live.buttonIndex, actions: prefix }

    const rebuilt = reconstructHandFromLink(decodeHandLink(encodeHandLink(link))!, params)
    const direct = reconstructHandFromLink({ ...link }, params)
    expect(rebuilt.history).toEqual(direct.history)
    expect(rebuilt.board).toEqual(direct.board)
    expect(decisionPoint(rebuilt)?.seatIndex).toEqual(decisionPoint(direct)?.seatIndex)
  })

  it('encodes every action type compactly and decodes them back', () => {
    const link: HandLink = {
      seed: 'gto-abc-def',
      buttonIndex: 0,
      actions: [
        { type: 'raise', amount: 250 },
        { type: 'call' },
        { type: 'check' },
        { type: 'bet', amount: 150 },
        { type: 'fold' },
      ],
    }
    const qs = encodeHandLink(link)
    expect(new URLSearchParams(qs).get('a')).toBe('r250.c.x.b150.f')
    expect(decodeHandLink(qs)).toEqual(link)
  })

  it('handles a hand with no actions yet (omits the action param)', () => {
    const qs = encodeHandLink({ seed: 'gto-x', buttonIndex: 3, actions: [] })
    expect(qs).not.toContain('a=')
    expect(decodeHandLink(qs)).toEqual({ seed: 'gto-x', buttonIndex: 3, actions: [] })
  })
})

describe('hand-link validation', () => {
  it('returns null without a seed', () => {
    expect(decodeHandLink('')).toBeNull()
    expect(decodeHandLink('btn=2&a=f')).toBeNull()
  })

  it('rejects an out-of-range or non-integer button', () => {
    expect(decodeHandLink('hand=s&btn=6')).toBeNull()
    expect(decodeHandLink('hand=s&btn=-1')).toBeNull()
    expect(decodeHandLink('hand=s&btn=x')).toBeNull()
  })

  it('rejects a malformed action token', () => {
    expect(decodeHandLink('hand=s&btn=0&a=f.zzz')).toBeNull()
    expect(decodeHandLink('hand=s&btn=0&a=b')).toBeNull() // bet without amount
  })

  it('accepts a URLSearchParams instance directly', () => {
    expect(decodeHandLink(new URLSearchParams('hand=gto-y&btn=1&a=r300.c'))).toEqual({
      seed: 'gto-y',
      buttonIndex: 1,
      actions: [{ type: 'raise', amount: 300 }, { type: 'call' }],
    })
  })
})
