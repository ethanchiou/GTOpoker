import {
  CompositeStrategyProvider,
  PostflopSolverProvider,
  PreflopChartProvider,
  SEED_CHART,
} from '@gto/strategy'
import { createSolverTransport } from './solver'

/**
 * The app's single strategy spine, shared by the trainer (`lib/store.ts`) and the
 * Live Solver tab so both hold one provider — one solve cache, one preflop chart
 * set. Preflop = chart lookup; postflop = the heads-up solver (baseline transport
 * by default, WASM once built). The composite routes each node to its provider
 * (spec §6.1).
 */
export const preflopProvider = new PreflopChartProvider(SEED_CHART)
export const postflopProvider = new PostflopSolverProvider(createSolverTransport(), preflopProvider)
export const strategyProvider = new CompositeStrategyProvider([preflopProvider, postflopProvider])
