# GTO Poker Trainer — Technical & Product Specification

> **Version:** 0.1 (draft) · **Status:** approved scope, pre-implementation
> **Game:** 6-max No-Limit Hold'em, cash, 100bb · **Platform:** Web (Next.js) first, mobile later
> **Engine:** embeds open-source solvers (does not build CFR from scratch)

---

## 1. Overview & Goals

### 1.1 What this is

A **GTO (Game-Theory-Optimal) poker trainer** for 6-max No-Limit Hold'em cash games. The user plays
practice hands against bots. Everyone sees only their own hole cards. After each decision — and in a
post-hand review — the user gets feedback on whether their **fold / check / call / bet / raise and
their bet sizing** matched the GTO strategy, expressed as:

- **EV loss in big blinds (bb)** vs the optimal play, and
- the correct **mixed-strategy frequencies** for that exact spot (e.g. *"GTO 3-bets AKs here 72%,
  calls 28% — you called, which is correct but the less-frequent line"*).

### 1.2 Why "GTO" is a real, specific claim

GTO means the **Nash-equilibrium** strategy: a strategy that cannot be exploited by any opponent,
even one who knows it. Real solvers compute it with **Counterfactual Regret Minimization (CFR)** and
its variants (CFR+, Discounted CFR, MCCFR). We do **not** implement CFR ourselves — we embed proven
open-source solvers and seed published equilibrium ranges. The product's value is the **practice
loop and the feedback**, built on top of real equilibrium data.

### 1.3 The single hard truth that shapes the architecture

**True real-time GTO solving is only tractable heads-up (2 players).** A full 6-max *multiway*
postflop solve is computationally infeasible to run live. The industry's answer — and ours — relies
on the fact that **~90% of 6-max cash pots are heads-up by the flop** (because of preflop 3-betting
and folding). So:

- **Preflop** is served from **precomputed range charts** (the equilibrium for the full table).
- **Postflop** is served from a **heads-up solver** for the dominant HU-by-the-flop spots.
- Rare multiway postflop pots are approximated and clearly flagged as such.

### 1.4 Goals

| # | Goal | Measured by |
|---|------|-------------|
| G1 | Deal real 6-max hands; each seat sees only its own cards | Structural enforcement (§8.2) + E2E test |
| G2 | Grade every user decision (action + sizing) against GTO | Scoring engine (§7) |
| G3 | Express feedback as EV loss (bb) + GTO frequencies + classification | Feedback panel (§9.3) |
| G4 | Track performance over time (leaks, accuracy, mbb/g) | Analytics (§7.4, §9.5) |
| G5 | Be reproducible for study (seedable decks) | RNG (§5.2, §10) |
| G6 | Architecture that a future mobile client can reuse | Platform-agnostic core (§4.4) |

### 1.5 Target user

A serious-but-improving 6-max cash player who wants deliberate practice with objective feedback —
not a casual play-money game. Reference products: GTO Wizard, PioSOLVER trainer, Simple GTO Trainer,
DTO.

---

## 2. Scope & Non-Goals

### 2.1 In scope (overall product)

6-max NLHE cash, 100bb default. Preflop + heads-up postflop training. Per-decision feedback. Session
& lifetime analytics. Hand history + replayer. Drill modes. GTO bots (plus exploitable archetypes
later). Client-only web app.

### 2.2 v1 (MVP) scope — **preflop-first**

A **complete, polished preflop trainer**:

- Full table & hand state machine (all streets *exist* so hands complete, but **only preflop is
  trained/graded** in v1; postflop runs to showdown via bots).
- Preflop GTO from seeded published charts.
- Scoring of preflop action + sizing.
- GTO bots.
- Web UI: table, action controls, per-decision feedback panel, 13×13 strategy heatmap, session stats.
- Seedable, reproducible decks.

### 2.3 Non-goals (explicit)

- ❌ Real-money play of any kind.
- ❌ Online multiplayer / playing against other humans (bots only).
- ❌ Tournaments / MTT / ICM (cash only — ICM is irrelevant to cash).
- ❌ Table sizes other than 6-max in v1 (heads-up & full-ring not in initial scope).
- ❌ A backend / server in v1 (everything client-side).
- ❌ Building a CFR solver from scratch.
- ⏸️ Node-locking (opponent-strategy-constrained re-solving) — analysis-only, optional in a later phase.
- ⏸️ Mobile app — deliberately deferred; the architecture *enables* it but v1 does not build it.

---

## 3. Locked Product Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Game variant | 6-max NLHE cash, 100bb | What most players grind; cash avoids ICM complexity |
| Engine strategy | **Embed** solvers, don't build CFR | CFR-from-scratch is months of work for worse accuracy |
| Postflop solver | **postflop-solver** (Rust, AGPL-3.0) → WASM | WASM-ready, HU + bunching, proven via WASM Postflop |
| Preflop data (MVP) | **Free published charts**, baked-in JSON, swappable | No open GTO preflop dataset exists; fastest to value |
| Hand evaluation | **PokerHandEvaluator-WASM** (Apache-2.0) or `poker-evaluator` (ISC) | Fast, permissive, WASM/JS |
| Platform | **Web first** (Next.js + Rust/WASM), then mobile | Most shareable; solver compiles to WASM |
| Licensing posture | Personal / open-source → **AGPL acceptable** | Lets us use postflop-solver directly |
| v1 scope | **Preflop-first MVP** | Achievable, immediately useful, de-risks the loop |

---

## 4. System Architecture

### 4.1 Guiding principle

The **core is framework-free TypeScript**; the React UI is a thin layer on top. Future mobile reuse
is achieved by **discipline at the package boundary** + **dependency injection**, *not* a
cross-platform UI framework. Everything runs **client-side**.

### 4.2 Why client-only (no backend in v1)

- The solver is WASM-in-a-Web-Worker; preflop charts are static JSON in the bundle; sessions/stats
  live in **IndexedDB**.
- Zero backend ops, trivially deployable as static assets (Vercel / GitHub Pages / Netlify / S3),
  matches the proven WASM Postflop model, and fits an AGPL open-source project.
- **Trade-off:** no cloud sync, and heavy compute runs on the user's device. Accepted for v1;
  revisit only if the future mobile solver-transport forces a remote solve service (§16, Future).

### 4.3 Monorepo layout (pnpm workspaces + Turborepo + TS project references)

```
gto-trainer/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── packages/
│   ├── poker-engine/    # PURE TS. No DOM/React/fetch.
│   │                    #   cards · seedable Deck/RNG · hand state machine (reducer) ·
│   │                    #   pot/side-pots · action & bet-size legality · DecisionPoint
│   ├── hand-eval/       # PURE TS wrapper over a permissive eval lib.
│   │                    #   7-card rank · best-5 · equity (Monte Carlo + exhaustive)
│   ├── strategy/        # PURE TS. THE SPINE.
│   │                    #   StrategyProvider interface · GameNodeKey ·
│   │                    #   PreflopChartProvider · range/combo/grid math ·
│   │                    #   (P2) PostflopSolverProvider · CompositeStrategyProvider
│   ├── scoring/         # PURE TS.
│   │                    #   EV-loss · classification · mixed-strategy credit ·
│   │                    #   bet-size grading · session aggregation
│   ├── hand-history/    # PURE TS.
│   │                    #   internal HandHistory record · PokerStars import/export ·
│   │                    #   replay reconstruction
│   ├── domain-config/   # constants + JSON: positions · bet-size trees · rake profiles ·
│   │                    #   scoring thresholds · chart manifest
│   └── solver-worker/   # (Phase 2) browser-only WASM glue for postflop-solver
├── data/
│   └── preflop-charts/  # the seeded ~42-tree chart JSON (versioned, rake-tagged)
└── apps/
    └── web/             # Next.js (App Router, static export). The ONLY package touching React/DOM.
                         #   Zustand stores · IndexedDB adapter · worker instantiation ·
                         #   table renderer · 13×13 heatmap · feedback panel · replayer
                         #   routes: /play /study /analyze /drills /history
```

### 4.4 The platform-agnostic-core contract (what makes mobile reuse possible)

Core packages **must not** import `react`, `next`, `apps/*`, or reference `window` / `document` /
`fetch` / `localStorage`. All platform capabilities enter the core through **injected interfaces**:

| Interface | Web implementation | Future RN implementation |
|---|---|---|
| `SeedSource` (entropy/seed) | `crypto.getRandomValues` | RN crypto / native |
| `ChartLoader` (load chart JSON) | bundled import / fetch static asset | bundled asset |
| `SolverTransport` (postflop solve) | Web Worker + WASM | native module **or** remote solve service |
| `SessionStore` (persistence) | IndexedDB (`idb`) | SQLite / AsyncStorage |

Dependency direction is strictly one-way and CI-enforced (§4.6):

```
web  →  strategy / scoring / hand-history  →  poker-engine  →  hand-eval
                                  ↘  domain-config  ↙
```

### 4.5 Web stack

- **Next.js App Router**, **static export** (`output: 'export'`), client-heavy SPA. Used for routing
  + code-splitting (lazy-load the heavy solver route), **not** SSR. (Vite + React Router is an
  acceptable swap with zero impact on core packages.)
- **Zustand** for UI state. Engine state stays authoritative inside the core; the store holds a
  **view-model projection** of it plus pure UI state (selected size, panel open). The live
  `HandState` object is never put directly into React state.
- **Tailwind + Radix** (accessible primitives: dialog, tooltip, popover). Table felt = SVG/Canvas;
  13×13 grid = CSS grid.
- **IndexedDB via `idb`** behind a `SessionStore` interface defined in the core.

### 4.6 Boundary enforcement

`dependency-cruiser` (or `eslint-plugin-boundaries`) rules fail CI on: any core package importing
`react`/`next`/`apps/*`, any reference to browser globals in core, or any dependency cycle. TS
project references physically prevent cycles at compile time.

### 4.7 Where the WASM solver sits

```
React UI ── calls ──▶ StrategyProvider (interface)
                            │
              ┌─────────────┴───────────────┐
        PreflopChartProvider          PostflopSolverProvider
        (sync, in-thread,             (async, via SolverTransport)
         JSON lookup)                        │
                                        Web Worker ── runs ──▶ postflop-solver WASM
                                        (off main thread; solve = seconds)
```

`solver-worker` and `apps/web` are the only places that touch the WASM API; the core depends only on
the `SolverTransport` interface, so tests can inject a fake/precomputed transport.

---

## 5. Domain Model (`poker-engine`)

### 5.1 Cards

- `Card` = integer **0–51** internally (fast eval, tiny serialization) with `rank`/`suit` accessors.
- `Rank` 0–12 (2…A), `Suit` 0–3 (c/d/h/s).

### 5.2 Seeded RNG & Deck (reproducibility)

- `SeededRng` interface: `nextU32()`, `nextFloat()`, derivable sub-streams; **serializable** (store
  seed + step count). Default impl: PCG32 / xoshiro — fast, well-distributed, deterministic.
- `Deck`: built from a seed; `shuffle(rng)`, `deal(n)`, dead/known-card removal for equity. Always
  knows its seed → **replaying a seed reproduces the exact deck** (the "provably-fair-ish" study
  guarantee). The RNG is **injected**, never globally referenced.

### 5.3 Positions, Seats, Players

- `Position`: `UTG | HJ | CO | BTN | SB | BB` (6-max canonical order). Derived via
  `positionFor(seatIndex, buttonIndex, numPlayers)` — never stored loosely.
- `Seat`: `{ seatIndex, position, stack /*chips*/, holeCards?, status: active|folded|allIn|sittingOut,
  isHero, controller: 'human' | 'bot' }`.
- `PlayerController` interface: `decide(decisionPoint): Promise<Action>`. Both the human (resolved by
  the UI) and bots (resolved by sampling the StrategyProvider, §8.1) implement it.

### 5.4 Money model

**Chips internally, bb at the display/feedback edge** (avoids pot/side-pot float rounding bugs).

- `TableConfig`: `{ numSeats: 6, smallBlind, bigBlind, ante?, startingStacks (default 100bb),
  rake: RakeConfig, betSizeTree }`.
- **Rake** is config; charts are **tagged** with the rake assumption they were generated under
  (rake tightens ranges — §6.4 of domain notes).

### 5.5 Actions & betting rounds

- `ActionType`: `Fold | Check | Call | Bet | Raise | AllIn` (posting a blind is a forced event, not
  a decision).
- `Action`: `{ type, amount? /*total chips committed*/, seatIndex, street }`.
- `Street`: `Preflop | Flop | Turn | River`. Each `BettingRound` tracks current bet-to-call,
  min-raise, last aggressor, who has acted, action-closing logic.
- **Bet-size legality vs the size tree:** real raises are continuous; the trainer grades on a
  **discrete size tree** (RFI 2.5bb / SB 3bb; postflop 33% / 75% / 125% pot + overbets) from
  `domain-config`. The engine validates *legality* (≥ min-raise, ≤ stack); the trainer maps the
  user's amount to the **nearest tree size** for grading (§7.3).

### 5.6 Hand state machine

A **pure reducer** `advance(handState, event) → handState`:

```
PostBlinds → Preflop betting ─(≥2 live & action closed)→ DealFlop → Flop betting
   → DealTurn → Turn betting → DealRiver → River betting → Showdown → PayoutComplete
        ↑ short-circuits: all-but-one fold → Payout;  betting closes all-in → run-out → Showdown
```

Events are forced (post blind, deal cards) or player `Action`s. Pure + deterministic given the deck
seed → **testable and replayable** (§15).

### 5.7 Pot & side-pot resolution

Track per-seat committed chips across the hand. At showdown: sort all-in amounts, peel side-pot
layers, each pot contested only by eligible seats, award by best hand (ties split; odd chips by
position convention). Small but bug-prone → dedicated test vectors (§15).

### 5.8 `DecisionPoint` — the most important shared type

Emitted by the engine whenever a player must act; consumed **identically** by human, bots, scorer,
and replayer:

```ts
DecisionPoint {
  handId, street, seatIndex, position,
  heroHoleCards,            // ONLY the acting seat's cards
  board: Card[],            // [] preflop
  potChips, toCallChips, effectiveStackChips,
  actionHistory: Action[],  // the path to this node
  legalActions: LegalAction[],   // { type, minAmount?, maxAmount? }
  sizeOptions: SizeOption[],     // discrete tree sizes legal here (label, chips, %pot)
  nodeKey: GameNodeKey      // canonical, backend-agnostic tree position → StrategyProvider lookup
}
```

`nodeKey` is the bridge to strategy/scoring: a canonical description of "where we are in the game
tree" (positions + action sequence preflop; board + action sequence + ranges postflop). The **same
key shape** feeds chart lookup and solver lookup.

---

## 6. Strategy Provider — the spine (`strategy`)

### 6.1 The interface

One interface, two implementations; bots, scoring, heatmap, and feedback are all backend-agnostic.

```ts
interface StrategyProvider {
  supports(node: GameNodeKey): boolean
  getStrategy(node: GameNodeKey): Promise<NodeStrategy>   // Promise even for sync chart lookup
}

NodeStrategy {
  actions: ActionFrequency[]            // for the hero combo at this node
  evByAction?: Record<ActionId, number> // EV in bb — present IFF backend has true EV
  rangeView?: RangeStrategy             // full 169/combo grid → powers heatmap + combo display
  meta: { source: 'chart' | 'solver', confidence, rakeAssumption, version }
}

ActionFrequency { actionId, frequency /* 0..1, sums to 1 */, ev?: number /* bb */ }
```

**Design decisions:**

- `getStrategy` returns a `Promise` **even for the synchronous chart provider** — so the genuinely
  async solver is a drop-in and no consumer branches on backend type.
- `ev?` is **deliberately optional**. The solver gives EVs; published charts give **only
  frequencies**. Making it optional forces every consumer to handle the no-EV case honestly, instead
  of fabricating EVs.
- `rangeView` powers the 13×13 heatmap + combo display from the same call.
- `CompositeStrategyProvider` routes by `supports()`: preflop → chart, postflop → solver. The rest of
  the app holds one provider reference.

### 6.2 `GameNodeKey`

A canonical, backend-agnostic key. Preflop keys are fully enumerable (positions + action sequence) →
static lookup. Postflop keys add board + action sequence + ranges. `GameNodeKey → Spot.id` (preflop)
is a pure function.

### 6.3 Preflop chart provider & JSON schema

The **~42 trees**: RFI (6 positions minus BB), vs-RFI per (hero × opener), 3-bet, 4-bet, squeeze,
cold-call, blind-vs-blind. Data = a **manifest** + one file per spot; each spot is a **169 hand-class
grid**:

```
data/preflop-charts/<rakeProfile>/manifest.json
  { version, rakeAssumption, stackDepthBb: 100, spots: [SpotRef...] }

data/preflop-charts/<rakeProfile>/CO_vs_BTN_3bet.json
  Spot {
    id: "vsRFI/CO/openerBTN",
    heroPosition, context: { openerPosition?, priorActions... },
    actions: [{ id: "fold" }, { id: "call" }, { id: "3bet_9bb", sizeBb: 9 }, ...],
    grid: {
      "AKs": [{ actionId: "3bet_9bb", freq: 0.72 }, { actionId: "call", freq: 0.28 }],
      "AKo": [...],            // ... all 169 classes ...
    }
  }
```

- **169 hand-class granularity** (not 1326 combos) — matches available free chart data; the provider
  expands a concrete combo (A♠K♠) to its class (AKs) for lookup while keeping combo identity for
  future suit-specific data.
- **Versioned + rake-tagged**: multiple sets coexist (`6max_GG_rake`, `6max_rakefree`); the active
  set is config. **This is the swap-in seam** — same files, better numbers when solved/licensed data
  arrives.
- **Schema-validated in CI** (zod / JSON Schema): every spot has all 169 classes, each cell's
  frequencies sum to ~1.0 (±ε), every referenced size is legal.

### 6.4 Postflop solver provider (Phase 2)

`PostflopSolverProvider.getStrategy(node)` builds a `SolveRequest` (board, both ranges, bet-size
tree, stack/pot) and sends it through the injected `SolverTransport` to the worker.

- **Preflop→flop range handoff is the subtle part**: the solve needs both players' *ranges entering
  the flop*, derived from the preflop action path (chart ranges filtered to non-folding combos along
  the path). This range bridge is the integration's trickiest correctness point.
- **Performance strategy** (de-risk early via the Phase 0 spike):
  - Cache solves by canonical solve-key (board + ranges + tree + stacks) in memory + IndexedDB.
  - In *play* mode, **pre-solve the flop** in the background the moment it's dealt; spinner/abort if
    not ready when the user acts.
  - **Constrain the bet-size tree** (fewer sizes ⇒ dramatically faster/smaller solves); start with
    2–3 sizes.

---

## 7. Scoring Engine (`scoring`)

Inputs: the user's chosen `Action`, the `DecisionPoint`, and the `NodeStrategy` from the provider.

### 7.1 With per-action EV available (solver — ideal)

- `evLossBb = max_a(EV[a]) − EV[chosen]`.
- Classification by EV-loss thresholds (config; illustrative defaults in bb):

| Class | Condition |
|---|---|
| **Best** | chosen == argmax EV (within ε ≈ 0.01bb) |
| **Correct** | EV loss ≤ ~0.10bb (a legitimate part of the mix) |
| **Inaccuracy** | EV loss ≤ ~0.5bb |
| **Wrong** | EV loss ≤ ~2bb |
| **Blunder** | EV loss > ~2bb |

### 7.2 With frequencies only (preflop charts — the MVP case) — **honest modeling**

We lack true EVs, so we use an explicit **frequency-derived EV-loss model**:

- Any action with **`frequency > 0` is in the GTO mix** → at worst **Correct**, never a mistake.
  Mixed actions are ~EV-equal at equilibrium, so penalizing a low-but-nonzero-frequency action would
  be wrong.
- Actions with **`frequency == 0`** (pure mistakes) get an **estimated** EV loss from a severity
  heuristic (distance from the correct action in the action lattice — e.g. fold-when-pure-3bet is
  worse than call-when-3bet-or-call — scaled by pot/stack), tagged **`confidence: low`** and surfaced
  as *"estimated"* in the UI.
- **Best** preflop = highest-frequency action; **Correct** = any other nonzero-frequency action.
- This is a **documented limitation of chart-only data**, not a hidden defect. It **upgrades
  automatically** to real EV loss when solver/licensed data lands (same code path, `ev` now present).

### 7.3 Mixed-strategy credit & the RNG-frequency model

- **Per-decision partial credit = frequency of the chosen action** (choose the 0.3 line of a
  {0.7/0.3} mix → 70% credit; both are "Correct", but the modal play scores higher). This rewards the
  best play without punishing valid mixing.
- **Bots and "what GTO would do"** use the **RNG-frequency model**: sample the action ∝ frequency
  using the session's **seeded** RNG → reproducible (same seed → same GTO opponent choices), which is
  essential for study mode.
- **Aggregate** session score uses summed EV loss (real or estimated), *not* the partial-credit
  number — partial credit is a per-decision UX nicety; EV loss is the ground-truth metric.

### 7.4 Bet-size grading

Map the user's chosen size to the **nearest tree size** (by %-pot distance). Two-part grade:

1. **Action-type correctness** (bet vs check/call/fold) — graded as above.
2. **Sizing correctness** (given a bet): EV loss of the chosen size vs the best size (solver) or
   frequency credit on the size buckets (chart-only preflop, e.g. RFI 2.5 vs 3bb).

Very off-tree sizes snap to the nearest and the snap is **shown in feedback** (*"graded as 75%
pot"*) — a documented limitation of discrete-tree grading.

### 7.5 Aggregation & metrics

- **Per decision:** `{ classification, evLossBb, frequencyCredit, street, position, nodeKey,
  confidence }`.
- **Session / lifetime rollups:** total EV loss · avg EV loss/hand · EV loss/mistake · mistakes by
  class · accuracy % per **street** / per **position** / per **spot-category** · **mbb/g**
  (1 mbb/g = 0.1 bb/100). Computed incrementally, persisted to IndexedDB, feeds Phase 3 leak tracking.

---

## 8. Bots & Card Visibility

### 8.1 Bots sample the same StrategyProvider

GTO bot `decide(decisionPoint)`:

1. `provider.getStrategy(node)` for the bot's own combo.
2. Sample an action ∝ `frequency` with the **seeded session RNG** (reproducible).
3. Resolve the `actionId` → concrete `Action` (size label → chips via the tree + pot).

Because the bot plays the **same strategy the user is graded against**, feedback is clean and
consistent. **Exploitable archetypes** (Fish / Nit / Maniac) are a later add: **decorator
providers** that perturb the GTO frequencies (Nit shifts mass toward fold/tight, Maniac toward
aggression) — same interface, wrapped.

### 8.2 Only-own-cards (information hiding done structurally)

- The `Deck` deals hole cards into each `Seat.holeCards`, but **`DecisionPoint.heroHoleCards` only
  ever contains the acting seat's cards.** The engine builds a fresh `DecisionPoint` per actor and
  never includes others' cards.
- The **React layer sees only a view-model projection**; opponent cards are hidden until showdown.
  Because engine state stays in the core and only projections cross into React, there's no
  "open the console to read opponent cards" leak in normal play. At **showdown**, the projection
  reveals contesting seats' cards.

---

## 9. Features

### 9.1 Modes: Play / Study / Analyze (first-class separation)

- **Play** — practice hands vs bots, get per-decision feedback.
- **Study** — browse GTO solutions, ranges, equity distributions, heatmaps (no grading).
- **Analyze** — import hand histories, replay with GTO overlays (§9.4).

### 9.2 Drill modes

- **Full hand** — preflop→river, cumulative EV feedback at hand end.
- **Single-spot** — one decision node repeated in isolation; fly through trivial spots, halt on
  blunders.
- **Street** — practice one street only (e.g. "flop c-bet decisions").
- **Range-builder** — construct the entire strategy for a spot; graded on how closely the built range
  matches GTO (forces global thinking).
- **Saved drills** — persist parameters (position, stack depth, opponent, board-texture filters) and
  replay without reconfiguration.

### 9.3 Feedback panel (per decision)

Your action vs the GTO mix · per-action **frequencies** · **EV loss** (real or *estimated* + tagged)
· **classification** (Best/Correct/Inaccuracy/Wrong/Blunder) · sizing grade (with any snap noted) ·
the 13×13 strategy grid for the spot.

### 9.4 Hand history & replayer

- Internal `HandHistory` record + **PokerStars text format** import/export (the de-facto standard).
- **Replayer**: rebuild the state machine from history; step through actions/streets; toggle own
  cards (study vs practice); GTO overlay + EV-loss at each node.

### 9.5 Analytics & leak tracking

Per-position matrix (e.g. "BTN c-bet 65% vs GTO 72%") · pot-type breakdown (RFI / 3-bet / 4-bet /
squeeze pots) · mistake-type categorization (under-bluffing, over-folding, wrong sizing, frequency
inaccuracy) · per-street accuracy · trends over time · weak-spot identification feeding drill
filters (manual spaced repetition).

### 9.6 Visualization

13×13 hand grid (rows = first rank, cols = second; suited upper-triangle / offsuit lower) with
**action-frequency color intensity (heatmap)** · range vs combo display toggle · EV-loss-over-time
and accuracy charts.

---

## 10. RNG & Fairness

This is a *trainer*, not a gambling site, so RNG fairness is about **transparency and
reproducibility**, not anti-cheat:

- Deck order is **seed-derived** (system entropy + optional user-provided seed).
- A session records its seed; **replaying the seed reproduces the exact deck** → consistent study and
  deterministic tests.
- Distribution is uniform (each combo equally likely) — verified in tests.

---

## 11. Data & Persistence

- **IndexedDB** (via `idb`) behind a `SessionStore` interface defined in the core. Stores:
  - `sessions` — `{ id, startedAt, config, seed, rollups }`
  - `decisions` — per-decision records (§7.5) keyed by session + hand + node
  - `handHistories` — internal records + raw imported text
  - `stats` — lifetime rollups
- **Chart assets**: static JSON under `data/preflop-charts/<rakeProfile>/`, versioned; active set
  selected by config. Build-time schema validation.

---

## 12. UI/UX & Accessibility

Table renderer (felt, seats, chips, board, pot) · action controls (fold/check/call/bet + size
slider snapping to the tree) · responsive layout (designed so a future mobile client maps cleanly) ·
keyboard navigation for all actions · Radix primitives for accessible dialogs/tooltips/popovers ·
sufficient color contrast · screen-reader-announced feedback. (Mobile-app functionality is **future
scope**; v1 ships a complete, responsive web app.)

---

## 13. Configuration

`domain-config` centralizes: positions & order · **bet-size trees** (RFI 2.5bb / SB 3bb; postflop
33/75/125% + overbets) · **rake profiles** · scoring thresholds (Best/Correct/Inaccuracy/Wrong/
Blunder cutoffs) · chart-set selection · stack depth (default 100bb). All tunable without touching
engine code.

---

## 14. Performance Budgets

- **Main thread stays responsive** — all solving off-thread in a worker.
- **Preflop** lookups are effectively instant (in-memory JSON).
- **Postflop solve** time/RAM targets are set **concretely from the Phase 0 perf spike**; UX
  (pre-solve-on-flop, caching, abort) is designed around that real number.
- **Lazy-load** the solver route; decide eager-vs-lazy WASM eval loading after the spike.

---

## 15. Testing Strategy

- **hand-eval**: known 7-card vectors (royal flush > quads > …; kicker/tie cases); cross-check a
  sample against an independent evaluator; property test (best-5-of-7 is rank-monotonic).
- **poker-engine (deterministic, seeded)**: golden-master hand transcripts (seed + action script →
  fixed event sequence + payouts) · **side-pot vector suite** (unequal all-ins, ties, odd-chip
  splits) · action-legality tests · determinism test (same seed → identical deal + outcome).
- **Equity**: Monte-Carlo converges to closed-form (AA vs KK preflop ≈ 81/19) within tolerance;
  exhaustive river equity is exact.
- **strategy**: chart JSON schema validation (169 cells, freqs sum ~1, sizes legal) · `GameNodeKey →
  Spot.id` mapping · **accuracy spot-checks** vs a held-out set of known GTO spots ("BTN vs BB 3-bet
  freq for AKs ≈ known value").
- **scoring**: classification boundary tests · partial-credit-by-frequency · bet-size nearest-mapping
  + snap · the **no-EV degradation path** (estimated EV loss produced + tagged low-confidence) ·
  aggregation math (mbb/g, per-street/position rollups).
- **Phase 2 solver**: identical (board, ranges, tree, stacks) inputs match the WASM Postflop
  reference within tolerance · transport contract tests with a fake transport · cache correctness.
- **hand-history**: PokerStars export→import round-trip equals original · real-hand fixture corpus.
- **E2E (Playwright, deterministic via fixed seed)**: play hand → feedback → complete → stats update.
- **Manual end-to-end (fixed seed)**: play a scripted preflop hand; confirm feedback frequencies
  match the chart, the heatmap renders the right spot, opponent cards stay hidden until showdown, and
  session stats increment correctly.

---

## 16. Phased Roadmap

| Phase | Build | Success criteria | Key risks |
|---|---|---|---|
| **0 — Scaffold & de-risk** | monorepo (pnpm+turbo+TS refs), boundary lint, CI, `domain-config`, `hand-eval` wrapper + vectors, `SeededRng`+`Deck`. **Spikes:** hand-eval WASM in browser; **postflop-solver WASM perf spike** (solve time/RAM). | build/test/lint green; boundary violations fail CI; eval passes vectors; deck deterministic; trustworthy solve-perf number. | wrong eval lib (mitigate: thin wrapper); solver slower than hoped (discovered now). |
| **1 — Preflop MVP (deliverable)** | full state machine (only preflop trained; rest runs to showdown), pot/side-pots, `PreflopChartProvider` + seeded charts, GTO bots, scoring (freq credit + estimated EV + size grading), session stats, web UI (table, controls, feedback panel, heatmap, stats), reproducible decks. | play a preflop hand → correct GTO feedback on action + sizing → hand completes → session accuracy/EV-loss rolls up; charts validated vs held-out spots. | **chart accuracy** (validation suite + swap-in seam); **mixed-strategy scoring correctness** (documented model + spot tests). |
| **2 — Postflop HU solver** | `solver-worker` (postflop-solver WASM), `SolverTransport`, `PostflopSolverProvider`, **preflop→flop range handoff**, solve caching, pre-solve-on-flop + abort/progress, postflop feedback/heatmaps, board-texture categorization. | HU postflop pots give real per-action EV feedback within the P0 perf budget; repeated drills instant via cache. | solver perf/RAM on low-end devices; range-handoff correctness (validate vs WASM Postflop). |
| **3 — Analytics/leaks/replayer** | `hand-history` PokerStars import/export, replayer with feedback overlays, leak dashboards & trends, mbb/g reporting. | import a PokerStars hand → replay with GTO feedback per node; dashboards reveal recurring leaks; export round-trips losslessly. | PokerStars format edge cases (real-hand fixture corpus). |
| **4 — Drills/archetypes/polish** | drill modes (full/spot/street/range-builder), archetype bots (Fish/Nit/Maniac decorators), Play/Study/Analyze sections, a11y + perf polish, onboarding. | spaced drilling on weak spots from leak data; archetypes feel distinct; a11y audit passes. | scope creep (drills reuse engine/strategy/scoring — config + UI, not new core). |
| **Future — Mobile** | React Native consuming the unchanged core; RN implementations of the injected interfaces. | preflop trainer fully functional on RN reusing 100% of core. | **solver transport** (WASM-in-RN harder; native module or remote solve service). |

**Riskiest pieces, de-risked earliest:** solver perf (P0 spike) · chart accuracy (P1 validation +
swap-in seam) · mixed-strategy scoring (P1, documented + tested before UI polish).

---

## 17. Risks & Open Questions

- **Preflop chart accuracy** — free charts are at hand-class granularity and vary in quality. Mitigate
  with a validation suite of known spots and the versioned swap-in seam.
- **Mixed-strategy scoring without true EV** — the frequency-derived model (§7.2) is an
  approximation; documented and tagged low-confidence; upgrades when solver/licensed data lands.
- **Solver perf/RAM** — unknown until the P0 spike; gates Phase 2 UX.
- **PokerStars parsing** — many format quirks; needs a real-hand fixture corpus.
- **RN solver transport** — the one piece not solvable by the platform-agnostic-core discipline.
- **Open questions (non-blocking):** which free chart source + rake profile to seed first; concrete
  postflop solve UX budget (set from spike); eager-vs-lazy WASM eval loading.

---

## 18. Licensing & Attribution

- **postflop-solver** & WASM Postflop reference: **AGPL-3.0**. Acceptable because this is a
  personal/open-source project (AGPL's network-copyleft means a hosted version must publish its
  modified source — fine here). If the project ever goes commercial-closed, switch the postflop core
  to a permissive solver (**rs-poker** Apache-2.0, **RoboPoker** MIT) or negotiate a commercial
  license.
- **Hand evaluator**: PokerHandEvaluator-WASM (Apache-2.0) or `poker-evaluator` (ISC) — permissive.
- **Preflop charts**: seeded from free published sources — attribute the source, tag rake/version,
  and respect each source's terms (no redistribution of licensed datasets).
- Maintain an `ATTRIBUTIONS` / `NOTICE` file listing all third-party components + licenses.

---

## 19. Glossary

- **GTO** — Game-Theory-Optimal; the Nash-equilibrium (unexploitable) strategy.
- **CFR / CFR+ / MCCFR / DCFR** — Counterfactual Regret Minimization and variants; the algorithms
  solvers use to approximate equilibrium.
- **EV** — Expected Value (here, in big blinds). **EV loss** — EV of the best action minus EV of the
  chosen action.
- **mbb/g** — milli-big-blinds per game; 1 mbb/g = 0.1 bb/100 hands.
- **Range** — the distribution of hands a player can hold in a spot. **Combo** — a specific
  two-card holding (1326 total). **Hand class** — rank+suitedness bucket (169 total: pairs, suited,
  offsuit).
- **Mixed strategy** — playing the same hand multiple ways by frequency (e.g. bet 70% / check 30%).
- **Position** — UTG, HJ, CO, BTN, SB, BB (6-max). **RFI** — Raise First In (open). **3-bet / 4-bet**
  — successive re-raises. **Squeeze** — re-raise over an open + caller(s). **BvB** — blind vs blind.
  **Cold-call** — calling a raise having put no prior chips in.
- **c-bet** — continuation bet (the preflop raiser bets the flop). **Board texture** — dry/wet/paired
  classification of community cards. **Range vs range equity** — equity of one full range against
  another.
- **Side pot** — a separate pot created when a player is all-in for less than others' bets.
- **Rake** — the house's cut of a cash pot; tightens GTO ranges.
- **ICM** — Independent Chip Model; tournament-only chip-equity model — **irrelevant to cash**.
- **Node lock** — constraining one player's strategy at a node and re-solving the counter-strategy.
