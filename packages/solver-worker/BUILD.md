# Building the postflop-solver WASM artifact

This crate compiles [`postflop-solver`](https://github.com/b-inary/postflop-solver)
(AGPL-3.0) to WebAssembly and exposes a single `solve(request_json) -> result_json`
function consumed by the browser `WasmSolverTransport` (`apps/web/lib/solver/`).

It is not built by the default `pnpm run check` (no Rust toolchain there), so the
in-process baseline transport stays the dev default. A dedicated **`wasm` CI job**
(`.github/workflows/ci.yml`) does build it and run the solver-correctness
validation (see [Validation](#validation-task-5)). Build it locally when you want
real equilibrium EVs.

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

## Validation (task 5)

Solver correctness is validated against a **crate-native reference** — a separate
binary crate (`reference/`) that links `postflop-solver` directly (independent of
this glue) and solves each spot from its true street-start values. Because both run
the same engine, this is a differential test of *our glue*: range encoding, the
street-start pot/effective-stack reconstruction (`lib.rs` derives them from the
request; the reference uses the true values directly), the Phase B replay/snap, and
the per-action EV read.

```bash
# 1. Build the nodejs-target WASM the TS harness loads (gitignored, like pkg/).
pnpm run build:solver:node          # → packages/solver-worker/pkg-node/

# 2. Regenerate the reference fixture (committed for local runs; CI regenerates it
#    on its own runner so the comparison is wasm32-vs-that-host).
pnpm run validate:solver:reference  # → packages/solver-worker/validation/reference-spots.json

# 3. Run the validation tests.
pnpm exec vitest run packages/strategy/src/solver-wasm.test.ts
```

`solver-wasm.test.ts` covers: **A** our glue vs the reference within tolerance (per
combo, per action — subsumes the per-node weight-normalization read), **C** a
baseline-vs-exact drift monitor (logged; baseline is a known approximation), and
**D** determinism. It `skipIf`s when `pkg-node/` is absent, so `pnpm run check`
stays green without the toolchain. The pure-TS half (range handoff + solve cache,
`solver-validation.test.ts`) runs in the normal gate.

## Verification checklist (the `VERIFY:` markers in `src/lib.rs`)

> Resolved as of Phase A/B (the crate compiles and the validation above passes).
> Kept as a re-check list if the pinned crate version is ever bumped.

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

- **Facing a bet**: ✅ resolved (Phase B) and validated (task 5). `solve_inner`
  replays the request's `streetActionPath` into the tree to reach the hero's
  facing-a-bet node; `replay_to_hero`/`nearest_aggressive` snap each villain
  bet/raise to the nearest tree size.
- **Performance**: iteration count / target exploitability and the bet-size tree
  are the levers from the deferred Phase-0 perf spike — measure on a real device
  and set the play-mode budget (pre-solve-on-flop, abort) around the result.
