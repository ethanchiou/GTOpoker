# Preflop chart data

Seeded 6-max NLHE 100bb preflop GTO ranges, consumed by `@gto/strategy`'s `PreflopChartProvider`.

- One subdirectory per **chart set / rake profile**, each with a `manifest.json` describing the set
  (`version`, `rakeAssumption`, `confidence`, `stackDepthBb`) and its `spots`. Each spot is authored
  compactly with standard range strings per action; `@gto/strategy` expands them to the full 169
  hand-class grid at load time (see `spec.md` §6.3).
- Data is **versioned and tagged**, loaded through `loadChartSet()` (which validates structure +
  types) and validated in CI by `packages/strategy/src/charts.validation.test.ts`: every spot expands
  to all 169 classes, per-cell frequencies sum to ~1.0, action ids are legal, and raise sizes are
  plausible.
- Charts sit behind the `StrategyProvider` interface, so solved/licensed data can be swapped in by
  replacing the JSON (and bumping `version`/`confidence`) without touching any consumer.

## Active set

`6max_100bb_v1/` — 6-max NLHE 100bb. **Hand-authored approximations of standard published GTO norms**
(RFI opens, vs-RFI 3-bet/flat splits, opener-vs-3-bet responses), *not* solver output;
`confidence: medium`. RFI, vs-RFI (single open), and opener-facing-3-bet spots are covered; cold
4-bets and deeper trees are unmodelled and fall back to a simple bot policy.
