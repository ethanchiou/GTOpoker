import { classFor, rankIndex, type HandClass } from './hand-class'

/**
 * Parse standard poker range notation into a map of hand class → frequency
 * (spec §6.3 authoring). Supported token forms (each optionally suffixed with
 * `:freq`, default 1.0):
 *
 *   AA            single pair
 *   TT+           pairs from TT up to AA
 *   99-22         pair range
 *   AKs / AKo     single suited / offsuit combo
 *   A2s+ / KTo+   fix the high card, vary the low card upward
 *   A2s-A5s       combo range (same high card + suitedness)
 *   AJs:0.5       mixed frequency
 *
 * A class appearing in multiple tokens accumulates frequency (used to express
 * the *fold* remainder elsewhere, not here).
 */
export function parseRange(input: string): Map<HandClass, number> {
  const out = new Map<HandClass, number>()
  const tokens = input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  for (const token of tokens) {
    const [core, freqStr] = token.split(':')
    const freq = freqStr !== undefined ? Number(freqStr) : 1
    if (!Number.isFinite(freq) || freq < 0 || freq > 1) {
      throw new Error(`Invalid frequency in range token "${token}"`)
    }
    for (const cls of expandToken(core!.trim())) {
      out.set(cls, Math.min(1, (out.get(cls) ?? 0) + freq))
    }
  }
  return out
}

const PAIR = /^([2-9TJQKA])\1(\+)?$/
const PAIR_RANGE = /^([2-9TJQKA])\1-([2-9TJQKA])\2$/
const COMBO = /^([2-9TJQKA])([2-9TJQKA])([so])(\+)?$/
const COMBO_RANGE = /^([2-9TJQKA])([2-9TJQKA])([so])-([2-9TJQKA])([2-9TJQKA])([so])$/

function expandToken(core: string): HandClass[] {
  let m = PAIR.exec(core)
  if (m) {
    const start = rankIndex(m[1]!)
    const end = m[2] ? 12 : start
    const out: HandClass[] = []
    for (let r = start; r <= end; r++) out.push(classFor(r, r, false))
    return out
  }

  m = PAIR_RANGE.exec(core)
  if (m) {
    const a = rankIndex(m[1]!)
    const b = rankIndex(m[2]!)
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    const out: HandClass[] = []
    for (let r = lo; r <= hi; r++) out.push(classFor(r, r, false))
    return out
  }

  m = COMBO.exec(core)
  if (m) {
    let hi = rankIndex(m[1]!)
    let lo = rankIndex(m[2]!)
    if (hi < lo) [hi, lo] = [lo, hi]
    if (hi === lo) throw new Error(`Invalid combo "${core}"`)
    const suited = m[3] === 's'
    if (!m[4]) return [classFor(hi, lo, suited)]
    // "+": vary the low card upward, up to hi-1.
    const out: HandClass[] = []
    for (let r = lo; r < hi; r++) out.push(classFor(hi, r, suited))
    return out
  }

  m = COMBO_RANGE.exec(core)
  if (m) {
    let hi1 = rankIndex(m[1]!)
    let lo1 = rankIndex(m[2]!)
    if (hi1 < lo1) [hi1, lo1] = [lo1, hi1]
    let hi2 = rankIndex(m[4]!)
    let lo2 = rankIndex(m[5]!)
    if (hi2 < lo2) [hi2, lo2] = [lo2, hi2]
    if (hi1 !== hi2 || m[3] !== m[6]) {
      throw new Error(`Combo range must share high card and suitedness: "${core}"`)
    }
    const suited = m[3] === 's'
    const [lo, hi] = lo1 <= lo2 ? [lo1, lo2] : [lo2, lo1]
    const out: HandClass[] = []
    for (let r = lo; r <= hi; r++) out.push(classFor(hi1, r, suited))
    return out
  }

  throw new Error(`Unrecognized range token: "${core}"`)
}
