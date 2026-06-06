/// <reference lib="webworker" />
import type { SolveRequestMessage, SolveResponseMessage } from './protocol'

/**
 * Web Worker that runs the postflop-solver WASM off the main thread (spec §4.7).
 * The wasm-pack artifact (packages/solver-worker/BUILD.md) is loaded lazily at
 * runtime and ignored by the bundler, so the app builds without it present. This
 * file is only loaded when WasmSolverTransport is enabled.
 */

type WasmSolve = (json: string) => string

let wasmSolve: WasmSolve | null = null

async function ensureWasm(): Promise<WasmSolve> {
  if (wasmSolve) return wasmSolve
  // Resolved at runtime; not statically bundled (non-literal specifier + the
  // webpackIgnore hint). Copy the built pkg to /public/solver/ (see BUILD.md) so
  // this URL serves the artifact; until then this import throws and the app uses
  // the baseline transport.
  const artifactUrl = '/solver/gto_solver_wasm.js'
  const mod = (await import(/* webpackIgnore: true */ artifactUrl)) as {
    default: () => Promise<unknown>
    solve: WasmSolve
  }
  await mod.default()
  wasmSolve = mod.solve
  return wasmSolve
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<SolveRequestMessage>) => {
  const { id, request } = e.data
  try {
    const solve = await ensureWasm()
    const result = JSON.parse(solve(JSON.stringify(request)))
    // The WASM `solve` returns `{error}` for a bad request or an unsupported node
    // (e.g. facing a bet). Surface it as a rejection so the routing transport
    // falls back to the baseline instead of resolving with a result-less object.
    if (result && typeof result.error === 'string') throw new Error(result.error)
    const ok: SolveResponseMessage = { id, ok: true, result }
    ctx.postMessage(ok)
  } catch (err) {
    const fail: SolveResponseMessage = { id, ok: false, error: String(err) }
    ctx.postMessage(fail)
  }
}
