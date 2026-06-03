import { decodeHandLink, encodeHandLink, type HandLink } from '@gto/poker-engine'

/**
 * Browser glue for shareable trainer hands. The pure codec lives in
 * `@gto/poker-engine`; this maps it onto `window.location`. Unlike the Live
 * Solver, the trainer does NOT continuously sync the address bar — refresh is
 * meant to deal a fresh random hand. "Copy link" builds a one-off shareable URL
 * for the current hand; opening such a URL deep-links into that exact hand.
 */

/** The hand encoded in the current URL, if any. */
export function readHandLink(): HandLink | null {
  if (typeof window === 'undefined') return null
  return decodeHandLink(window.location.search)
}

/** Whether the URL carries a trainer hand link. */
export function handLinkPresent(): boolean {
  return readHandLink() !== null
}

/** Absolute shareable URL for a hand (does not mutate the address bar). */
export function handLinkUrl(link: HandLink): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}?${encodeHandLink(link)}`
}

/** Copy a hand's shareable URL to the clipboard. */
export async function copyHandLink(link: HandLink): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(handLinkUrl(link))
    return true
  } catch {
    return false
  }
}

/** Drop a stale hand link from the address bar (e.g. when dealing a new hand). */
export function clearHandLinkFromUrl(): void {
  if (typeof window === 'undefined') return
  if (decodeHandLink(window.location.search)) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
  }
}
