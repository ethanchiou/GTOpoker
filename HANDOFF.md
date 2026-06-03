# HANDOFF

> Working handoff for the next engineer/agent. Pairs with [`spec.md`](./spec.md)
> (full design), [`README.md`](./README.md) (overview), and [`TODO.md`](./TODO.md)
> (running task log). Last updated: 2026-06-02 — **§7 Active priorities (Live Solver
> tab, win%/EV/pot-odds, spec WASM-tradeoff write-up) are now shipped** (see §7 for
> what landed and the clean follow-ups). The §6 backlog (WASM build, deeper preflop
> tree, persistence) is next.

## 1. What this is

A **GTO trainer for 6-max NLHE cash (100bb)**. You play practice hands vs bots and
get per-decision feedback: action + sizing graded as **EV loss (bb)** with the GTO
**mixed-strategy frequencies**. Framework-free TypeScript core behind injected
interfaces; thin Next.js web UI. Client-only. See `spec.md` for the full rationale.

## 2. Current status

Preflop MVP is complete and **Phase 2 (heads-up postflop) is wired end-to-end**.
The play loop trains flop/turn/river decisions with real per-action EV through the
`SolverTransport` seam and the preflop→flop range handoff.

**Important caveat:** by default the postflop EVs come from an in-process,
clearly-labeled **baseline transport** (an equity-driven one-shot approximation,
*not* true CFR/GTO). The real `postflop-solver` is wired as a **drop-in** behind
the same interface but its WASM artifact has **not been built** (no Rust toolchain
in this environment). Building it + flipping the transport yields true equilibrium
EVs with zero consumer changes. The UI labels the baseline ("Approximate baseline
solver") so it's never mistaken for GTO.

### Shipped this phase
- Postflop solver seam: `SolverTransport` / `SolveRequest` / `SolveResult` / weighted `Range`.
- **Preflop→flop range handoff** (`range-handoff.ts`) — derives both players' flop ranges from the preflop line. Tested.
- `PostflopSolverProvider` — HU-only (multiway flagged unsupported), solve caching, real per-action EV.
- `BaselineSolverTransport` — Monte-Carlo equity → per-action EV + softmax mix (labeled approximate).
- `GameNodeKey` enriched with optional chip context (engine-filled; preflop unaffected).
- Rust→WASM glue crate scaffold (`packages/solver-worker/`) + `BUILD.md`; browser `WasmSolverTransport` + Web Worker (opt-in).
- Flop training in the play loop; bots play postflop hand-aware via the composite provider.
- Charts refined toward standard 6-max norms and migrated to versioned JSON (`data/preflop-charts/6max_100bb_v1/`) with CI schema-validation.
- **Hand replayer** (step through any hand from seed + history; First/Prev/Next/Last + arrow keys) and a per-seat **last-move action chip**. (An earlier on-table "arrow" was removed at the user's request; the chip remains.)
- **Recent UI (verified in-browser, 2026-06-02):**
  - **Strategy-grid hover tooltip** — hovering any cell in the 13×13 chart shows that hand's per-action % (Fold/Call/Raise/All-in), color-swatched. `components/StrategyGrid.tsx`.
  - **Raise-amount slider** — the action row is trimmed to **two raise presets** (smallest + largest) + All-in, with a slider underneath for any precise raise/bet-to amount. Pure UI; commits an ordinary raise the scorer already tolerances. `components/ActionControls.tsx`.
  - **Replay-synced chart evolution** — while replaying, the right-column GTO chart follows each step (carried forward from the most recent hero decision), so the chart visibly evolves preflop→flop→turn→river and at facing-raise nodes. `lib/store.ts` (`buildReplayStrategies`/`describeNode`/`replayStrategies`) + `app/page.tsx`. These reusable pieces feed the next tasks (§7).
- **Shipped 2026-06-02 (verified in-browser; §7 tasks A/B/C):**
  - **Live Solver in-page tab** — `Trainer | Live Solver` switcher in `app/page.tsx`; the trainer markup moved into `components/TrainerView.tsx` (behavior unchanged) and a new `components/LiveSolver.tsx` renders under `/`. Preflop-only MVP: pick seat + action line (RFI / facing-raise / facing-3bet) + two hole cards → action mix, GTO sizing, pot odds, **win%**, EV (preflop "—"), full 13×13 grid, and a transparent **"Pick for us" Roll dial** (`components/ActionRandomizer.tsx`) that samples the GTO mix. Card picker: `components/CardPicker.tsx`.
  - **Trainer win% · EV · pot-odds strip** — `components/DecisionStats.tsx` (shared `components/StatStrip.tsx`) under the action controls on the live decision.
  - **Shared core helpers** (in `@gto/strategy` for CI coverage): `equityVsRange` + `potOddsPct` (`equity-vs-range.ts`), `buildPreflopLineNode` + `positionsBefore/After` (`live-node.ts`), and `villainContinuingRange` (`range-handoff.ts`). Tests: `equity-vs-range.test.ts`, `live-node.test.ts`. The web provider construction was extracted to `apps/web/lib/strategyProvider.ts` so both tabs share one provider + solve cache.
  - **spec.md §6.5** — the baseline→WASM transport-swap tradeoffs (benefits / costs / why baseline stays default).

## 3. Scope

**In scope:** 6-max NLHE cash, 100bb. Preflop + heads-up postflop training.
Per-decision feedback (EV loss + frequencies + classification). Session stats.
GTO bots. Client-only web app. Seedable/reproducible decks.

**Out of scope (do not build without a decision):** real-money play; online
multiplayer; tournaments/ICM; table sizes other than 6-max; a backend/server;
building a CFR solver from scratch; node-locking (later phase); the mobile app
(architecture enables it, v1 doesn't build it). See `spec.md` §2.

## 4. Architecture map (where things live)

```
packages/
  domain-config   positions, bet-size trees, rake profiles, scoring thresholds
  hand-eval       cards, seeded RNG, 7-card evaluator, equity (MC + exact)
  poker-engine    deck, hand state machine (pure reducer), pots, DecisionPoint, GameNodeKey
  strategy        StrategyProvider spine; PreflopChartProvider; chart-loader;
                  SolverTransport + range-handoff (+ villainContinuingRange) + PostflopSolverProvider
                  + BaselineSolverTransport; equity-vs-range (equityVsRange/potOddsPct); live-node
                  (buildPreflopLineNode — fabricates a preflop GameNodeKey without playing a hand)
  scoring         EV-loss, classification, mixed-strategy credit, bet-size grading, session stats
  hand-history    STUB (Phase 3: PokerStars import/export + replay records)
  solver-worker   Rust→WASM glue around postflop-solver (built separately; see BUILD.md)
data/preflop-charts/6max_100bb_v1/manifest.json   active chart set (versioned, CI-validated)
apps/web         Next.js client: app/page.tsx (Trainer | Live Solver tab shell), lib/store.ts (Zustand),
                 lib/strategyProvider.ts (shared provider+cache), lib/replay.ts, lib/solver/ (transport+worker),
                 components/ (TrainerView, LiveSolver, CardPicker, StatStrip, DecisionStats, ActionRandomizer,
                 table, controls, feedback, heatmap, replay controls)
```

Key seam: everything routes through `StrategyProvider`. The web app holds one
`CompositeStrategyProvider([preflop chart, postflop solver])`.

## 5. Run & verify

```bash
pnpm install
pnpm run check          # build (tsc) + lint (depcruise) + test (vitest) — 114 tests, the CI gate
cd apps/web && npx tsc --noEmit && npx next build   # web is NOT in the root check/CI (see gotchas)
cd apps/web && npx next dev      # dev server → http://localhost:3000
```

## 6. TODO (prioritized)

> **Note (2026-06-02):** the agreed immediate work is now **§7 Active priorities**
> (live-solver in-page tab + win%/EV/pot-odds + a spec.md tradeoff write-up). The WASM
> build below is **deferred behind those**; its full pros/cons get documented as
> task §7.A.

1. **Build the real solver.** `packages/solver-worker/BUILD.md`: install rustup +
   wasm-pack, `wasm-pack build --target web --release`, copy `pkg/` →
   `apps/web/public/solver/`, switch `createSolverTransport()` (apps/web/lib/solver/index.ts)
   to `WasmSolverTransport`. Resolve the `VERIFY:` markers in `src/lib.rs` against
   the pinned crate version. This produces the deferred **perf-spike number**.
2. **Validate correctness** of the range-handoff + solver outputs against the WASM
   Postflop reference within tolerance (spec §15, Phase 2). Also handle the
   facing-a-bet node navigation TODO in `lib.rs` (currently reads the root node).
3. **Upgrade the preflop data** from hand-authored approximations to solved/licensed
   ranges: swap the JSON under `data/preflop-charts/`, bump `version`/`confidence`.
   The `charts.validation.test.ts` guard enforces structure.
4. **Deeper preflop tree:** cold 4-bets, 5-bets, squeeze, cold-call branches
   (currently unmodelled → bots fall back to a simple policy; nodes report unsupported).
5. **Postflop UX:** cumulative per-hand EV feedback across streets; pre-solve-on-flop
   with a progress/abort affordance (baseline currently solves on the main thread
   behind the busy spinner; WASM moves it off-thread).
6. **Persistence:** sessions + hand histories to IndexedDB behind the `SessionStore`
   interface (build out the `hand-history` stub; PokerStars import/export — Phase 3).
7. **Drill modes** by position, action type, and leak category (Phase 4).
8. **Optional polish:** per-replay-step GTO chart overlay is **done** (the right-column
   chart now follows each replay step — see §2 Recent UI). Still open: the *feedback
   panel* during replay shows the last *live* decision, not the replayed step's score;
   wire it to the step if desired. Consider restoring a subtler last-move indicator.

## 7. Active priorities — ✅ SHIPPED 2026-06-02

All three landed and were verified in-browser (no console errors); `pnpm run check`
(130 tests) + `apps/web` tsc/next build are green. The original specs are kept below
for reference. **Clean follow-ups left open** (none blocking):
- **Live Solver postflop extension** — add a board picker + bet-size inputs; the
  postflop solver provider already serves those nodes. The shared helpers
  (`buildPreflopLineNode`, `villainContinuingRange`, `equityVsRange`, `StatStrip`,
  `CardPicker`) were kept street-agnostic so this extends rather than rewrites.
- **Live Solver EV** — preflop shows "—" (charts carry no EV). Real EVs arrive with the
  WASM solver (§6.5) for postflop, or solved preflop data for preflop.
- **Live Solver state** is component-local and resets when you switch tabs (trainer
  state persists via its store). Lift to a small store if cross-tab persistence is wanted.
- **Villain sizing in the node-builder** uses standard charted sizes (open 2.5/3bb,
  3-bet 11/10bb); `recordedActionId` snaps regardless. Revisit if you add size inputs.

Original task specs (now implemented):

Three tasks, in order. These supersede the §6 backlog ordering (the WASM build is
deferred behind them). **A** is a doc task; **B** is the headline feature; **C** is
a smaller add to the existing trainer page.

### 7.A — Document the WASM-solver-swap tradeoffs in `spec.md`
Add a subsection (alongside the Phase-2 / `SolverTransport` material — e.g. spec §15
or the solver section) on swapping `BaselineSolverTransport` → `WasmSolverTransport`.
Cover the full picture so the decision is captured, not just the how:
- **Benefits:** true Nash-equilibrium frequencies + per-action EV (not one-shot
  estimates); fixes the baseline's documented limits — single street of action (no
  future-street range narrowing / implied odds), one representative combo per
  hand-class (no blockers / suit specificity), coarse size-based fold equity, softmax
  temperature is a heuristic; **scoring and all UI sharpen automatically** because they
  read the same `SolveResult`; **zero consumer changes** (same `SolverTransport` seam —
  `PostflopSolverProvider`, scoring, grid, tooltip, replay-evolution untouched).
- **Costs / tradeoffs:** AGPL-3.0 copyleft on `postflop-solver` (distribution/hosting
  implications — flag for any deploy); multi-MB `.wasm` first-load (bundle/perf); real
  per-solve compute (hence the Web Worker + the deferred pre-solve-on-flop/abort
  budget); `solver-worker/src/lib.rs` is an **unverified scaffold** (`VERIFY:` markers)
  with a known **facing-a-bet node-navigation TODO** (reads the root node); build needs
  `rustup` + `wasm-pack` and is **not in CI**.
- **Why baseline stays default for now:** zero build, in-process, deterministic
  (seeded), fast enough for dev/CI; clearly labeled "Approximate baseline solver" and
  kept as the automatic fallback. Cross-link `packages/solver-worker/BUILD.md` + the §2 caveat.

### 7.B — PRIORITY: new "Live Solver" in-page tab
A **preflop-only MVP** live-play assistant, surfaced as an **in-page tab** next to the
trainer: the user enters their real spot and it shows the GTO answer live (no hand is
dealt/played). **Turn/river postflop is in scope for a later build** — the same
inputs/outputs + components extend to it once a board picker + bet-size inputs are added
(the postflop solver provider already serves those nodes). Build the MVP so that
extension is clean (don't hard-code preflop-only assumptions into shared helpers).

- **In-page tab (no new route):** add a header tab switcher — **Trainer** | **Live
  Solver** — driven by top-level state. Extract the current trainer markup from
  `app/page.tsx` into a `TrainerView` component, add a `LiveSolver` component, and have
  `app/page.tsx` render whichever tab is active (both stay under `/`). Keep the existing
  trainer behavior byte-for-byte identical.
- **Inputs (recompute outputs on every change):**
  - Hero **seat/position** — SB · BB · UTG · HJ · CO · BTN (segmented control).
  - **Action line** — who raised, if anyone: none → hero RFI; one opener → facing RFI
    (pick opener seat); opener + 3-bettor → facing 3-bet. Maps 1:1 onto
    `classifyPreflop` spot ids (`rfi/<pos>`, `vsRfi/<hero>/vs<opener>`,
    `vs3bet/<hero>/vs<3bettor>`); show "unsupported" for spots the charts don't cover.
  - Hero **hole cards** — a **two-card picker** (rank × suit, no dupes). Drives
    pot-odds / EV / chances-to-win and selects the hand-class row in the chart.
  - Stack depth default **100bb** (charts are 100bb); expose later.
- **Outputs:**
  - **Action mix %** — call/fold/raise(/all-in) for the selected hand from
    `provider.getStrategy(node).grid[handClass]` (reuse `StrategyMix` + the cell tooltip).
  - **GTO sizing** — recommended raise/bet-to (bb) from the chart action ids / size tree.
  - **EV** per action — solver nodes carry `a.ev`; **preflop charts carry no EV** (show
    "—" or derive a simple preflop EV — decide).
  - **Pot odds** — `toCall / (pot + toCall)`, arithmetic from the node's chip context.
  - **Chances to win (equity)** — Monte-Carlo of the hero hand vs the villain
    *continuing* range; reuse `@gto/hand-eval` equity + `range-handoff` `buildPreflopRange`.
  - Optional: the full 13×13 chart for context (reuse `StrategyGrid`, highlight the hand).
- **"Pick for us" randomizer dial** — when the mix is non-pure, sample an action
  weighted by the GTO frequencies (reuse the strategy package's weighted sampler — same
  logic as `decideGtoAction` / bot sampling). Visual: a dial/wheel that lands on the
  chosen action and shows the rolled value (transparent). Only acts when prompted.
- **Reuse / refactor:** extract the `CompositeStrategyProvider` construction out of
  `lib/store.ts` (lines ~71-73) into a shared module (e.g. `lib/strategyProvider.ts`) so
  both pages share one provider + solve cache. Also needs a small **node builder** that
  fabricates a `GameNodeKey` + chip context (pot/toCall/effStack) for an arbitrary chosen
  preflop line **without** playing a hand (deterministic from blinds + open/3-bet sizes).
- **Resolved decisions (2026-06-02):** (1) **in-page tab**, not a separate route;
  (2) **two-card hand picker** — per-hand, not range-level; (3) **preflop-only MVP**,
  turn/river a planned follow-up (keep shared helpers street-agnostic so it extends).
  Remaining item is an implementation detail (agent's call, not a user decision): the
  **node-builder contract** — a helper that fabricates a `GameNodeKey` + chip context for
  a chosen preflop line without playing a hand (pot / toCall / effStack are deterministic
  from the blinds + the open/3-bet sizes in the bet-size tree).

### 7.C — Add chances-to-win / EV / pot-odds to the **trainer page** too
Surface the same three numbers for the hero's current hand on the existing decision view:
- **Pot odds** — `decision.toCallChips` / pot; always available, pure arithmetic.
- **Chances to win** — hero hole cards vs villain continuing range (reuse equity +
  range-handoff; postflop uses the live board, preflop the opener/3-bettor charted range).
- **EV** — already per-action in `StrategyMix` for solver nodes; add a headline / keep consistent.
- **Placement:** a compact, labeled stat strip near `ActionControls` / the feedback panel.
  Keep it small — don't clutter the table view. Build the equity/pot-odds helper once and
  share it with §7.B.

## 8. Gotchas / non-obvious constraints

- **`apps/web` is not typechecked or built in CI.** The root `tsconfig.json` and CI
  only cover `packages/*/src`. Always run `cd apps/web && tsc --noEmit && next build`
  manually after touching the web app.
- **Baseline transport EVs are approximate** (one-shot equity + size-based fold
  equity; facing-a-bet models only fold/call). Labeled in the UI. Real EVs need the WASM.
- **`solver-worker/src/lib.rs` is an unverified scaffold** — written against the
  documented API but never compiled here. Expect to fix a few `VERIFY:` spots.
- **Multiway postflop is unsupported by design** (HU-by-the-flop only); such nodes
  are flagged in the UI and not graded.
- **Determinism:** decks are seed-derived; the replayer relies on re-creating a hand
  from its `handId`/seed + re-applying `history` (see `replay-reconstruction.test.ts`).
  Don't break that contract.
- **`pnpm run check` is the gate** (build + lint + test). Keep it green. depcruise
  enforces the platform-agnostic-core boundaries (no react/next in core, no cycles).
- A dev server started in a session **stops when the session ends**; restart with the
  command in §5.
```
