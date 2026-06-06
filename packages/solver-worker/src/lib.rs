//! WASM glue around `postflop-solver` for the GTO Trainer (spec §4.7, §6.4).
//!
//! ⚠️ UNVERIFIED SCAFFOLD. This file is written against the documented
//! `postflop-solver` public API, but it has NOT been compiled here (the default
//! environment has no Rust toolchain). Build it per `BUILD.md`; expect to adjust
//! a few API names/signatures against the exact crate version you pin. Every
//! such spot is marked `VERIFY:`.
//!
//! Contract: `solve(request_json) -> result_json`, where the JSON shapes mirror
//! the TypeScript `SolveRequest` / `SolveResult` in
//! `packages/strategy/src/postflop-types.ts`. The hero strategy is returned
//! per-combo with per-action EV in **big blinds**, so the TS side needs no
//! further math. Card integers use our engine encoding (`rank*4 + suit`, rank
//! 0=2..12=A, suit 0=c,1=d,2=h,3=s) — see `to_solver_card` for the remap.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// VERIFY: bring the solver's public items into scope; names per its README.
use postflop_solver::*;

#[derive(Deserialize)]
struct ComboDto {
    /// Two engine-encoded cards (0..=51).
    hand: [u8; 2],
    weight: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolveRequestDto {
    board: Vec<u8>,
    hero_range: Vec<ComboDto>,
    villain_range: Vec<ComboDto>,
    pot_chips: f64,
    effective_stack_chips: f64,
    big_blind_chips: f64,
    to_call_chips: f64,
    bet_fractions: Vec<f64>,
    #[serde(default)]
    hero_is_oop: bool,
    #[serde(default)]
    rake_percent: f64,
    #[serde(default)]
    rake_cap_chips: f64,
    /// Solve budget (the play-mode levers from BUILD.md). The TS side sets these
    /// per street — flop trees are far larger than turn/river, so a caller can
    /// trade accuracy for latency. Default to the previous hardcoded values.
    #[serde(default)]
    max_iterations: Option<u32>,
    #[serde(default)]
    target_exploitability_fraction: Option<f64>,
}

#[derive(Serialize)]
struct ActionDto {
    #[serde(rename = "actionId")]
    action_id: String,
    frequency: f32,
    ev: f32,
}

#[derive(Serialize)]
struct ComboStrategyDto {
    hand: [u8; 2],
    actions: Vec<ActionDto>,
}

#[derive(Serialize)]
struct MetaDto {
    confidence: String,
    approximate: bool,
    label: String,
}

#[derive(Serialize)]
struct SolveResultDto {
    hero: Vec<ComboStrategyDto>,
    meta: MetaDto,
}

/// Remap an engine card (rank*4+suit, suit c,d,h,s) to the solver's encoding.
/// Verified: postflop-solver also uses `4*rank + suit` with suit order
/// club=0, diamond=1, heart=2, spade=3 — identical to our engine, so this is
/// the identity (see card.rs docs in the pinned crate).
fn to_solver_card(engine_card: u8) -> Card {
    engine_card as Card
}

/// Build a solver `Range` (1326 weights) from our weighted combos. Uses the
/// public `from_hands_weights` constructor (the combo-index fn is `pub(crate)`).
/// A malformed range degrades to empty rather than panicking the worker; valid
/// upstream ranges never hit that path.
fn build_range(combos: &[ComboDto]) -> Range {
    let hands: Vec<(Card, Card)> = combos
        .iter()
        .map(|c| (to_solver_card(c.hand[0]), to_solver_card(c.hand[1])))
        .collect();
    let weights: Vec<f32> = combos.iter().map(|c| c.weight).collect();
    Range::from_hands_weights(&hands, &weights).unwrap_or_else(|_| Range::new())
}

/// Format our pot-fraction bet sizes as the solver's bet-size string ("33%,75%").
fn bet_size_string(fractions: &[f64]) -> String {
    fractions
        .iter()
        .map(|f| format!("{}%", (f * 100.0).round() as i64))
        .collect::<Vec<_>>()
        .join(",")
}

#[wasm_bindgen]
pub fn solve(request_json: &str) -> String {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    let req: SolveRequestDto = match serde_json::from_str(request_json) {
        Ok(r) => r,
        Err(e) => return format!("{{\"error\":\"bad request: {e}\"}}"),
    };

    match solve_inner(&req) {
        Ok(result) => serde_json::to_string(&result)
            .unwrap_or_else(|e| format!("{{\"error\":\"serialize: {e}\"}}")),
        // A typed fallback signal (e.g. an unsupported node): the worker rejects
        // on `error`, and the routing transport serves the baseline instead.
        Err(e) => {
            let escaped = e.replace('\\', "\\\\").replace('"', "\\\"");
            format!("{{\"error\":\"{escaped}\"}}")
        }
    }
}

fn solve_inner(req: &SolveRequestDto) -> Result<SolveResultDto, String> {
    let bb = req.big_blind_chips.max(1.0);
    let to_bb = |chips: f64| (chips / bb) as f32;

    // Orient ranges as [OOP, IP] as the solver expects.
    let hero_range = build_range(&req.hero_range);
    let villain_range = build_range(&req.villain_range);
    let (oop_range, ip_range) = if req.hero_is_oop {
        (hero_range, villain_range)
    } else {
        (villain_range, hero_range)
    };

    let flop: [Card; 3] = [
        to_solver_card(req.board[0]),
        to_solver_card(req.board[1]),
        to_solver_card(req.board[2]),
    ];
    let turn = req.board.get(3).map(|c| to_solver_card(*c)).unwrap_or(NOT_DEALT);
    let river = req.board.get(4).map(|c| to_solver_card(*c)).unwrap_or(NOT_DEALT);

    let card_config = CardConfig {
        range: [oop_range, ip_range],
        flop,
        turn,
        river,
    };

    // Verified: BetSizeOptions::try_from((bet, raise)) takes (&str, &str).
    let bet_sizes = bet_size_string(&req.bet_fractions);
    let bet = BetSizeOptions::try_from((bet_sizes.as_str(), bet_sizes.as_str())).unwrap();

    let tree_config = TreeConfig {
        initial_state: board_state_for(&req.board),
        starting_pot: req.pot_chips.round() as i32,
        effective_stack: req.effective_stack_chips.round() as i32,
        rake_rate: req.rake_percent,
        rake_cap: req.rake_cap_chips,
        flop_bet_sizes: [bet.clone(), bet.clone()],
        turn_bet_sizes: [bet.clone(), bet.clone()],
        river_bet_sizes: [bet.clone(), bet.clone()],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    };

    let action_tree = ActionTree::new(tree_config).unwrap();
    let mut game = PostFlopGame::with_config(card_config, action_tree).unwrap();
    game.allocate_memory(false);

    // Solve to a target exploitability or iteration cap, whichever comes first.
    // Caller-tunable per street (flop trees are ~200x the turn). Qualified path:
    // our own `solve` (the wasm_bindgen entry point) shadows the glob import.
    let max_iter = req.max_iterations.unwrap_or(200);
    let target_frac = req.target_exploitability_fraction.unwrap_or(0.005);
    postflop_solver::solve(&mut game, max_iter, (req.pot_chips * target_frac) as f32, false);

    // Navigate to the hero's decision node before reading. The action tree's root
    // is always the OOP player's first action.
    let hero_player = if req.hero_is_oop { 0 } else { 1 };
    if req.to_call_chips > 0.0 {
        // Facing a bet: the hero's node sits past villain's bet. Reconstructing
        // that line needs the street action path (Phase B). The baseline transport
        // serves these correctly today, so signal a fallback rather than reading
        // the wrong (root) node.
        return Err("wasm solver: facing-a-bet nodes not yet supported".to_string());
    }
    game.back_to_root();
    if !req.hero_is_oop {
        // Hero is in position with nothing to call, so OOP checked to it. Advance
        // past that check to reach the hero's first decision. (A check moves no
        // chips, so the node's pot/stack accounting is unchanged.)
        let actions = game.available_actions();
        let check_idx = actions
            .iter()
            .position(|a| matches!(a, Action::Check))
            .ok_or_else(|| "wasm solver: expected an OOP check before the IP hero's turn".to_string())?;
        game.play(check_idx);
    }

    let hero_strategy = read_hero_strategy(&mut game, hero_player, to_bb);

    Ok(SolveResultDto {
        hero: hero_strategy,
        meta: MetaDto {
            confidence: "high".to_string(),
            approximate: false,
            label: "wasm".to_string(),
        },
    })
}

fn board_state_for(board: &[u8]) -> BoardState {
    match board.len() {
        0..=3 => BoardState::Flop,
        4 => BoardState::Turn,
        _ => BoardState::River,
    }
}

/// Read the hero's per-combo strategy + per-action EV at the *current* node. The
/// caller must already be at the hero's decision (hero == current player), so no
/// tree navigation happens here. `strategy()` and `expected_values_detail()` share
/// the same `[action * num_hands + hand]` (column-major) layout, so per-action EVs
/// come from one read instead of playing each action and unwinding.
fn read_hero_strategy(
    game: &mut PostFlopGame,
    hero_player: usize,
    to_bb: impl Fn(f64) -> f32,
) -> Vec<ComboStrategyDto> {
    game.cache_normalized_weights(); // required by expected_values_detail at this node
    let cards = game.private_cards(hero_player).to_vec(); // Vec<(Card, Card)>
    let actions = game.available_actions(); // Vec<Action>, the hero's options here
    let strategy = game.strategy(); // freq per (action, hand)
    let evs = game.expected_values_detail(hero_player); // EV (chips) per (action, hand)
    let num_hands = cards.len();

    let mut out = Vec::with_capacity(num_hands);
    for h in 0..num_hands {
        let mut row = Vec::with_capacity(actions.len());
        for a in 0..actions.len() {
            let idx = a * num_hands + h;
            row.push(ActionDto {
                action_id: action_id_for(&actions[a]),
                frequency: strategy[idx],
                ev: to_bb(evs[idx] as f64),
            });
        }
        let (c1, c2) = cards[h];
        out.push(ComboStrategyDto {
            hand: [from_solver_card(c1), from_solver_card(c2)],
            actions: row,
        });
    }
    out
}

/// Inverse of `to_solver_card`; identity since the encodings match (verified).
fn from_solver_card(c: Card) -> u8 {
    c as u8
}

/// Map a solver `Action` to our chart actionId convention ('check' | 'call' |
/// 'fold' | 'raiseTo:<bb>' | 'allIn'). VERIFY the Action enum variants.
fn action_id_for(action: &Action) -> String {
    match action {
        Action::Fold => "fold".to_string(),
        Action::Check => "check".to_string(),
        Action::Call => "call".to_string(),
        Action::AllIn(_) => "allIn".to_string(),
        // Bet/Raise carry a chip amount; the TS scorer snaps to the nearest tree
        // size, so emitting the raise-to in bb is sufficient. VERIFY field access.
        Action::Bet(amount) | Action::Raise(amount) => format!("raiseTo:{}", amount),
        _ => "check".to_string(),
    }
}
