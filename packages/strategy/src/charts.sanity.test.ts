import { describe, expect, it } from 'vitest'
import type { HandClass } from './hand-class'
import { compileSpot } from './preflop-chart'
import { parseRange } from './range'
import { SEED_CHART } from './seed-chart'
import type { ActionFrequency } from './types'

/**
 * Sanity guard against silently-folded holes — the bug class where a hand omitted
 * from *every* action range in a spot compiles to 100% fold (`compileSpot` fills
 * the remainder with fold). That is syntactically valid but strategically wrong:
 * it is indistinguishable from a deliberate fold, so the schema-validation test
 * cannot catch it.
 *
 * For each spot family we assert that hands which *must* continue under standard
 * 6-max 100bb norms have a non-zero continue (non-fold) frequency. The lists are
 * deliberately conservative — only hands that continue in the *tightest* spot of
 * each family — so a failure here means real data rot (an authoring omission), not
 * a debatable range edge. Tighten the data to match norms; do not loosen a list to
 * pass.
 */

const continueClasses = (range: string): HandClass[] => [...parseRange(range).keys()]

/** Sum of non-fold frequency in a compiled row. */
function continueFreq(row: ActionFrequency[] | undefined): number {
  if (!row) return 0
  return row.filter((a) => a.actionId !== 'fold').reduce((s, a) => s + a.frequency, 0)
}

/** Hands that are never a pure fold in any spot of the family (id prefix). */
const MUST_CONTINUE: { prefix: string; label: string; range: string }[] = [
  { prefix: 'rfi/', label: 'open (RFI)', range: 'TT+, AJs, AQs, AKs, AKo, AQo, KQs' },
  { prefix: 'vsRfi/', label: 'defend a single open', range: 'TT+, AJs, AQs, AKs, AKo, AQo, KQs' },
  { prefix: 'vs3bet/', label: 'continue facing a 3-bet', range: 'JJ+, AQs, AKs, AKo' },
  { prefix: 'vs4bet/', label: 'continue facing a 4-bet', range: 'KK+, AKs' },
  { prefix: 'vs5bet/', label: 'call a 5-bet jam', range: 'KK+' },
]

describe('preflop chart sanity — no silently-folded premium holes', () => {
  for (const { prefix, label, range } of MUST_CONTINUE) {
    const must = continueClasses(range)
    const spots = SEED_CHART.spots.filter((s) => s.id.startsWith(prefix))
    for (const spot of spots) {
      it(`${spot.id} keeps every premium that must ${label}`, () => {
        const compiled = compileSpot(spot)
        const folded = must.filter((cls) => continueFreq(compiled.grid[cls]) <= 0)
        expect(folded, `${spot.id} silently 100%-folds: ${folded.join(', ')}`).toEqual([])
      })
    }
  }
})
