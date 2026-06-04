import { useEffect, useRef } from 'react'
import { recordHandSimulated, type HandSource } from './analytics'

/**
 * Records one `hand_simulated` event per spot the user actually *settles* on,
 * instead of on every intermediate re-derivation.
 *
 * The Live Solver re-derives its spot key on every input change, and a single
 * change can cascade through several intermediate keys before settling — counting
 * each one floods the metric (see the over-count investigation). This hook fixes
 * that two ways:
 *   - Debounce: the event fires only after `spotKey` holds steady for `delayMs`,
 *     so the settling cascade and rapid manual tweaks collapse into one count.
 *   - Dedupe: each distinct key is counted at most once per mount, so revisiting
 *     an earlier spot never recounts it.
 *
 * Pass `null` when there is no valid/complete spot (nothing is counted then).
 */
export function useSettledSpotCounter(spotKey: string | null, source: HandSource, delayMs = 750): void {
  const counted = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!spotKey || counted.current.has(spotKey)) return
    // Restart the settle timer on every key change; it only fires once the key
    // has been stable for `delayMs`. The cleanup cancels it if the key changes
    // again first, so intermediate cascade states never count.
    timer.current = setTimeout(() => {
      counted.current.add(spotKey)
      recordHandSimulated(source)
    }, delayMs)
    return () => clearTimeout(timer.current)
  }, [spotKey, source, delayMs])
}
