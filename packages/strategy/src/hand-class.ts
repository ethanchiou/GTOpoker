import { rankOf, suitOf, type Card } from '@gto/hand-eval'

/**
 * A 169-element hand class: a pocket pair ('AA'), suited ('AKs'), or offsuit
 * ('AKo') combo, ignoring specific suits (spec §6.3). Charts are authored at
 * this granularity; specific combos map to their class for lookup.
 */
export type HandClass = string

/** Rank characters in descending order, for grid labels and parsing. */
export const RANKS_DESC = 'AKQJT98765432'
/** Rank characters in ascending order (index 0 = '2'), matching hand-eval. */
export const RANKS_ASC = '23456789TJQKA'

export function rankIndex(ch: string): number {
  const i = RANKS_ASC.indexOf(ch)
  if (i < 0) throw new Error(`Invalid rank char: "${ch}"`)
  return i
}

function classFor(hiIdx: number, loIdx: number, suited: boolean): HandClass {
  const hi = RANKS_ASC[hiIdx]!
  const lo = RANKS_ASC[loIdx]!
  if (hiIdx === loIdx) return `${hi}${lo}`
  return `${hi}${lo}${suited ? 's' : 'o'}`
}

/** The hand class of two concrete cards. */
export function handClass(a: Card, b: Card): HandClass {
  let hi = rankOf(a)
  let lo = rankOf(b)
  let hiSuit = suitOf(a)
  let loSuit = suitOf(b)
  if (hi < lo) {
    ;[hi, lo] = [lo, hi]
    ;[hiSuit, loSuit] = [loSuit, hiSuit]
  }
  return classFor(hi, lo, hiSuit === loSuit)
}

export { classFor }

/**
 * The 13×13 grid of hand classes for heatmap rendering. `grid[row][col]` with
 * row/col 0 = Ace, descending. Pairs lie on the diagonal, suited above it,
 * offsuit below it (the standard solver layout).
 */
export const HAND_CLASS_GRID: HandClass[][] = (() => {
  const grid: HandClass[][] = []
  for (let row = 0; row < 13; row++) {
    const rowRank = 12 - row
    const cells: HandClass[] = []
    for (let col = 0; col < 13; col++) {
      const colRank = 12 - col
      if (rowRank === colRank) cells.push(classFor(rowRank, rowRank, false))
      else if (rowRank > colRank) cells.push(classFor(rowRank, colRank, true)) // upper triangle = suited
      else cells.push(classFor(colRank, rowRank, false)) // lower triangle = offsuit
    }
    grid.push(cells)
  }
  return grid
})()

/** All 169 hand classes (flattened grid order). */
export const ALL_HAND_CLASSES: HandClass[] = HAND_CLASS_GRID.flat()

/** Number of concrete combos a class represents: pair=6, suited=4, offsuit=12. */
export function comboCount(handClass: HandClass): number {
  if (handClass.length === 2) return 6
  return handClass.endsWith('s') ? 4 : 12
}
