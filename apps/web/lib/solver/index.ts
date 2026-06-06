import {
  BaselineSolverTransport,
  type SolveRequest,
  type SolveResult,
  type SolverTransport,
} from '@gto/strategy'
import { WasmSolverTransport } from './wasm-transport'

export type SolverEngine = 'baseline' | 'wasm'

let currentEngine: SolverEngine = 'baseline'

/**
 * Set the active postflop solve engine. Called by the settings store when the
 * user flips the "exact solver" toggle; takes effect on the next solve. The
 * provider cache is keyed by node only, so the store also clears it on change.
 */
export function setSolverEngine(engine: SolverEngine): void {
  currentEngine = engine
}

export function getSolverEngine(): SolverEngine {
  return currentEngine
}

/**
 * Nodes the WASM solver computes correctly today: a first-to-act decision (no bet
 * to call). Hero OOP reads the tree root; hero IP advances past villain's check.
 * Facing-a-bet nodes need tree navigation that isn't built yet (Phase B), so they
 * route to the baseline.
 */
function wasmSupports(req: SolveRequest): boolean {
  return (req.toCallChips ?? 0) <= 0
}

/**
 * Postflop solve backend for the web app, shared by the trainer and Live Solver.
 *
 * The in-process {@link BaselineSolverTransport} is always available and is the
 * default (clearly-labeled approximate EVs). When the user opts into the WASM
 * ("exact") engine, supported nodes are solved by the real CFR equilibrium solver
 * off the main thread in a Web Worker. Unsupported nodes and ANY worker failure —
 * a missing artifact (404), a facing-a-bet node, a solver panic — fall back to the
 * baseline transparently, so the app never serves a wrong or missing result.
 *
 * Flop solves are expensive (seconds); turn/river are milliseconds. The toggle is
 * opt-in precisely so the user accepts that cost when they want exact EVs.
 */
class RoutingSolverTransport implements SolverTransport {
  private readonly baseline = new BaselineSolverTransport({ iterations: 150 })
  private wasm: WasmSolverTransport | null = null

  private wasmTransport(): WasmSolverTransport {
    // Lazy: only spin up the Worker (browser-only) the first time WASM is used.
    if (!this.wasm) this.wasm = new WasmSolverTransport()
    return this.wasm
  }

  async solve(req: SolveRequest): Promise<SolveResult> {
    if (currentEngine === 'wasm' && wasmSupports(req)) {
      try {
        return await this.wasmTransport().solve(req)
      } catch {
        return this.baseline.solve(req)
      }
    }
    return this.baseline.solve(req)
  }
}

export function createSolverTransport(): SolverTransport {
  return new RoutingSolverTransport()
}
