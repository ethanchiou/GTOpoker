# Phase B plan — facing-a-bet WASM navigation

> Implementation plan for task 4 Phase B (HANDOFF.md §2.1). Replays the current
> street's action path into the postflop-solver tree so the real CFR engine
> serves facing-a-bet nodes (`toCallChips > 0`), not just first-to-act.
> **Status: IMPLEMENTED + verified (2026-06-07).** All six files below landed as
> specified. Verified via the TS gate (`pnpm run check`, 275 tests), a Rust Node
> replay harness (`pkg-node/verify-replay.cjs` — OOP-faces-bet, IP-faces-bet,
> bet→raise multi-step, and a first-to-act regression all pass), `apps/web` tsc +
> `next build`, and headless-Chrome: a facing-a-bet turn spot now renders the
> "Exact CFR solve (postflop-solver WASM)" note (was baseline), first-to-act is
> unregressed, no console errors.

## Goal / success criteria

- A facing-a-bet flop/turn/river node, with the **"Exact solver"** setting on,
  is solved by the WASM CFR engine and shows the emerald "Exact CFR solve (WASM)"
  note (today it falls back to the baseline).
- Per-combo strategy at the hero's *real* node: Σfreq = 1.000/combo, finite EVs,
  no panic. Phase A (first-to-act, IP-after-check) is unchanged.
- Any malformed/unreachable path → `Err` → transparent baseline fallback (never
  a wrong node).

## Design decisions (with rationale)

1. **Snap to nearest tree action, do not inject exact sizes.** Both the trainer
   bot and the Live Solver draw villain bet sizes from the *same*
   `postflopBetFractionsByStreet` the solver tree is built from, so snapping is
   *exact* at every real call site and adds **zero** tree cost. Injecting exact
   `"<n>c"` additive sizes would enlarge the already-slow flop tree for no
   practical gain. (Documented as the chosen tradeoff; revisit only if an
   arbitrary off-tree villain size ever needs exact fidelity.)

2. **Reconstruct street-start pot + effective stack in Rust** from fields already
   in the request:
   - `starting_pot = potChips − heroCommitted − villainCommitted`
     (`potChips` = `totalPot()` is inclusive of this street's bets — verified in
     `poker-engine/showdown.ts` + `hand.ts::nodeKey`).
   - `effective_stack = effectiveStackChips + heroCommitted`. The engine's
     `effectiveStackChips` is the hero's *current remaining* stack; HU postflop
     stacks are **equal at street start** (the caller matches to reach each
     street), so adding the hero's this-street commitment recovers the
     street-start effective stack. No-op for Phase A (heroCommitted = 0) → no
     regression.

3. **General path replay replaces the hand-rolled IP-check nav.** The Phase-A
   "play the OOP check" special case becomes one instance of replaying
   `streetActionPath`. Consequence: **the TS provider must always send the path**
   (incl. `[{oop,check}]` for IP-after-check) — this is required, not optional.

4. **Per-step actor guard + final hero-to-act assert.** Before each `play`, check
   the step's `actor` maps to `current_player()`; after replay, assert the hero is
   to act and the node is a real decision (not terminal/chance). Any mismatch →
   `Err` → baseline.

5. **`wasmSupports` relaxed to allow `toCallChips > 0`.** Multiway is already
   filtered upstream by `PostflopSolverProvider.supports`; the try/catch baseline
   fallback stays.

---

## File 1 — `packages/strategy/src/postflop-types.ts` (add the contract)

```ts
/** One already-taken action on the current street, for the WASM solver to replay
 *  into the tree to reach a facing-a-bet hero node. Baseline transport ignores it. */
export interface StreetActionStep {
  actor: 'oop' | 'ip'
  kind: 'check' | 'call' | 'bet' | 'raise'
  /** Bet/raise: total chips committed this street after the action (the "to" amount). */
  toChips?: number
}
```

Add to `SolveRequest` (after `villainCommittedThisStreetChips`):

```ts
  /**
   * The current street's action path before the hero's decision, in order, for
   * the WASM solver to replay into its tree (so it can serve facing-a-bet nodes,
   * not just first-to-act). Empty/absent = hero is first to act. The baseline
   * transport ignores this.
   */
  streetActionPath?: readonly StreetActionStep[]
```

No change to `SolveResult` / `SolverTransport`.

## File 2 — `packages/strategy/src/postflop-provider.ts` (build + pass the path)

In `solveNode`, after `const sizingContext = currentStreetSizingContext(...)`:

```ts
    const oopPos = isOutOfPosition(heroPos, villainPos) ? heroPos : villainPos
    const streetActionPath = buildStreetActionPath(node, oopPos)
```

Pass it in the `transport.solve({ ... })` object (alongside the committed fields):

```ts
      streetActionPath,
```

New module-private helper (near `currentStreetSizingContext`):

```ts
/** The current street's action records, mapped to the solver's replay path. */
function buildStreetActionPath(node: GameNodeKey, oopPos: Position): StreetActionStep[] {
  const steps: StreetActionStep[] = []
  for (const rec of node.history) {
    if (rec.street !== node.street) continue
    const t = rec.action.type
    if (t === 'fold') continue // a fold ends the hand; never precedes a hero decision
    steps.push({
      actor: rec.position === oopPos ? 'oop' : 'ip',
      kind: t, // 'check' | 'call' | 'bet' | 'raise'
      toChips: rec.action.amount,
    })
  }
  return steps
}
```

(Adds `StreetActionStep` to the `postflop-types` import.)

## File 3 — `packages/solver-worker/src/lib.rs` (DTO + street-start + replay)

**a. DTO additions** (`SolveRequestDto`, all `#[serde(default)]`):

```rust
    #[serde(default)]
    hero_committed_this_street_chips: f64,
    #[serde(default)]
    villain_committed_this_street_chips: f64,
    #[serde(default)]
    street_action_path: Vec<StreetStepDto>,
```

New DTO:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreetStepDto {
    actor: String,        // "oop" | "ip"
    kind: String,         // "check" | "call" | "bet" | "raise"
    #[serde(default)]
    to_chips: Option<f64>,
}
```

**b. Street-start pot + effective stack** in `solve_inner`, replacing the two
`TreeConfig` fields:

```rust
    let hero_committed = req.hero_committed_this_street_chips;
    let villain_committed = req.villain_committed_this_street_chips;
    // starting_pot/effective_stack are measured at the START of this street's
    // betting (postflop-solver builds the tree from there). potChips is inclusive
    // of this street's bets; HU postflop stacks are equal at street start, so the
    // hero's this-street commitment recovers the street-start effective stack.
    let starting_pot = (req.pot_chips - hero_committed - villain_committed).round().max(1.0) as i32;
    let effective_stack = (req.effective_stack_chips + hero_committed).round().max(1.0) as i32;
```

…and use `starting_pot` / `effective_stack` in `TreeConfig`.

**c. Replace navigation** (drop the `to_call_chips > 0` Err and the IP-check
special case):

```rust
    let hero_player = if req.hero_is_oop { 0 } else { 1 };
    replay_to_hero(&mut game, &req.street_action_path, hero_player)?;
    let hero_strategy = read_hero_strategy(&mut game, hero_player, to_bb);
```

**d. New replay helpers:**

```rust
/// Replay this street's action path into the tree so the current node is the
/// hero's decision. Snaps each bet/raise to the nearest tree size (villain sizes
/// are drawn from the same fraction tree, so this is exact in practice). Returns
/// Err on any mismatch so the caller falls back to the baseline.
fn replay_to_hero(
    game: &mut PostFlopGame,
    path: &[StreetStepDto],
    hero_player: usize,
) -> Result<(), String> {
    game.back_to_root();
    for step in path {
        if game.is_terminal_node() || game.is_chance_node() {
            return Err("wasm solver: replay reached a terminal/chance node".to_string());
        }
        let expected = match step.actor.as_str() {
            "oop" => 0usize,
            "ip" => 1usize,
            other => return Err(format!("wasm solver: bad actor '{other}'")),
        };
        if game.current_player() != expected {
            return Err("wasm solver: replay actor/current-player mismatch".to_string());
        }
        let actions = game.available_actions();
        let idx = match step.kind.as_str() {
            "check" => actions.iter().position(|a| matches!(a, Action::Check)),
            "call" => actions.iter().position(|a| matches!(a, Action::Call)),
            "bet" | "raise" => nearest_aggressive(&actions, step.to_chips.unwrap_or(0.0).round() as i32),
            other => return Err(format!("wasm solver: unsupported step kind '{other}'")),
        }
        .ok_or_else(|| format!("wasm solver: no matching action for '{}'", step.kind))?;
        game.play(idx);
    }
    if game.is_terminal_node() || game.is_chance_node() {
        return Err("wasm solver: replay did not end at a player decision".to_string());
    }
    if game.current_player() != hero_player {
        return Err("wasm solver: replay did not reach the hero's node".to_string());
    }
    Ok(())
}

/// Index of the Bet/Raise/AllIn action whose total amount is nearest `target`.
fn nearest_aggressive(actions: &[Action], target: i32) -> Option<usize> {
    let mut best: Option<(usize, i32)> = None;
    for (i, a) in actions.iter().enumerate() {
        let amt = match a {
            Action::Bet(x) | Action::Raise(x) | Action::AllIn(x) => *x,
            _ => continue,
        };
        let d = (amt - target).abs();
        if best.map_or(true, |(_, bd)| d < bd) {
            best = Some((i, d));
        }
    }
    best.map(|(i, _)| i)
}
```

## File 4 — `apps/web/lib/solver/index.ts` (relax routing)

```ts
/**
 * Heads-up postflop nodes the WASM solver can compute. Multiway is already
 * filtered upstream (PostflopSolverProvider.supports); facing-a-bet nodes are
 * handled by replaying the street's action path (Phase B). Any worker error
 * still falls back to the baseline via the try/catch.
 */
function wasmSupports(_req: SolveRequest): boolean {
  return true
}
```

(Leaves the `RoutingSolverTransport.solve` try/catch fallback as-is.)

---

## Tests

1. **`packages/strategy/src/postflop.test.ts`** — extend the existing
   `CaptureTransport` turn facing-bet case to assert the built path:
   ```ts
   expect(transport.requests[0]!.streetActionPath).toEqual([
     { actor: 'oop', kind: 'check', toChips: undefined },
     { actor: 'ip', kind: 'bet', toChips: 500 },
   ])
   ```
   (BB is OOP vs BTN; the turn history is BB check → BTN bet 500.) Add a
   first-to-act case asserting an **empty** path, and an IP-after-check case
   asserting `[{oop,check}]`.

2. **Rust replay (Node target, no browser):**
   ```bash
   . "$HOME/.cargo/env" && cd packages/solver-worker
   wasm-pack build --target nodejs --release --out-dir pkg-node   # gitignored
   ```
   Node ESM harness `solve(JSON.stringify(req))` on a 4-card turn board (fast),
   real-ish small ranges, for three cases:
   - **OOP faces IP bet** — `heroIsOop:true`, path `[{oop,check},{ip,bet,X}]`.
   - **IP faces OOP bet** — `heroIsOop:false`, path `[{oop,bet,X}]`.
   - **Bet→raise (multi-step)** — `heroIsOop:true`, path `[{oop,bet,X},{ip,raise,Y}]`.
   Assert: actions include fold/call/raise, Σfreq≈1.000/combo, finite EVs, no panic.

   (Add `pkg-node/` to `packages/solver-worker/.gitignore`.)

## Verification gate (this is "also browser-verify")

```bash
pnpm run build:solver
pnpm run check                                   # tsc + depcruise + vitest
cd apps/web && npx tsc --noEmit && npx next build # not in CI — run manually
cd apps/web && npx next dev                      # → localhost:3000
```

Browser: toggle **Exact solver** on, drive/seed a **facing-a-bet turn** spot
(turn cheaper than flop), confirm the emerald "Exact CFR solve (WASM)" note and
no console errors; confirm a first-to-act spot still solves (no Phase A
regression); confirm a multiway node still flags unsupported.

## Files touched
- `packages/strategy/src/postflop-types.ts` — `StreetActionStep` + `streetActionPath`.
- `packages/strategy/src/postflop-provider.ts` — `buildStreetActionPath`, pass it.
- `packages/solver-worker/src/lib.rs` — DTO fields, street-start pot/stack, replay+snap, drop Err.
- `apps/web/lib/solver/index.ts` — `wasmSupports` → permissive.
- `packages/strategy/src/postflop.test.ts` — path assertions.
- `packages/solver-worker/.gitignore` — `/pkg-node`.

## Risks / watch-items
- **Equal-stack invariant** underpins the eff-stack reconstruction — holds for HU
  SRP/3-bet-to-flop lines (caller matches). Commented in `lib.rs`.
- **Low-SPR / all-in snapping:** `add_allin_threshold 1.5` / `force_allin_threshold
  0.15` may replace a bet with `AllIn`; `nearest_aggressive` treats `AllIn` as a
  candidate, so it still resolves. If a node is truly terminal mid-replay → `Err` →
  baseline (acceptable for all-in edges).
- **Flop facing-bet cost** is the slow path (enumerates turn+river) — governed by
  the existing per-street `solveBudgetFor`; no change. Browser-verify on the turn.
```
