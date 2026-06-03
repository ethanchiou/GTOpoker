import manifest from '../../../data/preflop-charts/6max_100bb_v1/manifest.json'
import { loadChartSet } from './chart-loader'
import type { ChartSet } from './preflop-chart'

/**
 * The active 6-max NLHE 100bb preflop chart set, loaded from versioned JSON data
 * (`data/preflop-charts/6max_100bb_v1/manifest.json`) through the validating
 * loader (spec §6.3). These ranges are **hand-authored approximations of
 * standard published 6-max GTO norms** — RFI opens, 3-bet/flat splits, and
 * opener-vs-3-bet responses — not solver output. They are versioned and
 * swappable behind the `StrategyProvider` interface: replace the JSON with
 * solved/licensed data (bumping `version` and `confidence`) without touching any
 * consumer. Sizes use the `raiseTo:<bb>` convention; `data/preflop-charts/`
 * documents coverage and the validation contract.
 */
export const SEED_CHART: ChartSet = loadChartSet(manifest)
