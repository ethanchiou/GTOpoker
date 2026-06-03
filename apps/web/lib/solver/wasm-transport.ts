import type { SolveRequest, SolveResult, SolverTransport } from '@gto/strategy'
import type { SolveRequestMessage, SolveResponseMessage } from './protocol'

/**
 * SolverTransport backed by the postflop-solver WASM running in a Web Worker.
 * Opt-in: enable it from `./index.ts` once the artifact is built
 * (packages/solver-worker/BUILD.md). Drops into the exact `SolverTransport`
 * contract, so the PostflopSolverProvider and everything above it is unchanged.
 */
export class WasmSolverTransport implements SolverTransport {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (r: SolveResult) => void; reject: (e: Error) => void }
  >()

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./solver.worker.ts', import.meta.url))
      this.worker.onmessage = (e: MessageEvent<SolveResponseMessage>) => {
        const entry = this.pending.get(e.data.id)
        if (!entry) return
        this.pending.delete(e.data.id)
        if (e.data.ok) entry.resolve(e.data.result)
        else entry.reject(new Error(e.data.error))
      }
    }
    return this.worker
  }

  solve(request: SolveRequest): Promise<SolveResult> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<SolveResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const msg: SolveRequestMessage = { id, request }
      worker.postMessage(msg)
    })
  }
}
