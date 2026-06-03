# Building the postflop-solver WASM artifact

This crate compiles [`postflop-solver`](https://github.com/b-inary/postflop-solver)
(AGPL-3.0) to WebAssembly and exposes a single `solve(request_json) -> result_json`
function consumed by the browser `WasmSolverTransport` (`apps/web/lib/solver/`).

It is **not** built by `pnpm` or in CI — the default dev/CI environment has no
Rust toolchain. Build it explicitly when you want real equilibrium EVs instead of
the in-process baseline transport.

## Prerequisites

```bash
# Rust toolchain + wasm target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# wasm-pack
cargo install wasm-pack            # or: brew install wasm-pack
```

## Build

```bash
cd packages/solver-worker
wasm-pack build --target web --release --out-dir pkg
```

This produces `packages/solver-worker/pkg/` containing `gto_solver_wasm.js`,
`gto_solver_wasm_bg.wasm`, and `.d.ts` types. `pkg/` is gitignored — the artifact
is multi-MB and AGPL; rebuild it from source rather than committing it.

## Wire it into the web app

`apps/web/lib/solver/wasm-transport.ts` lazy-imports the artifact. Point it at the
built `pkg/` (e.g. copy/symlink `pkg/` to `apps/web/public/solver/` for the static
export, or import directly through the bundler) and flip the app's transport
selection from the baseline to the WASM transport. Until then the app falls back
to `BaselineSolverTransport` automatically.

## Verification checklist (the `VERIFY:` markers in `src/lib.rs`)

`src/lib.rs` is written against the documented API but was authored without a
compiler. On first build, confirm against your pinned `postflop-solver` version:

1. **Card encoding** — `to_solver_card` assumes `rank*4 + suit` with suit order
   `c,d,h,s`. Confirm the crate's encoding; adjust the remap if it differs.
2. **`Range` construction** — `Range::from_raw_data(&[f32; 1326])` and the
   `card_pair_to_index` combo index.
3. **`BetSizeCandidates::try_from((bet, raise))`** signature + percent syntax.
4. **`TreeConfig` fields** — names/types (rake, thresholds, donk sizes).
5. **Reading results** — `private_cards`, `available_actions`, `strategy()`
   layout (column-major `action*num_hands + hand`), `expected_values(player)`,
   `play`/`back_to_root`.
6. **`Action` enum variants** — `Bet`/`Raise`/`AllIn` payloads in `action_id_for`.

## Known scaffold gaps (tracked TODOs)

- **Facing a bet**: `solve_inner` currently reads the *root* node. When
  `toCallChips > 0`, navigate to the real node first (thread the postflop action
  path through the request and `game.play(...)` to it).
- **Performance**: iteration count / target exploitability and the bet-size tree
  are the levers from the deferred Phase-0 perf spike — measure on a real device
  and set the play-mode budget (pre-solve-on-flop, abort) around the result.
