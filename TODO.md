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
- **Shareable Live Solver spots:** every Live Solver input now persists in the URL query string (`?m=preflop|postflop&…`) so a spot can be copied, reopened, and used as a regression fixture. The codec is pure and CI-tested (`packages/strategy/src/live-spot.ts` + `live-spot.test.ts`; `encode/decodeLiveSolverSpot`, lenient validation that degrades to defaults on a malformed URL). The web glue (`apps/web/lib/liveSolverUrl.ts`) seeds state on mount and `history.replaceState`s on every change; `app/page.tsx` deep-links a shared link straight to the Live Solver tab. **Full fidelity** — seats, street, board, hole cards, action-line preset, bet sliders, the adjustable pot, *and* the preview-bet are all restored; the pot/preview-bet reset effects in `LiveSolverPostflop` are guarded with a strict-mode-safe ref pattern so a URL-seeded value survives mount instead of snapping back to the computed default. A **Copy link** button sits beside the Preflop/Postflop switcher (`LiveSolver.tsx`). Verified end-to-end in headless Chrome: preflop + postflop deep-links restore exactly (incl. pot=12bb / preview bet=9bb), URLs round-trip, no console or hydration errors.
- **Full preflop 3-bet/4-bet/5-bet tree + multiway fallback + the AQo fix.** Audited all hand-authored
  spots and patched the one genuine silent-fold hole (BB folded AQo to a CO open — it was absent from
  every action range, so `compileSpot`'s implicit-fold-on-remainder pure-folded it); added
  `charts.sanity.test.ts` as a CI guard so a premium can never silently 100%-fold again. Extended
  `classifyPreflop` to walk the whole raise sequence (open→3bet→4bet→5bet) and route cold-caller lines
  aside; grew the chart set from 25→65 spots (completed `vs3bet` to all 15, added `vs4bet`×15 and
  `vs5bet`×15), closing the tree at 100bb. Multiway spots (squeeze / cold-call / cold-4bet) are served
  by a derived **low-confidence** fallback (`multiway-fallback.ts` + `MultiwayFallbackProvider`, wired
  into the composite) that transforms the nearest heads-up chart, so bots never silently fold them and
  the human gets directional feedback flagged `confidence: 'low'`. The Live Solver gained a "facing a
  4-bet" line (node builder + URL codec + UI picker), verified in headless Chrome.
- **Shareable trainer hands:** the same copy/paste, adapted to the trainer's seeded engine. A hand is fully reproducible from its seed (which seeds the deck → hole cards *and* board), the button seat, and the action sequence, so the codec encodes just those (`packages/poker-engine/src/hand-link.ts` + `hand-link.test.ts`; `encode/decodeHandLink` + `reconstructHandFromLink`, CI-tested incl. a "reconstruct === live hand" round-trip). A **Copy link** button (`TrainerView.tsx`) builds a one-off shareable URL (`?hand=<seed>&btn=<n>&a=<actions>`) and copies it; opening such a URL deep-links into that exact hand. The store gained `loadHandFromLink` (`lib/store.ts`): a pending hero decision restores as a fresh spot (chart hidden), and a finished/folded hand restores with the last decision's GTO feedback **re-derived** — without touching session stats (it's someone else's hand). Unlike the Live Solver the address bar is **not** continuously synced (clipboard-only via `lib/trainerUrl.ts`), so a normal refresh still deals a fresh random hand; **New hand** clears any stale param. Corrupt/illegal links fall back to a fresh hand. Verified in headless Chrome: decision spots and folded hands restore exactly, feedback re-derives, stats stay clean, refresh still randomizes, no console errors.

- **Real WASM postflop solver (task 4 — Phase A + Phase B).** Built `postflop-solver`
  to WASM (`pnpm run build:solver`) and wired it as an opt-in **"Exact solver"** engine
  behind `RoutingSolverTransport`; baseline stays the default with transparent fallback.
  Phase A served first-to-act nodes; **Phase B** added facing-a-bet nodes by threading
  the current street's action path (`streetActionPath`) into the request and replaying
  it into the CFR tree in Rust (`replay_to_hero` snaps each villain bet/raise to the
  nearest tree size; street-start pot/effective-stack reconstructed from the per-street
  commitments). The WASM engine now serves the full set of heads-up postflop nodes.
  Verified: `pnpm run check` (275 tests), a Rust Node replay harness
  (`pkg-node/verify-replay.cjs`), `apps/web` tsc + `next build`, and headless-Chrome
  (facing-a-bet turn → "Exact CFR solve (WASM)"; first-to-act unregressed; no console
  errors). Watch-items (not blockers): bet/raise labels show chip totals as "bb"
  (UI label layer; pre-existing); turn solves ran slow in the dev browser (production
  perf + pre-solve/abort is Next #7).

- **Solver correctness validation (task 5, spec §15 Phase 2).** Validated against a
  **crate-native reference** — a separate binary crate (`packages/solver-worker/reference/`)
  that links `postflop-solver` directly and solves each spot from its true street-start
  values, so the comparison is a differential test of *our glue* (range encoding, the
  street-start pot/effective-stack reconstruction, the Phase B replay/snap, the EV read).
  Four parts: (A) our WASM vs the reference within tolerance per combo/action; (B) range
  handoff — exact combo enumeration, multi-action weight products, raise-size snapping,
  `villainContinuingRange`; (C) a baseline-vs-exact drift monitor (logged; baseline tracks
  well first-to-act/river, drifts ~0.45 mean on turn facing-bet); (D) solve-cache identity +
  determinism; (E) graceful degradation (over-budget/too-large trees decline to baseline).
  Pure-TS parts run in `pnpm run check` (`solver-validation.test.ts`); WASM parts run in a
  new **`wasm` CI job** that also closes the `apps/web` build gate (`solver-wasm.test.ts`,
  `skipIf` pkg-node absent). New scripts: `build:solver:node`, `validate:solver:reference`.
  Robustness fix found in QA: a wide flop / over-large tree made the WASM `solve` panic via
  `.unwrap()` (`with_config` → "Too many nodes"; `allocate_memory` → isize cap), trapping the
  worker. Now `lib.rs` returns typed errors (`map_err` on the builds + a `memory_usage()`
  pre-check vs `MAX_SOLVE_BYTES` ~1.86 GiB, tunable via `maxSolveBytes`) → baseline fallback,
  no trap. See `packages/solver-worker/BUILD.md` → Validation. Verified: `pnpm run check`
  (305 tests) + the WASM suite + `apps/web` tsc/`next build` + a headless-Chrome QA pass,
  all green.

## Next

6. **Preflop data/tree depth:** the linear tree (RFI → vs-RFI → vs-3bet → vs-4bet → vs-5bet) and a
   derived multiway fallback now ship hand-authored (see Completed). Remaining: replace the
   hand-authored ranges with solved/licensed GTO data (bump `confidence`), and promote the multiway
   spots (squeeze / cold-call / cold-4bet) from the derived approximation to explicit solved charts —
   plus a Live Solver line for them.
7. **Trainer product features:** add cumulative per-hand EV, pre-solve-on-flop with progress/abort, session persistence, hand histories, and drill modes. Note: over-budget/too-large WASM solves now *decline to baseline gracefully* (no trap — task 5 robustness fix), so this item is about making flop solves actually compute (perf + pre-solve/abort), not crash-handling.

## Pre-deploy / deployment readiness

Gates an actual launch; orthogonal to the feature work in "Next". None of this is wired or
configured yet (surfaced in the pre-deploy scope review). The headline blocker — the web app not
compiling — is already resolved (shareable trainer hands landed; `next build` is green).

- **Add `apps/web` to CI.** ✅ Largely done (task 5): the new `wasm` CI job runs web `tsc --noEmit`
  + `next build` after building the WASM artifact. Caveat: it only fires if the Rust toolchain step
  succeeds, so a Rust/wasm-pack outage would skip the web gate too. Consider also adding a
  toolchain-free `next build` step to the `check` job if you want the web build gated independently
  of the solver build.
- **Configure a static-export deploy target.** `output: 'export'` is set but no host is wired
  (Vercel / Netlify / GitHub Pages / S3). Pick one and verify the `apps/web/out/` artifact deploys
  and loads clean.
- **Add an E2E smoke test.** Spec §15 calls for Playwright (fixed-seed: play hand → feedback →
  complete → stats update); none exist today. At least one smoke path before launch.
- **AGPL-3.0 deploy decision (gate before shipping WASM).** The baseline transport carries no
  copyleft and ships clean. Building/hosting the `postflop-solver` WASM triggers AGPL-3.0's
  source-availability obligation (met by this repo being public, but a conscious call). Decide before
  flipping a public deploy to the WASM transport. Note: the `wasm` CI job now *builds* the artifact
  for validation — that's not distribution to end users, so it doesn't itself trigger the obligation;
  the gate is still the public *deploy* serving the WASM transport.
- **Session-stats persistence decision.** Today only *settings* persist (localStorage); session stats
  live in memory and are lost on refresh (no `SessionStore` / IndexedDB yet — part of Next #7). Decide
  whether ephemeral stats are acceptable for the first launch or persistence is pulled forward.

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
