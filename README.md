# GTO Poker Trainer

A Game-Theory-Optimal practice trainer for **6-max No-Limit Hold'em cash** (100bb). Play hands
against bots — each seat sees only its own cards — and get per-decision feedback on whether your
fold / check / call / bet **and bet sizing** matched GTO, expressed as **EV loss (bb)** plus the
correct **mixed-strategy frequencies**.

> Full design: [`spec.md`](./spec.md).

## Status

Early development. Preflop MVP is complete; **Phase 2 (heads-up postflop) is wired end-to-end**:
the play loop trains flop/turn/river decisions with real per-action EV via the `SolverTransport`
seam and the preflop→flop range handoff (see `spec.md` §16, Phase 2).

Two tabs ship under `/`: the **Trainer** (play + per-decision feedback, now with a **pot odds ·
chances-to-win · EV** strip) and a **Live Solver** (`spec.md` §9.7) — enter a real spot and get the
GTO answer with no hand dealt: action mix, sizing, equity, the 13×13 grid, and a "pick for us"
frequency dial. Preflop today; postflop is the planned follow-up.

By default the postflop EVs come from an in-process, clearly-labeled **baseline transport** (an
equity-driven approximation, not true GTO). The real **postflop-solver** is wired as a drop-in:
build its WASM artifact (`packages/solver-worker/BUILD.md`) and flip the web transport to get true
CFR equilibrium EVs with zero changes to any consumer.

## Next Product Step

Build the postflop-solver WASM artifact and switch the web app from the baseline transport to the
WASM transport, then validate the range-handoff and solver outputs against the WASM Postflop
reference (`spec.md` §15, Phase 2).

## Architecture (one-liner)

A framework-free TypeScript **core** (game engine, strategy, scoring, hand history) behind injected
platform interfaces, with a thin **Next.js** web UI on top. The `StrategyProvider` interface is the
spine: preflop = chart lookup (now), postflop = a heads-up CFR solver compiled to WASM (later). See
`spec.md` §4.

```
packages/
  domain-config   constants: positions, bet-size trees, rake profiles, scoring thresholds
  hand-eval       7-card evaluator + equity (permissive lib wrapper)
  poker-engine    cards, seeded deck/RNG, hand state machine, pots, DecisionPoint
  strategy        StrategyProvider, GameNodeKey, PreflopChartProvider, range/grid math,
                  SolverTransport + preflop→flop range handoff + PostflopSolverProvider
                  + an equity-based baseline transport; live-solver helpers (equity-vs-range,
                  pot odds, preflop node-builder, villain continuing range)
  scoring         EV-loss, classification, mixed-strategy credit, bet-size grading
  hand-history    internal records, PokerStars import/export, replay
  solver-worker   Rust→WASM glue crate around postflop-solver (built separately; see BUILD.md)
data/preflop-charts   6-max preflop range JSON (versioned, rake-tagged, CI-validated)
apps/web              Next.js client — Trainer | Live Solver tabs (table, controls, feedback,
                      heatmap, stats, card picker, win%/EV/pot-odds strip; Web Worker WASM
                      transport scaffold under lib/solver/)
```

## Develop

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
pnpm run build   # typecheck the whole monorepo
pnpm run lint    # dependency-cruiser boundary rules
pnpm run test    # vitest
pnpm run check   # all three
```

## Licensing

This project is open-source. The postflop solver it will embed (postflop-solver) is **AGPL-3.0**,
which is acceptable here. See [`ATTRIBUTIONS.md`](./ATTRIBUTIONS.md).
