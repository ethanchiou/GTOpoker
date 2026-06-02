import type { Position } from '@gto/domain-config'
import type { GameNodeKey } from '@gto/poker-engine'
import { ALL_HAND_CLASSES, type HandClass } from './hand-class'
import { parseRange } from './range'
import type { ActionFrequency, ActionId, NodeStrategy, StrategyMeta, StrategyProvider } from './types'

export interface AuthoredAction {
  id: ActionId
  range: string
}

/** One preflop spot, authored compactly with range strings (spec §6.3). */
export interface AuthoredSpot {
  id: string
  heroPosition: Position
  openerPosition?: Position
  /** Non-fold actions; whatever frequency is left over folds. */
  actions: AuthoredAction[]
}

export interface ChartSet {
  version: string
  rakeAssumption: string
  confidence: StrategyMeta['confidence']
  spots: AuthoredSpot[]
}

interface CompiledSpot {
  actions: ActionId[]
  grid: Record<HandClass, ActionFrequency[]>
}

function compileSpot(spot: AuthoredSpot): CompiledSpot {
  const ranges = spot.actions.map((a) => ({ id: a.id, map: parseRange(a.range) }))
  const grid: Record<HandClass, ActionFrequency[]> = {}
  for (const cls of ALL_HAND_CLASSES) {
    const entries: ActionFrequency[] = []
    let sum = 0
    for (const r of ranges) {
      const f = r.map.get(cls) ?? 0
      if (f > 0) {
        entries.push({ actionId: r.id, frequency: f })
        sum += f
      }
    }
    if (sum > 1.0001) {
      throw new Error(`Spot "${spot.id}" assigns ${sum.toFixed(3)} > 1 to ${cls}`)
    }
    const foldFreq = 1 - sum
    if (foldFreq > 1e-6) entries.push({ actionId: 'fold', frequency: foldFreq })
    grid[cls] = entries
  }
  return { actions: [...spot.actions.map((a) => a.id), 'fold'], grid }
}

interface PreflopScenario {
  spotId: string
}

/** Classify a preflop node into a chart spot id (RFI or vs-RFI), or null. */
export function classifyPreflop(node: GameNodeKey): PreflopScenario | null {
  if (node.street !== 'preflop') return null
  const raises = node.history.filter((a) => a.action.type === 'raise')
  const hero = node.heroPosition
  if (raises.length === 0) {
    if (hero === 'BB') return null // the BB never opens first-in
    return { spotId: `rfi/${hero}` }
  }
  if (raises.length === 1) {
    const opener = raises[0]!.position
    return { spotId: `vsRfi/${hero}/vs${opener}` }
  }
  return null // 3-bet pots and deeper are not modelled in the MVP charts
}

export class PreflopChartProvider implements StrategyProvider {
  private readonly spots: Map<string, AuthoredSpot>
  private readonly cache = new Map<string, CompiledSpot>()
  private readonly meta: StrategyMeta

  constructor(private readonly chart: ChartSet) {
    this.spots = new Map(chart.spots.map((s) => [s.id, s]))
    this.meta = {
      source: 'chart',
      confidence: chart.confidence,
      rakeAssumption: chart.rakeAssumption,
      version: chart.version,
    }
  }

  supports(node: GameNodeKey): boolean {
    const scenario = classifyPreflop(node)
    return scenario !== null && this.spots.has(scenario.spotId)
  }

  async getStrategy(node: GameNodeKey): Promise<NodeStrategy> {
    const scenario = classifyPreflop(node)
    if (!scenario || !this.spots.has(scenario.spotId)) {
      throw new Error(`PreflopChartProvider does not support this node`)
    }
    const compiled = this.compiled(scenario.spotId)
    return { spotId: scenario.spotId, actions: compiled.actions, grid: compiled.grid, meta: this.meta }
  }

  private compiled(spotId: string): CompiledSpot {
    let c = this.cache.get(spotId)
    if (!c) {
      c = compileSpot(this.spots.get(spotId)!)
      this.cache.set(spotId, c)
    }
    return c
  }
}

/** Routes a node to the first provider that supports it (spec §6.1). */
export class CompositeStrategyProvider implements StrategyProvider {
  constructor(private readonly providers: StrategyProvider[]) {}

  supports(node: GameNodeKey): boolean {
    return this.providers.some((p) => p.supports(node))
  }

  async getStrategy(node: GameNodeKey): Promise<NodeStrategy> {
    const provider = this.providers.find((p) => p.supports(node))
    if (!provider) throw new Error('No strategy provider supports this node')
    return provider.getStrategy(node)
  }
}
