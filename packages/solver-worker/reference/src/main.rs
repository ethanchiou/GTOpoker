//! Crate-native reference output for solver correctness validation (task 5).
//!
//! For each spot we define the TRUE scenario (street-start pot, street-start
//! effective stack, ranges, board, bet sizes, and an abstract action path), build
//! the subgame with the crate's native API, solve it, navigate to the hero's node,
//! and read its per-combo strategy + per-action EV. We then emit BOTH:
//!   - `expected`: that reference output, and
//!   - `request`: the equivalent `SolveRequest` our WASM glue consumes (pot made
//!     inclusive of street bets, committed amounts, the replay path),
//! so the TS comparator can run our glue on the request and diff against `expected`.
//!
//! The reference uses the true street-start pot/stack DIRECTLY; our glue derives
//! them from the request. That difference is exactly what task 5 must validate.

use postflop_solver::*;
use serde::Serialize;

// Engine card encoding (identical to the crate's): rank*4 + suit; rank 0=2..12=A;
// suit 0=c,1=d,2=h,3=s.
fn card(s: &str) -> u8 {
    let r = match &s[0..1] {
        "2" => 0, "3" => 1, "4" => 2, "5" => 3, "6" => 4, "7" => 5, "8" => 6, "9" => 7,
        "T" => 8, "J" => 9, "Q" => 10, "K" => 11, "A" => 12,
        other => panic!("bad rank {other}"),
    };
    let su = match &s[1..2] {
        "c" => 0, "d" => 1, "h" => 2, "s" => 3,
        other => panic!("bad suit {other}"),
    };
    r * 4 + su
}

fn cards(list: &[&str]) -> Vec<u8> {
    list.iter().map(|s| card(s)).collect()
}

/// A weighted holding, in engine card encoding.
#[derive(Clone)]
struct Holding {
    hand: [u8; 2],
    weight: f32,
}

fn hand(a: &str, b: &str) -> Holding {
    Holding { hand: [card(a), card(b)], weight: 1.0 }
}

/// One step on the current street before the hero acts. A call closes the betting,
/// so only checks and aggressive actions precede a hero decision. For aggressive
/// steps we pick the `nth` smallest Bet/Raise/AllIn the tree offers and read back
/// its exact chip amount, so the request's `toChips` always lands on a real tree size.
enum Step {
    Check { actor: usize },
    Aggressive { actor: usize, nth: usize },
}

struct Spot {
    name: &'static str,
    board: Vec<u8>,
    oop: Vec<Holding>,
    ip: Vec<Holding>,
    /// True pot at the start of this street's betting.
    starting_pot: i32,
    /// True effective stack at the start of this street.
    effective_stack: i32,
    big_blind: f64,
    bet_fractions: Vec<f64>,
    hero_is_oop: bool,
    /// Abstract path from the street root to the hero's node.
    path: Vec<Step>,
    max_iterations: u32,
    target_exploitability_fraction: f64,
}

// ---- JSON output shapes (camelCase to match the TS SolveRequest / fixture) ----

#[derive(Serialize)]
struct ComboJson {
    hand: [u8; 2],
    weight: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StepJson {
    actor: String,
    kind: String,
    to_chips: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestJson {
    board: Vec<u8>,
    hero_range: Vec<ComboJson>,
    villain_range: Vec<ComboJson>,
    pot_chips: f64,
    effective_stack_chips: f64,
    big_blind_chips: f64,
    to_call_chips: f64,
    hero_committed_this_street_chips: f64,
    villain_committed_this_street_chips: f64,
    street_action_path: Vec<StepJson>,
    bet_fractions: Vec<f64>,
    hero_is_oop: bool,
    max_iterations: u32,
    target_exploitability_fraction: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionJson {
    action_id: String,
    frequency: f32,
    ev: f32,
}

#[derive(Serialize)]
struct ComboStrategyJson {
    hand: [u8; 2],
    actions: Vec<ActionJson>,
}

#[derive(Serialize)]
struct SpotJson {
    name: String,
    request: RequestJson,
    expected: Vec<ComboStrategyJson>,
}

#[derive(Serialize)]
struct Tolerance {
    freq: f32,
    ev: f32,
}

#[derive(Serialize)]
struct Fixture {
    /// Per-combo agreement bounds. Generous enough to absorb wasm32-vs-native f32
    /// ordering noise; a real glue bug (wrong node / pot / range) blows past them.
    tolerance: Tolerance,
    spots: Vec<SpotJson>,
}

fn to_solver_card(c: u8) -> Card {
    c as Card
}

fn build_range(combos: &[Holding]) -> Range {
    let hands: Vec<(Card, Card)> = combos
        .iter()
        .map(|c| (to_solver_card(c.hand[0]), to_solver_card(c.hand[1])))
        .collect();
    let weights: Vec<f32> = combos.iter().map(|c| c.weight).collect();
    Range::from_hands_weights(&hands, &weights).expect("valid reference range")
}

fn bet_size_string(fractions: &[f64]) -> String {
    fractions
        .iter()
        .map(|f| format!("{}%", (f * 100.0).round() as i64))
        .collect::<Vec<_>>()
        .join(",")
}

fn board_state_for(board: &[u8]) -> BoardState {
    match board.len() {
        0..=3 => BoardState::Flop,
        4 => BoardState::Turn,
        _ => BoardState::River,
    }
}

fn action_id_for(action: &Action) -> String {
    match action {
        Action::Fold => "fold".to_string(),
        Action::Check => "check".to_string(),
        Action::Call => "call".to_string(),
        Action::AllIn(_) => "allIn".to_string(),
        Action::Bet(amount) | Action::Raise(amount) => format!("raiseTo:{}", amount),
        _ => "check".to_string(),
    }
}

/// Index of the `nth` smallest Bet/Raise/AllIn in `actions`, with its chip amount.
fn nth_aggressive(actions: &[Action], nth: usize) -> (usize, i32) {
    let mut aggressive: Vec<(usize, i32)> = actions
        .iter()
        .enumerate()
        .filter_map(|(i, a)| match a {
            Action::Bet(x) | Action::Raise(x) | Action::AllIn(x) => Some((i, *x)),
            _ => None,
        })
        .collect();
    aggressive.sort_by_key(|(_, x)| *x);
    aggressive
        .get(nth)
        .copied()
        .unwrap_or_else(|| panic!("no {nth}-th aggressive action among {actions:?}"))
}

fn solve_spot(spot: &Spot) -> SpotJson {
    let bb = spot.big_blind.max(1.0);
    let to_bb = |chips: f64| (chips / bb) as f32;

    let flop: [Card; 3] = [
        to_solver_card(spot.board[0]),
        to_solver_card(spot.board[1]),
        to_solver_card(spot.board[2]),
    ];
    let turn = spot.board.get(3).map(|c| to_solver_card(*c)).unwrap_or(NOT_DEALT);
    let river = spot.board.get(4).map(|c| to_solver_card(*c)).unwrap_or(NOT_DEALT);

    let card_config = CardConfig {
        range: [build_range(&spot.oop), build_range(&spot.ip)],
        flop,
        turn,
        river,
    };

    let bet_sizes = bet_size_string(&spot.bet_fractions);
    let bet = BetSizeOptions::try_from((bet_sizes.as_str(), bet_sizes.as_str())).unwrap();

    let tree_config = TreeConfig {
        initial_state: board_state_for(&spot.board),
        starting_pot: spot.starting_pot,
        effective_stack: spot.effective_stack,
        rake_rate: 0.0,
        rake_cap: 0.0,
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

    // Pass 1 (unsolved tree is fully navigable): resolve each step to a concrete
    // tree action, recording its index, the committed totals, and the request-side
    // step JSON. We need the committed totals to set the exploitability target from
    // the INCLUSIVE pot, matching the glue's `req.pot_chips * frac`.
    let hero_player = if spot.hero_is_oop { 0 } else { 1 };
    let mut committed = [0i32; 2]; // [oop, ip]
    let mut steps_json: Vec<StepJson> = Vec::new();
    let mut chosen_idx: Vec<usize> = Vec::new();

    game.back_to_root();
    for step in &spot.path {
        let actions = game.available_actions();
        let (idx, actor, kind, to_chips) = match step {
            Step::Check { actor } => {
                let idx = actions.iter().position(|a| matches!(a, Action::Check)).expect("check available");
                (idx, *actor, "check".to_string(), None)
            }
            Step::Aggressive { actor, nth } => {
                let (idx, amt) = nth_aggressive(&actions, *nth);
                let kind = match &actions[idx] {
                    Action::Bet(_) => "bet",
                    Action::Raise(_) | Action::AllIn(_) => "raise",
                    _ => unreachable!(),
                };
                committed[*actor] = amt;
                (idx, *actor, kind.to_string(), Some(amt as f64))
            }
        };
        steps_json.push(StepJson { actor: if actor == 0 { "oop".into() } else { "ip".into() }, kind, to_chips });
        chosen_idx.push(idx);
        game.play(idx);
    }
    assert_eq!(game.current_player(), hero_player, "{}: path did not reach hero", spot.name);

    let hero_committed = committed[hero_player];
    let villain_committed = committed[1 - hero_player];
    let inclusive_pot = spot.starting_pot + committed[0] + committed[1];

    // Solve over the whole tree, then re-navigate by the indices resolved above.
    let target = (inclusive_pot as f64 * spot.target_exploitability_fraction) as f32;
    game.back_to_root();
    solve(&mut game, spot.max_iterations, target, false);

    game.back_to_root();
    for idx in &chosen_idx {
        game.play(*idx);
    }
    assert_eq!(game.current_player(), hero_player, "{}: solved path did not reach hero", spot.name);

    game.cache_normalized_weights();
    let cards = game.private_cards(hero_player).to_vec();
    let actions = game.available_actions();
    let strategy = game.strategy();
    let evs = game.expected_values_detail(hero_player);
    let num_hands = cards.len();

    let mut expected = Vec::with_capacity(num_hands);
    for h in 0..num_hands {
        let mut row = Vec::with_capacity(actions.len());
        for a in 0..actions.len() {
            let idx = a * num_hands + h;
            row.push(ActionJson {
                action_id: action_id_for(&actions[a]),
                frequency: strategy[idx],
                ev: to_bb(evs[idx] as f64),
            });
        }
        let (c1, c2) = cards[h];
        expected.push(ComboStrategyJson { hand: [c1 as u8, c2 as u8], actions: row });
    }

    // Build the request our WASM glue consumes from the resolved scenario.
    let to_combo = |hs: &[Holding]| -> Vec<ComboJson> {
        hs.iter().map(|h| ComboJson { hand: h.hand, weight: h.weight }).collect()
    };
    let (hero_range_json, villain_range_json) = if spot.hero_is_oop {
        (to_combo(&spot.oop), to_combo(&spot.ip))
    } else {
        (to_combo(&spot.ip), to_combo(&spot.oop))
    };

    let request = RequestJson {
        board: spot.board.clone(),
        hero_range: hero_range_json,
        villain_range: villain_range_json,
        pot_chips: inclusive_pot as f64,
        effective_stack_chips: (spot.effective_stack - hero_committed) as f64,
        big_blind_chips: spot.big_blind,
        to_call_chips: (villain_committed - hero_committed).max(0) as f64,
        hero_committed_this_street_chips: hero_committed as f64,
        villain_committed_this_street_chips: villain_committed as f64,
        street_action_path: steps_json,
        bet_fractions: spot.bet_fractions.clone(),
        hero_is_oop: spot.hero_is_oop,
        max_iterations: spot.max_iterations,
        target_exploitability_fraction: spot.target_exploitability_fraction,
    };

    SpotJson { name: spot.name.to_string(), request, expected }
}

fn spots() -> Vec<Spot> {
    // Small ranges + turn/river boards keep each solve sub-second. The board
    // As Kh 7d 2c is a turn; adding 9s makes the river.
    let turn = cards(&["As", "Kh", "7d", "2c"]);
    let river = cards(&["As", "Kh", "7d", "2c", "9s"]);
    let oop = vec![hand("Qh", "Qs"), hand("Jd", "Jh"), hand("9c", "9d")];
    let ip = vec![hand("Ac", "Qd"), hand("Ks", "Qc"), hand("Td", "9h"), hand("8h", "8s")];

    let base = |name, board: Vec<u8>, hero_is_oop, path| Spot {
        name,
        board,
        oop: oop.clone(),
        ip: ip.clone(),
        starting_pot: 600,
        effective_stack: 9700,
        big_blind: 100.0,
        bet_fractions: vec![0.5, 1.0],
        hero_is_oop,
        path,
        max_iterations: 256,
        target_exploitability_fraction: 0.002,
    };

    vec![
        base("turn: OOP first to act", turn.clone(), true, vec![]),
        base(
            "turn: OOP faces IP bet",
            turn.clone(),
            true,
            vec![Step::Check { actor: 0 }, Step::Aggressive { actor: 1, nth: 0 }],
        ),
        base(
            "turn: IP faces OOP bet",
            turn.clone(),
            false,
            vec![Step::Aggressive { actor: 0, nth: 0 }],
        ),
        base(
            "turn: OOP faces IP raise (bet-raise)",
            turn.clone(),
            true,
            vec![
                Step::Aggressive { actor: 0, nth: 0 },
                Step::Aggressive { actor: 1, nth: 0 },
            ],
        ),
        base("river: OOP first to act", river.clone(), true, vec![]),
        base(
            "river: IP faces OOP bet",
            river.clone(),
            false,
            vec![Step::Aggressive { actor: 0, nth: 0 }],
        ),
    ]
}

fn main() {
    let spots: Vec<SpotJson> = spots().iter().map(solve_spot).collect();
    let fixture = Fixture {
        tolerance: Tolerance { freq: 0.02, ev: 0.1 },
        spots,
    };
    println!("{}", serde_json::to_string_pretty(&fixture).unwrap());
}
