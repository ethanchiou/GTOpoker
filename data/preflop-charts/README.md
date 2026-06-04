# Preflop chart data

Seeded 6-max NLHE 100bb preflop GTO ranges, consumed by `@gto/strategy`'s `PreflopChartProvider`.

- One subdirectory per **chart set / rake profile**, each with a `manifest.json` describing the set
  (`version`, `rakeAssumption`, `confidence`, `stackDepthBb`) and its `spots`. Each spot is authored
  compactly with standard range strings per action; `@gto/strategy` expands them to the full 169
  hand-class grid at load time (see `spec.md` §6.3).
- Data is **versioned and tagged**, loaded through `loadChartSet()` (which validates structure +
  types) and validated in CI by `packages/strategy/src/charts.validation.test.ts`: every spot expands
  to all 169 classes, per-cell frequencies sum to ~1.0, action ids are legal, and raise sizes are
  plausible. `charts.sanity.test.ts` additionally guards against silently-folded holes — a premium
  hand (e.g. AQo) omitted from every action range compiles to a 100% fold, which is valid JSON but a
  strategy bug; the guard fails CI if such a hand pure-folds in an RFI/defense/3-bet/4-bet/5-bet spot.
- Charts sit behind the `StrategyProvider` interface, so solved/licensed data can be swapped in by
  replacing the JSON (and bumping `version`/`confidence`) without touching any consumer.

## Active set

`6max_100bb_v1/` — 6-max NLHE 100bb. **Hand-authored approximations of standard published GTO norms**,
*not* solver output; `confidence: medium`. 65 spots covering the full linear tree:

| Family | Spots | Hero faces |
| --- | --- | --- |
| `rfi/{pos}` | 5 | first-in open |
| `vsRfi/{hero}/vs{opener}` | 15 | a single open |
| `vs3bet/{hero}/vs{threeBettor}` | 15 | a 3-bet (opener's response) |
| `vs4bet/{hero}/vs{fourBettor}` | 15 | a 4-bet (3-bettor's response) |
| `vs5bet/{hero}/vs{fiveBettor}` | 15 | a 5-bet jam (opener's call/fold) |

The 4-bet/5-bet tree is closed at 100bb (a 5-bet is all-in → call/fold). **Multiway** lines
(squeezes, cold-calls, cold 4-bets) are not charted here; they are served by a *derived*
low-confidence fallback (`multiway-fallback.ts`) that transforms the nearest heads-up chart, so bots
never silently fold them. Deeper multiway trees (3+ raises) fall back to a simple bot policy.
