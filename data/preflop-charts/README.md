# Preflop chart data

Seeded 6-max NLHE 100bb preflop GTO ranges, consumed by `@gto/strategy`'s `PreflopChartProvider`.

- One subdirectory per **rake profile** (e.g. `6max_rakefree/`, `6max_GG_NL100/`), each with a
  `manifest.json` + one JSON file per spot (a 169 hand-class strategy grid). See `spec.md` §6.3.
- Data is **versioned and rake-tagged**; charts are validated in CI (all 169 classes present, per-cell
  frequencies sum to ~1.0, referenced sizes legal).
- MVP seeds from free published charts behind the `StrategyProvider` interface; solved/licensed data
  can be swapped in later without touching consumers.

Populated in Phase 1.
