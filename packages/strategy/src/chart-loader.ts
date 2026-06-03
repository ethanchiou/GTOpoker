import type { Position } from '@gto/domain-config'
import type { AuthoredAction, AuthoredSpot, ChartSet } from './preflop-chart'
import type { StrategyMeta } from './types'

/**
 * Validate + narrow a raw (JSON) chart set into a typed `ChartSet`. This is the
 * runtime half of the §6.3 "data, not code" seam: the chart set ships as
 * versioned JSON under `data/preflop-charts/<profile>/` and is loaded through
 * here so malformed data fails loudly at startup (and in CI — see
 * `charts.validation.test.ts`). The deep checks (169-class coverage, frequency
 * sums, legal sizes) live in that test; this enforces structure + types.
 */

const POSITIONS: readonly Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']
const CONFIDENCES: readonly StrategyMeta['confidence'][] = ['low', 'medium', 'high']

function isPosition(x: unknown): x is Position {
  return typeof x === 'string' && (POSITIONS as readonly string[]).includes(x)
}

function asRecord(x: unknown, what: string): Record<string, unknown> {
  if (!x || typeof x !== 'object') throw new Error(`chart set: ${what} must be an object`)
  return x as Record<string, unknown>
}

function validateAction(raw: unknown, spotId: string, i: number): AuthoredAction {
  const a = asRecord(raw, `${spotId} action[${i}]`)
  if (typeof a.id !== 'string') throw new Error(`chart set: ${spotId} action[${i}].id must be a string`)
  if (typeof a.range !== 'string') throw new Error(`chart set: ${spotId} action[${i}].range must be a string`)
  return { id: a.id, range: a.range }
}

function validateSpot(raw: unknown, i: number): AuthoredSpot {
  const s = asRecord(raw, `spots[${i}]`)
  if (typeof s.id !== 'string') throw new Error(`chart set: spots[${i}].id must be a string`)
  if (!isPosition(s.heroPosition)) throw new Error(`chart set: ${s.id} has invalid heroPosition`)
  if (s.openerPosition !== undefined && !isPosition(s.openerPosition)) {
    throw new Error(`chart set: ${s.id} has invalid openerPosition`)
  }
  if (s.threeBetPosition !== undefined && !isPosition(s.threeBetPosition)) {
    throw new Error(`chart set: ${s.id} has invalid threeBetPosition`)
  }
  if (!Array.isArray(s.actions) || s.actions.length === 0) {
    throw new Error(`chart set: ${s.id} must have a non-empty actions array`)
  }
  return {
    id: s.id,
    heroPosition: s.heroPosition,
    openerPosition: s.openerPosition as Position | undefined,
    threeBetPosition: s.threeBetPosition as Position | undefined,
    actions: s.actions.map((a, j) => validateAction(a, s.id as string, j)),
  }
}

export function loadChartSet(raw: unknown): ChartSet {
  const o = asRecord(raw, 'root')
  if (typeof o.version !== 'string') throw new Error('chart set: version must be a string')
  if (typeof o.rakeAssumption !== 'string') throw new Error('chart set: rakeAssumption must be a string')
  if (!CONFIDENCES.includes(o.confidence as StrategyMeta['confidence'])) {
    throw new Error(`chart set: confidence must be one of ${CONFIDENCES.join(', ')}`)
  }
  if (!Array.isArray(o.spots) || o.spots.length === 0) {
    throw new Error('chart set: spots must be a non-empty array')
  }
  const spots = o.spots.map(validateSpot)
  const ids = new Set<string>()
  for (const s of spots) {
    if (ids.has(s.id)) throw new Error(`chart set: duplicate spot id "${s.id}"`)
    ids.add(s.id)
  }
  return {
    version: o.version,
    rakeAssumption: o.rakeAssumption,
    confidence: o.confidence as StrategyMeta['confidence'],
    spots,
  }
}
