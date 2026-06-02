/**
 * EV-loss thresholds (in big blinds) for classifying a decision (spec §7.1, §13).
 * Tunable without touching engine code.
 */
export interface ScoringThresholds {
  /** ≤ this EV loss and the action is still "Correct" (part of the mix). */
  correctBb: number
  /** ≤ this EV loss is an "Inaccuracy". */
  inaccuracyBb: number
  /** ≤ this EV loss is "Wrong"; above it is a "Blunder". */
  wrongBb: number
}

export const DEFAULT_SCORING_THRESHOLDS: ScoringThresholds = {
  correctBb: 0.1,
  inaccuracyBb: 0.5,
  wrongBb: 2,
}
