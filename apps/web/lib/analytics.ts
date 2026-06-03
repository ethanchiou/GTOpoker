// Private, owner-only usage counter.
//
// Fires a single `hand_simulated` event to PostHog's HTTP capture API each time a
// hand is simulated — in the trainer (a dealt hand) or the live solver (a distinct
// spot solved). Nothing is ever rendered in the app: the totals live only in your
// PostHog dashboard. No SDK (so no bundle bloat), no cookies, no autocapture, no
// page tracking, no PII — just the count.
//
// Configure at build time (a static export inlines `NEXT_PUBLIC_*`):
//   NEXT_PUBLIC_POSTHOG_KEY   — PostHog project API key (a public, ingest-only key)
//   NEXT_PUBLIC_POSTHOG_HOST  — optional; defaults to https://us.i.posthog.com
//
// With no key set — e.g. local `next dev` — every call is a silent no-op, so your
// own testing never inflates the number. Events also carry `{ env }` so you can
// filter non-production out in the dashboard. To keep production clean, simply do
// not set the key anywhere but the production deploy.

export type HandSource = 'trainer' | 'live-solver'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

// A stable per-browser id (no PII) so PostHog can also report unique users, not
// just raw event volume. Falls back to a constant if storage is unavailable.
let distinctId: string | null = null
function anonId(): string {
  if (distinctId) return distinctId
  try {
    const stored = localStorage.getItem('gto_anon_id')
    distinctId = stored ?? crypto.randomUUID()
    if (!stored) localStorage.setItem('gto_anon_id', distinctId)
  } catch {
    distinctId = 'anonymous'
  }
  return distinctId
}

/**
 * Record one simulated hand. Fire-and-forget: never blocks the UI, never throws,
 * and does nothing when no PostHog key is configured.
 */
export function recordHandSimulated(source: HandSource): void {
  if (!KEY || typeof window === 'undefined') return
  try {
    void fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true, // survive a tab close / navigation right after the action
      body: JSON.stringify({
        api_key: KEY,
        event: 'hand_simulated',
        distinct_id: anonId(),
        properties: { source, env: process.env.NODE_ENV },
      }),
    }).catch(() => {}) // analytics must never surface an error to the user
  } catch {
    // ignore — counting a hand can never be allowed to break the app
  }
}
