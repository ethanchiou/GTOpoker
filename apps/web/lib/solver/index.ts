import { BaselineSolverTransport, type SolverTransport } from '@gto/strategy'

/**
 * Postflop solve backend for the web app.
 *
 * Defaults to the in-process {@link BaselineSolverTransport} so the app runs with
 * no extra build step (clearly-labeled approximate EVs — see the panel note in
 * the UI). To use real CFR equilibrium EVs, build the WASM artifact
 * (packages/solver-worker/BUILD.md), copy `pkg/` to `public/solver/`, then swap
 * the return below for `new WasmSolverTransport()` from `./wasm-transport`.
 *
 * The baseline's iteration count is kept modest so a flop pre-solve stays
 * responsive on the main thread; the WASM path runs off-thread in a Web Worker.
 */
export function createSolverTransport(): SolverTransport {
  return new BaselineSolverTransport({ iterations: 150 })
}
