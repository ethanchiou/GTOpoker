# TODO

## Completed

- Randomized trainer sessions so refreshes no longer replay the same card/opponent sequence.
- Hid the full GTO chart until the user reveals it or completes a decision.
- Added hand-specific mixed-strategy frequency display for Fold/Call/Raise/All-in actions.
- Expanded preflop raise sizing beyond a single 2.5bb option, including larger opens, 3-bets, 4-bets, and all-in.
- Added scoring tolerance for raise sizes so nearby valid sizes are accepted while clearly off-target sizes are penalized.
- Added bot 3-bet handling for original-opener decisions with Fold/Call/4-bet/All-in options.
- Added low-confidence placeholder preflop charts for standard single-open response spots and opener-facing-3bet spots.
- Skips no-action BB walk hands so the user is not shown an immediate completed hand before acting.
- Added post-hand review for completed hands, including result, recent action history, and revealed hole cards.
- Preserves GTO feedback after fold-ended hands, including when villains fold to the user's 3-bet.
- Added a product note to progress beyond preflop into flop, turn, and river training with random board runouts.
- Built the postflop solver seam: `SolverTransport`, the preflop→flop range handoff, and a heads-up `PostflopSolverProvider` (multiway spots flagged unsupported).
- Added an equity-based baseline solve transport so postflop EVs flow end-to-end today; the real postflop-solver WASM drops into the same interface (`packages/solver-worker` glue crate + `BUILD.md`).
- Trained flop/turn/river decisions in the play loop with real per-action EV; bots now play postflop hand-aware via the solver; multiway postflop clearly flagged.
- Refined preflop RFI ranges toward standard 6-max norms and migrated the chart set to versioned JSON (`data/preflop-charts/6max_100bb_v1/`) with CI schema-validation.
- Added a step-through hand replayer (reconstructs the hand from its seed + history) with First/Prev/Next/Last + keyboard nav, and a "last move" arrow + action chip marking the most recent actor on the table.
- Bot bet-sizing & timing variance: the baseline transport now enumerates raises/check-raises when facing a bet (bots can raise turn/river, not just fold/call); all-in is gated to low SPR and value-when-called is discounted by a continuing-range equity scale so flops mix real sizings instead of fold-or-jam; postflop sizing is street-aware (denser flop c-bets, polar turn/river incl. overbets); and the web store gives bots seeded human-like think-time (separate `timingRng`, so determinism/replay are unaffected). The graded provider strategy is unchanged by the timing layer.
- Settings menu (hamburger ☰ in the header → `components/SettingsMenu.tsx`, persisted to localStorage): **Bot turn time** (Instant/Fast/Normal/Slow — Instant = 0, no animation; scales the think-time) and **Show full hand** (default off — folding jumps straight to the GTO result with no runout; on plays the hand out and shows the result card). Wired via store `settings`/`setSettings` and a `handDone` flag so a fold-out resolves to results without engine completion.
- **Live Solver in-page tab** (preflop MVP): `Trainer | Live Solver` switcher; pick seat + action line (RFI / facing-raise / facing-3bet) + two hole cards → action mix, GTO sizing, pot odds, win%, full 13×13 grid, and a transparent "Pick for us" Roll dial that samples the GTO frequencies. Trainer markup extracted to `TrainerView`; shared provider in `lib/strategyProvider.ts`. A preflop `GameNodeKey` is fabricated without playing a hand (`buildPreflopLineNode`).
- **Win% / EV / pot-odds stat strip on the trainer decision view** (`DecisionStats` + shared `StatStrip`): pot odds (arithmetic), chances-to-win (hero vs the villain continuing range via Monte-Carlo `equityVsRange` + `villainContinuingRange`), and per-action EV (postflop solver only; preflop "—").
- Documented the baseline→WASM `SolverTransport` swap tradeoffs in `spec.md` §6.5 (benefits, costs incl. AGPL-3.0 + unverified `lib.rs`, why baseline stays default).
- **Live Solver postflop richer action lines:** the fabricated postflop node builder/UI now supports typed action-line presets for flop check-check → turn, flop bet-call → turn, turn bet-call → river, hero bet facing raise, villain donk bets, delayed c-bets, and probe nodes. The builder derives current-street commitments, to-call, min-raise, effective stack, and exact-size preview fractions for the shared postflop solver path.
- **Live Solver postflop browser QA:** verified the full postflop flow in headless Chrome across all action-line presets, board/hole-card collision handling, manual bet controls, hero bet-vs-raise sliders, preflop pot/aggressor changes, seat swaps, and mobile layout. Fixed the board-picker active-slot edge case when expanding flop → turn/river and added the app icon so browser resource loading is clean.
- **Postflop Live Solver UX polish:** added street-size preset buttons beside the exact-size preview slider, an All-in shortcut, best action / best bet-or-raise summaries, and EV delta versus the user's exact preview size. Shared helper logic lives in `packages/strategy/src/live-solver-analysis.ts` with tests; UI wiring lives in `apps/web/components/LiveSolverPostflop.tsx`. Verified with package checks, web typecheck/build, and desktop/mobile headless Chrome smoke checks.

## Next

3. **Shareable Live Solver spots:** persist Live Solver inputs in URL params so spots can be copied, debugged, and regression-tested.
4. **Real WASM solver:** build the postflop-solver WASM artifact (`packages/solver-worker/BUILD.md`), switch the web transport from baseline to WASM, keep baseline fallback, and resolve the known facing-a-bet navigation TODO.
5. **Solver correctness validation:** validate range handoff and postflop outputs against the WASM/Postflop reference solver within tolerances (spec §15 Phase 2).
6. **Preflop data/tree depth:** replace hand-authored ranges with solved/licensed preflop GTO data, then add cold 4-bets, 5-bets, squeezes, and cold-call branches.
7. **Trainer product features:** add cumulative per-hand EV, pre-solve-on-flop with progress/abort, session persistence, hand histories, and drill modes.

## Bot algorithm — remaining / deferred

The bet-sizing & timing-variance work (raises facing a bet, all-in SPR gate + continuing-range
scale, street-aware sizing, seeded bot think-time) is **done** — see Completed. The exact
postflop *frequencies* are still baseline approximations; the real WASM solver (top of "Next")
supersedes the strategy math with true equilibrium EVs, leaving the timing layer in place.

- **(Optional, needs a decision) Recreational/human-like bot profile.** Spec §8.1 has bots play the
  same GTO strategy the human is graded against. If you also want opponents that play *unlike* GTO
  (looser ranges, sizing/timing tells, predictable leaks) as a separate trainer mode, build it as an
  explicit opt-in profile at the bot-action layer (`bot.ts` / a bot-policy wrapper) — never in the
  provider output, so the human's GTO feedback stays exact. Flagged for confirmation before building.
- **Calibrate baseline raise frequencies.** Averaged over a range, the baseline now raises fairly
  often facing a bet (fold-equity-driven). Directionally correct vs the old fold/call-only behavior,
  but tune the fold-equity cap / continue-range scale if it over-raises before the WASM solver lands.

## Validation Commands

- `pnpm run build`
- `pnpm run test`
- `pnpm run lint`
