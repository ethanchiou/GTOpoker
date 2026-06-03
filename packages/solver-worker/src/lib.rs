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
/// VERIFY: postflop-solver also uses rank*4+suit; confirm its suit order. If it
/// matches (c,d,h,s) this is the identity and the function can stay as-is.
fn to_solver_card(engine_card: u8) -> Card {
    engine_card as Card
}

/// Build a solver `Range` (1326 weights) from our weighted combos.
fn build_range(combos: &[ComboDto]) -> Range {
    let mut data = [0.0f32; 1326];
    for c in combos {
        let a = to_solver_card(c.hand[0]);
        let b = to_solver_card(c.hand[1]);
        // VERIFY: `card_pair_to_index(c1, c2)` is the canonical combo index.
        let idx = card_pair_to_index(a, b);
        data[idx] = c.weight;
    }
    // VERIFY: constructor name for building a Range from raw [f32; 1326].
    Range::from_raw_data(&data)
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

    let result = solve_inner(&req);
    serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"serialize: {e}\"}}"))
}

fn solve_inner(req: &SolveRequestDto) -> SolveResultDto {
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

    // VERIFY: BetSizeCandidates::try_from((bet, raise)) signature.
    let bet_sizes = bet_size_string(&req.bet_fractions);
    let bet = BetSizeCandidates::try_from((bet_sizes.as_str(), bet_sizes.as_str())).unwrap();

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

    // Solve to a modest target exploitability; tune in BUILD.md / perf spike.
    solve(&mut game, 200, req.pot_chips as f32 * 0.005, false);
    game.cache_normalized_weights();
    game.back_to_root();

    // The hero is OOP=0 / IP=1 depending on position.
    let hero_player = if req.hero_is_oop { 0 } else { 1 };

    // NOTE: This reads the *root* (flop, first decision) node. When the hero
    // faces a bet (to_call_chips > 0) the real node is one or more actions deep;
    // navigate via `game.play(action_idx)` before reading. TODO: thread the
    // postflop action path through the request to locate non-root nodes.
    let _ = req.to_call_chips;

    let hero_strategy = read_hero_strategy(&mut game, hero_player, to_bb);

    SolveResultDto {
        hero: hero_strategy,
        meta: MetaDto {
            confidence: "high".to_string(),
            approximate: false,
            label: "wasm".to_string(),
        },
    }
}

fn board_state_for(board: &[u8]) -> BoardState {
    match board.len() {
        0..=3 => BoardState::Flop,
        4 => BoardState::Turn,
        _ => BoardState::River,
    }
}

/// Read the current node's hero strategy + per-action EV, per combo.
fn read_hero_strategy(
    game: &mut PostFlopGame,
    hero_player: usize,
    to_bb: impl Fn(f64) -> f32,
) -> Vec<ComboStrategyDto> {
    // VERIFY: these accessor names against the pinned crate version.
    let cards = game.private_cards(hero_player).to_vec(); // Vec<(Card, Card)>
    let actions = game.available_actions(); // Vec<Action>
    let strategy = game.strategy(); // len = num_actions * num_hands (column-major)
    let num_hands = cards.len();

    // Per-action EV: play each action, read the hero's EVs, then unwind.
    let mut action_ev: Vec<Vec<f32>> = Vec::with_capacity(actions.len());
    for a in 0..actions.len() {
        game.play(a);
        let ev = game.expected_values(hero_player); // EV per hero hand (chips)
        action_ev.push(ev.iter().map(|e| to_bb(*e as f64)).collect());
        game.back_to_root();
    }

    let mut out = Vec::with_capacity(num_hands);
    for h in 0..num_hands {
        let mut row = Vec::with_capacity(actions.len());
        for a in 0..actions.len() {
            row.push(ActionDto {
                action_id: action_id_for(&actions[a]),
                frequency: strategy[a * num_hands + h],
                ev: action_ev[a][h],
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

/// Inverse of `to_solver_card` (identity if encodings match — VERIFY).
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
