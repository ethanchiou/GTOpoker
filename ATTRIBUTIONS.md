# Attributions & Third-Party Licenses

This project embeds and builds on open-source work. Licenses are tracked here; update when adding
dependencies.

## Planned / embedded components

| Component | Use | License | Notes |
|---|---|---|---|
| [postflop-solver](https://github.com/b-inary/postflop-solver) | Heads-up postflop CFR solver (Phase 2, → WASM) | **AGPL-3.0** | Network-copyleft; acceptable for this open-source project. |
| [WASM Postflop](https://github.com/b-inary/wasm-postflop) | Reference for embedding the solver in the browser | AGPL-3.0 | Architectural reference. |
| Hand evaluator (TBD: [poker-evaluator](https://www.npmjs.com/package/poker-evaluator) / [PokerHandEvaluator-WASM](https://github.com/WenheLI/PokerHandEvaluator-wasm)) | 7-card eval + equity | ISC / Apache-2.0 | Permissive. |
| Preflop range charts (seed data) | Preflop GTO frequencies (MVP) | Per source terms | Free published charts; attribute source, tag rake/version, no redistribution of licensed data. |

## AGPL-3.0 note

Because postflop-solver is AGPL-3.0, any hosted/networked deployment that includes it must make its
corresponding source available to users. This repository is open-source, so that obligation is met
by publishing this repo. If the project ever needs a closed/commercial deployment, swap the postflop
core for a permissively-licensed solver (rs-poker — Apache-2.0; RoboPoker — MIT) or obtain a
commercial license.
