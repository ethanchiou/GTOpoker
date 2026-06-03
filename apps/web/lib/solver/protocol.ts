import type { SolveRequest, SolveResult } from '@gto/strategy'

/** Main-thread → worker: a solve request tagged with a correlation id. */
export interface SolveRequestMessage {
  id: number
  request: SolveRequest
}

/** Worker → main-thread: the solve result (or an error) for a request id. */
export type SolveResponseMessage =
  | { id: number; ok: true; result: SolveResult }
  | { id: number; ok: false; error: string }
