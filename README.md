# GTO Poker Trainer

A Game-Theory-Optimal practice trainer for **6-max No-Limit Hold'em cash** (100bb). Play hands
against bots — each seat sees only its own cards — and get per-decision feedback on whether your
fold / check / call / bet **and bet sizing** matched GTO, expressed as **EV loss (bb)** plus the
correct **mixed-strategy frequencies**.

> Full design: [`spec.md`](./spec.md).

## Status

Early development. **v1 = preflop-first MVP** (see `spec.md` §2.2 and the phased roadmap §16).

## Next Product Step

Progress beyond the preflop MVP: train flop, turn, and river decisions instead of immediately
running postflop to showdown. Board cards should continue to come from the shuffled deck each hand
so flop/turn/river runouts are random, while bot actions should remain hand-aware through the
strategy provider so weak holdings do not take aggressive sizes at unrealistic frequencies.

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
  strategy        StrategyProvider, GameNodeKey, PreflopChartProvider, range/grid math
  scoring         EV-loss, classification, mixed-strategy credit, bet-size grading
  hand-history    internal records, PokerStars import/export, replay
data/preflop-charts   seeded 6-max preflop range JSON (versioned, rake-tagged)
apps/web              Next.js client (added in Phase 1)
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
