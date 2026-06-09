# HANDOFF

> Working handoff for the next engineer/agent. Pairs with [`spec.md`](./spec.md)
> (full design), [`README.md`](./README.md) (overview), and [`TODO.md`](./TODO.md)
> (running task log). Last updated: 2026-06-07 — the **real WASM solver is built
> and wired in as an opt-in engine** (task 4: Phase A first-to-act + Phase B
> facing-a-bet, browser-verified), and **task 5 is complete: solver correctness
> validation** (spec §15 Phase 2) lands against a **crate-native reference** with
> the WASM build + validation now running in a dedicated CI job; see §2.1.
> **Immediate next task:** task 6 — **preflop data/tree depth** (solved/licensed
> ranges; promote multiway). On branch `feat/wasm-postflop-solver`. Remaining
> tasks 6-7 in §2.1 + `TODO.md`.

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
*not* true CFR/GTO). The real `postflop-solver` WASM is now **built and wired in
as an opt-in engine** — the **"Exact solver"** setting flips a `RoutingSolverTransport`
to the real CFR solver (Web Worker) for the streets/nodes it supports, with
transparent baseline fallback. Baseline stays the default. **Phase A** (build +
first-to-act nodes, OOP root + IP-after-check) and **Phase B** (facing-a-bet
nodes, via street-action-path replay) are both done and browser-verified, so the
WASM engine now serves the full set of heads-up postflop nodes. The UI note
reflects the real engine per result ("Exact CFR solve (WASM)" vs "Approximate
baseline solver").

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

## 2.1 Tasks 4 & 5 — COMPLETE. Next: task 6

> **Task 5 landed 2026-06-07 — solver correctness validation (spec §15 Phase 2).**
> Validated against a **crate-native reference**: a separate binary crate
> (`packages/solver-worker/reference/`) links `postflop-solver` directly (the exact
> engine wasm-postflop runs, independent of our glue) and solves each spot from its
> *true* street-start values. Because both run the same engine, this is a
> differential test of **our glue** — range encoding, the street-start
> pot/effective-stack reconstruction (`lib.rs` derives them from the request; the
> reference uses the true values), the Phase B replay/snap, and the per-action EV
> read. Four parts: **(A)** our WASM vs the reference within tolerance per
> combo/action (subsumes the per-node weight-normalization read); **(B)** range
> handoff — exact combo enumeration, multi-action weight products, `recordedActionId`
> snapping, `villainContinuingRange`; **(C)** a baseline-vs-exact drift monitor
> (logged: baseline tracks well first-to-act/river, drifts ~0.45 mean on turn
> facing-bet — the documented approximation, quantified); **(D)** solve-cache
> identity + determinism; **(E)** graceful degradation — over-budget / too-large
> trees decline to the baseline instead of trapping the wasm worker (see the
> robustness fix below). Pure-TS parts (B, cache) run in `pnpm run check`
> (`packages/strategy/src/solver-validation.test.ts`, +13 tests); WASM parts run in
> a new **`wasm` CI job** that also closes the `apps/web` build gate
> (`solver-wasm.test.ts`, +17 tests, `skipIf` pkg-node absent). See
> `BUILD.md` → Validation. **Verified:** `pnpm run check` (305 tests) +
> `build:solver:node` + `validate:solver:reference` + the WASM suite + `apps/web`
> tsc/`next build`, all green, plus a headless-Chrome QA pass (Exact CFR solve
> renders for facing-a-bet and first-to-act turn spots; no console errors).
>
> **Robustness fix (found in task-5 QA).** Large trees made the WASM `solve` panic
> via `.unwrap()` — `PostFlopGame::with_config` returns `Err("Too many nodes")` for
> a wide flop, and `allocate_memory` panics (`base.rs` isize::MAX guard) when CFR
> storage is too big. A wasm panic **traps the instance**. Fixed in `lib.rs`: the
> build calls now `map_err(...)?` to a typed Err, and a `memory_usage()` pre-check
> (valid post-build, pre-alloc) declines over a `MAX_SOLVE_BYTES` budget (~1.86 GiB,
> tunable per request via `maxSolveBytes`). All three paths return a typed Err →
> the routing transport serves the baseline — no trap, no scary console panic, fast
> deterministic fallback. (The flop still can't solve exactly in wasm; it now
> degrades cleanly. Real flop solves remain task 7: pre-solve/abort/perf.)

> **Phase B landed 2026-06-07.** Facing-a-bet nodes now solve via WASM by replaying
> the current street's action path into the CFR tree. Implemented exactly as
> `PHASE-B-PLAN.md` specifies, across six files: `postflop-types.ts`
> (`StreetActionStep` + `streetActionPath`), `postflop-provider.ts`
> (`buildStreetActionPath`, passes the path), `solver-worker/src/lib.rs` (DTO fields,
> street-start pot/stack reconstruction, `replay_to_hero` + `nearest_aggressive`,
> dropped the `to_call_chips > 0` Err), `apps/web/lib/solver/index.ts`
> (`wasmSupports` → permissive, try/catch fallback kept), `postflop.test.ts` (path
> assertions), `.gitignore` (`/pkg-node`). **Verified:** `pnpm run check` (275 tests),
> a Rust Node replay harness (`pkg-node/verify-replay.cjs`: OOP-faces-bet,
> IP-faces-bet, bet→raise, first-to-act regression — all pass, Σfreq≈1, finite EVs),
> `apps/web` tsc + `next build`, and headless-Chrome (a facing-a-bet turn spot shows
> "Exact CFR solve (postflop-solver WASM)", first-to-act unregressed, no console errors).
>
> **Watch-items (not blockers):** (1) bet/raise action labels render the chip total
> as "bb" (e.g. "Bet 396bb") — pre-existing, from `action_id_for` emitting
> `raiseTo:<chips>`; affects Phase A too, fix in the UI label layer. (2) Turn solves
> with real ranges ran ~20-50s in the dev browser (HANDOFF claimed ~1s) — likely dev
> mode + concurrent dev servers + the merged preview-bet tree branch; production
> perf + the pre-solve/abort affordance is task 7.

### How Phase A was built (Phase B generalized this — kept for reference)

The real `postflop-solver` is built to WASM and wired in as an **opt-in** engine,
shared by the trainer and the Live Solver. All of this is committed on
`feat/wasm-postflop-solver` (`ab3aa6f`), off `origin/main`:

- **Toolchain is installed** on this machine: rustup at `~/.cargo` (stable 1.96),
  `wasm32-unknown-unknown`, `wasm-pack` 0.13.1. If `cargo` "isn't found", run
  `. "$HOME/.cargo/env"` (it's just off PATH). The old "no Rust toolchain" caveat
  in `BUILD.md` no longer applies here.
- **Build:** `pnpm run build:solver` (root) → `wasm-pack build --target web` in
  `packages/solver-worker`, copies `pkg/` to `apps/web/public/solver/`. Both `pkg/`
  and `public/solver/` are gitignored (AGPL, multi-MB, rebuilt from source). App
  falls back to baseline if the artifact is absent.
- **Cargo pin:** `postflop-solver` rev `9d1509f`, `default-features = false` — drops
  `bincode` (its 2.0-rc trait impls don't compile against bincode 2.0.1) and `rayon`
  (no wasm threads). Single-threaded core is what wasm-postflop ships.
- **`lib.rs`:** every `VERIFY:` marker resolved against the real compiler
  (`Range::from_hands_weights`, `BetSizeOptions`, qualified `postflop_solver::solve`).
  Fixed a real runtime bug (cache normalized weights **per node** before EV reads).
  Per-action EV via `expected_values_detail` (no play/unwind loop). Navigation:
  **OOP reads root, IP advances past villain's check**. Caller-tunable solve budget
  (`max_iterations`, `target_exploitability_fraction`).
- **Web:** `RoutingSolverTransport` (`apps/web/lib/solver/index.ts`) — baseline by
  default; WASM when the **"Exact solver"** setting is on AND `wasmSupports(req)`
  (today `toCallChips <= 0`); any worker error falls back to baseline. Worker rejects
  on solver `error`. `solverEngine` in Settings; toggling repoints the transport and
  clears the solve cache. Per-street budget in the provider (`solveBudgetFor`).
- **Verified:** 273 tests + typecheck + lint + `next build` clean; headless-Chrome
  end-to-end (toggle → WASM turn solve → emerald note, facing-bet → baseline
  fallback, no console errors).

### The Phase B problem (SOLVED — kept for context; see the banner above)

`solve_inner` (`lib.rs`) builds the tree for the current street whose **root is the
OOP player's first action** (check/bet). When the hero **faces a bet**
(`toCallChips > 0`) the real node is one or more actions deep, so today:

```rust
if req.to_call_chips > 0.0 { return Err("wasm solver: facing-a-bet nodes not yet supported"); }
```

…and the router serves the **baseline** for those nodes. Phase B replays the
street's action path in the tree so WASM handles facing-a-bet too — extending real
CFR to the bulk of postflop decisions.

### Approach (two layers)

**A — TS contract + provider.** Thread the current street's action path into the
request so Rust can replay it.
- `packages/strategy/src/postflop-types.ts` — add to `SolveRequest`:
  `streetActionPath?: readonly { actor: 'oop'|'ip'; kind: 'check'|'call'|'bet'|'raise'; toChips?: number }[]`
  (chip amounts are bet-to/raise-to **totals** for the street; baseline ignores it).
- `packages/strategy/src/postflop-provider.ts` (`solveNode`) — build it from
  `node.history` filtered to `node.street`, mapping each `ActionRecord` → actor
  (position vs `heroIsOop`/villain) + kind + `toChips`. `currentStreetSizingContext`
  already iterates that history — reuse the loop. Pass it in `transport.solve({...})`.

**B — Rust replay (`lib.rs`).**
1. Build the tree from the **street-start pot** (see gotchas), add the path field to
   `SolveRequestDto`.
2. After `solve(...)`, `back_to_root()`, then for each path step `game.play(idx)`
   where `idx` matches `game.available_actions()`: `check`→`Action::Check`,
   `call`→`Action::Call`, `bet`/`raise` to `X` → nearest `Bet/Raise/AllIn(amt)`
   (snap), or add the exact size to the tree so a branch matches.
3. Assert `game.current_player() == hero_player` after replay; else `Err(...)` →
   baseline fallback. `read_hero_strategy` is unchanged (reads at the current node).
4. Drop/relax the `to_call_chips > 0.0` early `Err`.

The existing IP-hero nav (play the OOP check) is the **1-step template** — generalize it.

### Gotchas (get these right or EVs are subtly wrong)
- **Street-start pot:** `TreeConfig.starting_pot` = pot at the start of the street's
  betting, NOT `req.pot_chips` (which includes this street's bets). Compute
  `pot_chips - hero_committed - villain_committed` (both already in the request).
  **VERIFY FIRST** whether `GameNodeKey.potChips`/`toCallChips` are inclusive of the
  pending bet — trace `packages/poker-engine` (`decisionPoint`) and `live-node.ts`.
- **Bet→branch:** postflop-solver sizes are pot-fractions at bet time. Add
  `villain_bet / pot_at_bet_time` to the street's bet sizes, or snap to nearest.
- **effective_stack** semantics when `starting_pot` moves earlier; **all-in/low SPR**
  may snap to `Action::AllIn` (tree `add_allin`/`force_allin` thresholds 1.5/0.15).

### Verify in Node (no browser needed for the Rust logic)
```bash
. "$HOME/.cargo/env" && cd packages/solver-worker
wasm-pack build --target nodejs --release --out-dir pkg-node   # gitignored
```
Node ESM script imports `pkg-node/gto_solver_wasm.js`, calls `solve(JSON.stringify(req))`.
Card = `rank*4 + suit`, rank `0=2..12=A`, suit `0=c,1=d,2=h,3=s` (identity to our
engine). Cases: OOP-faces-IP-bet (`heroIsOop:true`, path `[{oop,check},{ip,bet,X}]`),
IP-faces-OOP-bet (`heroIsOop:false`, path `[{oop,bet,X}]`), bet-raise (multi-step).
Assert: available actions include fold/call/raise, Σfreq=1.000/combo, no panic,
finite EVs. Use a 4-card turn board for fast iteration.

### Files to touch
`postflop-types.ts` (add field) · `postflop-provider.ts` (build+pass path) ·
`solver-worker/src/lib.rs` (DTO field, street-start pot, replay+snap, drop the Err) ·
`apps/web/lib/solver/index.ts` (relax `wasmSupports` to allow `toCallChips > 0`,
keep the try/catch fallback). Baseline transport needs no change. Then
`pnpm run build:solver` → `pnpm run check` → browser-verify a facing-a-bet turn spot
shows the emerald "Exact CFR solve (WASM)" note.

### Reference map (crate source)
`~/.cargo/git/checkouts/postflop-solver-*/9d1509f/src/`: `game/interpreter.rs`
(`play`, `available_actions`, `strategy` = `[action*num_hands+hand]`,
`expected_values_detail` same layout, `cache_normalized_weights`, `back_to_root`,
`current_player`); `action_tree.rs` (`Action` enum, `TreeConfig`, `BetSizeOptions`);
`card.rs` (`Card=u8`, `4*rank+suit`); `range.rs` (`from_hands_weights`).

### Perf (already characterized)
Real preflop-derived ranges are hundreds of combos (not the 3-combo harness): river
instant, turn ~1s at the tuned budget, **flop seconds-to-slow** (enumerates every
turn+river runout). Facing-a-bet costs ~the same as first-to-act on the same street.
Flop usability is the separate pre-solve effort (task 7).

### Remaining tasks after Phase B
5. ~~**Solver correctness validation**~~ — ✅ DONE 2026-06-07 (crate-native
   reference; see the task 5 banner above + `BUILD.md` → Validation).
6. **Preflop data/tree depth:** replace hand-authored ranges with solved/licensed
   preflop GTO data; promote multiway (squeeze / cold-call / cold-4bet) from the
   derived fallback to explicit solved charts + a Live Solver line.
7. **Trainer product features:** cumulative per-hand EV, pre-solve-on-flop with
   progress/abort, session persistence, hand histories, drill modes.

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
  solver-worker   Rust→WASM glue around postflop-solver (built separately; see BUILD.md);
                  reference/ = crate-native validation harness; validation/ = its reference fixture
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
- **Live Solver postflop extension — ✅ SHIPPED 2026-06-03 (verified in-browser).**
  The Live Solver now has a **Preflop | Postflop** mode toggle (`components/LiveSolver.tsx`).
  Postflop (`components/LiveSolverPostflop.tsx`) is a **single-node lookup**: pick street,
  both seats, preflop pot type (single-raised / 3-bet) + aggressor, deal a board
  (`components/BoardPicker.tsx`), choose an action-line preset, set pot/bet/raise
  sizes, pick your hand, and slide your own exact-size preview. It reuses the
  trainer's exact solver path: `buildPostflopLineNode` (`strategy/live-node.ts`)
  fabricates the heads-up postflop `GameNodeKey` the `PostflopSolverProvider` already
  serves, including explicit postflop `ActionRecord`s for flop x/x, flop bet/call,
  turn bet/call, bet-vs-raise, donk, delayed c-bet, and probe nodes. The "preview my
  bet" slider maps to a pot fraction (`potFractionForBetTo`) fed to
  `PostflopSolverProvider.getStrategyWithSizes` so the mix carries the exact size with
  its real frequency + EV. Outputs reuse `StrategyMix`/`StrategyGrid`/`StatStrip`/
  `ActionRandomizer` + `equityVsRange`. The old preflop view moved verbatim into
  `components/LiveSolverPreflop.tsx`; shared primitives are in `components/LiveSolverUI.tsx`;
  `CardPicker` was refactored onto a shared `components/CardGrid.tsx` and gained an
  `exclude` prop. New tests in `strategy/live-node.test.ts` cover history shape,
  pot/to-call/stack/min-raise math, provider support, slider fractions, and extra-size
  solves. **Note:** a hand the chart 3-bets/folds preflop (e.g. AQo as a BB flat vs a
  BTN open) isn't in the line's flop range, so the UI shows an explicit "not in range"
  note instead of a misleading pure-fold mix — pick a hand that continues the line or
  switch the pot type.
- **Postflop Live Solver UX polish — ✅ SHIPPED 2026-06-03 (verified in-browser).**
  The postflop exact-size preview now has street-size preset buttons from the same
  postflop size tree the solver evaluates, plus an All-in shortcut. The answer panel
  shows **best action**, **best bet/raise size**, and **preview delta** against the
  best-EV action; the slider readout also shows `Δ vs best`. Pure helpers are in
  `strategy/live-solver-analysis.ts` with tests, and the UI wiring is in
  `components/LiveSolverPostflop.tsx`. Verified desktop + mobile width in headless
  Chrome with no runtime/console issues.
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

- **`apps/web` is not in the root `check` gate.** The root `tsconfig.json` and the
  `check` CI job only cover `packages/*/src`. The new **`wasm` CI job** does run
  `apps/web` tsc + `next build` (after building the WASM artifact), but it only
  fires when the Rust toolchain step succeeds — so still run `cd apps/web && tsc
  --noEmit && next build` locally after touching the web app for a fast signal.
- **Baseline transport EVs are approximate** (one-shot equity + size-based fold
  equity; facing-a-bet models only fold/call). Labeled in the UI. Real EVs need the WASM.
- **`solver-worker/src/lib.rs` is compiled + validated** (Phase A/B + task 5). The
  `VERIFY:` markers are resolved; correctness is pinned by the crate-native
  reference (`BUILD.md` → Validation). Re-check the markers only if the pinned crate
  rev is bumped.
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
