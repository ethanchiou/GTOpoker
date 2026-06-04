import {
  CompositeStrategyProvider,
  MultiwayFallbackProvider,
  PostflopSolverProvider,
  PreflopChartProvider,
  SEED_CHART,
} from '@gto/strategy'
import { createSolverTransport } from './solver'

/**
 * The app's single strategy spine, shared by the trainer (`lib/store.ts`) and the
 * Live Solver tab so both hold one provider — one solve cache, one preflop chart
 * set. Preflop = chart lookup, then a derived low-confidence fallback for multiway
 * spots (squeezes / cold 4-bets); postflop = the heads-up solver (baseline transport
 * by default, WASM once built). The composite routes each node to the first
 * provider that supports it (spec §6.1), so charted linear spots always win.
 */
export const preflopProvider = new PreflopChartProvider(SEED_CHART)
export const multiwayProvider = new MultiwayFallbackProvider(preflopProvider)
export const postflopProvider = new PostflopSolverProvider(createSolverTransport(), preflopProvider)
export const strategyProvider = new CompositeStrategyProvider([
  preflopProvider,
  multiwayProvider,
  postflopProvider,
])
