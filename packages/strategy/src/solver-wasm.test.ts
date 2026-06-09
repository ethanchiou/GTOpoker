import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BaselineSolverTransport } from './baseline-transport'
import type { ComboStrategy, SolveRequest, SolveResult } from './postflop-types'

/**
 * Task 5 — solver correctness validation (spec §15 Phase 2), the WASM half.
 *
 * Part A: our WASM glue vs the crate-native reference. The reference harness
 *   (`packages/solver-worker/reference`) builds each spot from its TRUE
 *   street-start pot/stack via postflop-solver's native API; here we feed the
 *   equivalent `SolveRequest` through our glue (which DERIVES those values) and
 *   assert agreement. Divergence ⇒ a glue bug (pot/stack reconstruction, range
 *   encoding, replay/snap, or EV read). Subsumes the per-node weight-normalization
 *   regression: a wrong normalization shifts EVs off the reference.
 * Part C: baseline-vs-exact drift — a monitor (logged), with structural sanity.
 * Part D: determinism — the same request solved twice is identical.
 *
 * Runs ONLY when the nodejs WASM build exists at
 * `packages/solver-worker/pkg-node/` (the new CI WASM job builds it; absent in the
 * default `pnpm run check`, so this whole file skips there).
 */

const require = createRequire(import.meta.url)
const HERE = fileURLToPath(new URL('.', import.meta.url))
const WASM_PATH = `${HERE}../../solver-worker/pkg-node/gto_solver_wasm.js`
const FIXTURE_PATH = `${HERE}../../solver-worker/validation/reference-spots.json`

type WasmSolve = (json: string) => string
let wasmSolve: WasmSolve | null = null
try {
  wasmSolve = (require(WASM_PATH) as { solve: WasmSolve }).solve
} catch {
  wasmSolve = null
}

interface ExpectedAction {
  actionId: string
  frequency: number
  ev: number
}
interface FixtureSpot {
  name: string
  request: SolveRequest
  expected: { hand: [number, number]; actions: ExpectedAction[] }[]
}
interface Fixture {
  tolerance: { freq: number; ev: number }
  spots: FixtureSpot[]
}

const fixture: Fixture = wasmSolve ? (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture) : { tolerance: { freq: 0, ev: 0 }, spots: [] }

const comboKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

/** Action categories that are comparable across engines (exact labels raises in chips, baseline in bb). */
function category(actionId: string): 'fold' | 'check' | 'call' | 'aggro' {
  if (actionId === 'fold') return 'fold'
  if (actionId === 'check') return 'check'
  if (actionId === 'call') return 'call'
  return 'aggro'
}

function categoryFreqs(actions: { actionId: string; frequency: number }[]): Record<string, number> {
  const out: Record<string, number> = { fold: 0, check: 0, call: 0, aggro: 0 }
  for (const a of actions) out[category(a.actionId)]! += a.frequency
  return out
}

describe.skipIf(!wasmSolve)('solver WASM validation (task 5)', () => {
  it('loaded the reference fixture', () => {
    expect(fixture.spots.length).toBeGreaterThan(0)
  })

  describe('Part A — our glue matches the crate-native reference', () => {
    it.each(fixture.spots.map((s) => [s.name, s] as const))('%s', (_name, spot) => {
      const out = JSON.parse(wasmSolve!(JSON.stringify(spot.request))) as SolveResult & { error?: string }
      expect(out.error).toBeUndefined()

      const ours = new Map(out.hero.map((c) => [comboKey(c.hand[0], c.hand[1]), c.actions]))
      expect(ours.size).toBe(spot.expected.length)

      for (const exp of spot.expected) {
        const key = comboKey(exp.hand[0], exp.hand[1])
        const got = ours.get(key)
        expect(got, `combo ${key} present`).toBeDefined()
        const byId = new Map(got!.map((a) => [a.actionId, a]))
        for (const ea of exp.actions) {
          const ga = byId.get(ea.actionId)
          expect(ga, `combo ${key} action ${ea.actionId} present`).toBeDefined()
          expect(Math.abs(ga!.frequency - ea.frequency), `freq ${key} ${ea.actionId}`).toBeLessThanOrEqual(
            fixture.tolerance.freq,
          )
          const evTol = Math.max(fixture.tolerance.ev, Math.abs(ea.ev) * 0.02)
          expect(Math.abs((ga!.ev ?? 0) - ea.ev), `ev ${key} ${ea.actionId}`).toBeLessThanOrEqual(evTol)
        }
      }
    })
  })

  describe('Part C — baseline-vs-exact drift (monitor + sanity)', () => {
    const baseline = new BaselineSolverTransport({ iterations: 200 })

    it.each(fixture.spots.map((s) => [s.name, s] as const))('%s', async (name, spot) => {
      const exact = JSON.parse(wasmSolve!(JSON.stringify(spot.request))) as SolveResult
      const base = await baseline.solve(spot.request)

      const exactByKey = new Map(exact.hero.map((c) => [comboKey(c.hand[0], c.hand[1]), c.actions]))
      const facing = (spot.request.toCallChips ?? 0) > 0

      let sumAbs = 0
      let maxAbs = 0
      let n = 0
      for (const bc of base.hero) {
        const key = comboKey(bc.hand[0], bc.hand[1])
        const ex = exactByKey.get(key)
        if (!ex) continue

        // Sanity: baseline is a valid distribution with the right action shape.
        const total = bc.actions.reduce((s, a) => s + a.frequency, 0)
        expect(total, `${name} ${key} baseline sums to 1`).toBeCloseTo(1, 2)
        for (const a of bc.actions) expect(Number.isFinite(a.frequency)).toBe(true)
        const cats = bc.actions.map((a) => category(a.actionId))
        if (facing) {
          expect(cats).toContain('fold')
          expect(cats).toContain('call')
        } else {
          expect(cats).toContain('check')
        }

        const cb = categoryFreqs(bc.actions)
        const ce = categoryFreqs(ex)
        for (const cat of ['fold', 'check', 'call', 'aggro']) {
          const d = Math.abs(cb[cat]! - ce[cat]!)
          sumAbs += d
          maxAbs = Math.max(maxAbs, d)
          n++
        }
      }
      const meanDelta = n > 0 ? sumAbs / n : 0
      // eslint-disable-next-line no-console
      console.log(`drift ${name}: mean |Δcategory|=${meanDelta.toFixed(3)} max=${maxAbs.toFixed(3)}`)
      // Catastrophe guard only — baseline is a known approximation, so the bound is
      // generous; the point is the logged number, not a tight equality.
      expect(meanDelta).toBeLessThan(0.75)
    })
  })

  describe('Part D — determinism (guards per-node normalization reads)', () => {
    it('solves the same request to identical output twice', () => {
      const spot = fixture.spots.find((s) => (s.request.toCallChips ?? 0) > 0) ?? fixture.spots[0]!
      const a = JSON.parse(wasmSolve!(JSON.stringify(spot.request))) as SolveResult
      const b = JSON.parse(wasmSolve!(JSON.stringify(spot.request))) as SolveResult
      const norm = (r: SolveResult) =>
        r.hero
          .map((c: ComboStrategy) => `${c.hand}|${c.actions.map((x) => `${x.actionId}:${x.frequency}:${x.ev}`).join(',')}`)
          .sort()
      expect(norm(a)).toEqual(norm(b))
      // Every EV finite (a normalization miss would surface as NaN/inf here).
      for (const c of a.hero) for (const x of c.actions) expect(Number.isFinite(x.ev)).toBe(true)
    })
  })

  describe('Part E — graceful degradation over the memory budget', () => {
    // A tree exceeding wasm-addressable memory must NOT panic/trap the worker
    // (which would surface as a console error and risk poisoning the instance).
    // The solver pre-checks `memory_usage()` and returns a typed error instead, so
    // the routing transport falls back to the baseline.
    it('returns a typed error instead of trapping when over budget', () => {
      const spot = fixture.spots[0]!
      const out = JSON.parse(wasmSolve!(JSON.stringify({ ...spot.request, maxSolveBytes: 1 }))) as {
        error?: string
        hero?: unknown
      }
      expect(out.error, 'an over-budget solve returns an error string').toBeDefined()
      expect(out.error).toMatch(/budget|too large|memory/i)
      expect(out.hero).toBeUndefined()
    })

    it('still solves normally after an over-budget decline (no poisoned instance)', () => {
      const spot = fixture.spots[0]!
      JSON.parse(wasmSolve!(JSON.stringify({ ...spot.request, maxSolveBytes: 1 }))) // decline
      const out = JSON.parse(wasmSolve!(JSON.stringify(spot.request))) as SolveResult & { error?: string }
      expect(out.error).toBeUndefined()
      expect(out.hero.length).toBe(spot.expected.length)
    })

    it('declines a wide flop (too large to even build) instead of trapping', () => {
      // The QA-class case: full-ish ranges on a flop exceed the crate's tree-node
      // and memory caps. Before the fix this `unwrap()`-panicked and trapped the
      // worker; now it returns a typed error → baseline.
      const board = [48, 46, 21] // As Kh 7d (flop)
      const dead = new Set(board)
      const combos: { hand: [number, number]; weight: number }[] = []
      for (let a = 0; a < 52 && combos.length < 1000; a++) {
        if (dead.has(a)) continue
        for (let b = a + 1; b < 52 && combos.length < 1000; b++) {
          if (dead.has(b)) continue
          combos.push({ hand: [a, b], weight: 1 })
        }
      }
      const wide = {
        board,
        heroRange: combos,
        villainRange: combos,
        potChips: 600,
        effectiveStackChips: 9700,
        bigBlindChips: 100,
        toCallChips: 0,
        betFractions: [0.33, 0.75, 1.5],
        heroIsOop: true,
        maxIterations: 40,
        targetExploitabilityFraction: 0.03,
      }
      const out = JSON.parse(wasmSolve!(JSON.stringify(wide))) as { error?: string; hero?: unknown }
      expect(out.error, 'a too-large flop returns an error string').toBeDefined()
      expect(out.error).toMatch(/too large|too many|budget|baseline/i)
      expect(out.hero).toBeUndefined()
    })
  })
})
