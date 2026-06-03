import { type Card } from '@gto/hand-eval'
import {
  decodeLiveSolverSpot,
  encodeLiveSolverSpot,
  type DecodedLiveSpot,
  type LiveSolverSpot,
} from '@gto/strategy'

/**
 * Browser glue for shareable Live Solver spots. The pure codec lives in
 * `@gto/strategy`; this maps it onto `window.location`. The leaf components
 * keep the URL in sync as the user edits (via `writeSpotToUrl`), so "copy link"
 * is just the current address — no separate snapshot to assemble.
 */

/** The spot encoded in the current URL, if any (mode + whichever fields parsed). */
export function readDecodedSpot(): DecodedLiveSpot | null {
  if (typeof window === 'undefined') return null
  return decodeLiveSolverSpot(window.location.search)
}

/** Whether the URL carries a Live Solver spot — used to deep-link into the tab. */
export function liveSpotPresent(): boolean {
  return readDecodedSpot() !== null
}

/** Whether the URL spot is the postflop mode (preflop is the default otherwise). */
export function urlModeIsPostflop(): boolean {
  return readDecodedSpot()?.mode === 'postflop'
}

/** Replace (not push) the query string with the spot — the editor shouldn't spam history. */
export function writeSpotToUrl(spot: LiveSolverSpot): void {
  if (typeof window === 'undefined') return
  const qs = encodeLiveSolverSpot(spot)
  window.history.replaceState(null, '', `${window.location.pathname}?${qs}${window.location.hash}`)
}

/** Expand a 0–2 card list (slot order) back into the picker's `[Card|null, Card|null]`. */
export function holeFromCards(cards: Card[] | undefined): [Card | null, Card | null] {
  return [cards?.[0] ?? null, cards?.[1] ?? null]
}

/** Copy the current page URL (already in sync with the spot) to the clipboard. */
export async function copyCurrentUrl(): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(window.location.href)
    return true
  } catch {
    return false
  }
}
