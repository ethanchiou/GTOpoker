import { describe, expect, it } from 'vitest'
import type { Classification, DecisionScore } from './score'
import {
  accuracy,
  avgEvLossPerHand,
  createSessionStats,
  evLossMbbPerGame,
  noteHandComplete,
  recordDecision,
} from './session'

const score = (classification: Classification, evLossBb: number): DecisionScore => ({
  chosenActionId: 'x',
  bestActionId: 'x',
  classification,
  evLossBb,
  frequencyCredit: classification === 'best' ? 1 : 0,
  estimated: false,
  confidence: 'low',
  sizeSnapped: false,
  strategyRow: [],
})

describe('SessionStats', () => {
  it('aggregates by street, position, and classification', () => {
    const stats = createSessionStats()
    recordDecision(stats, score('best', 0), { street: 'preflop', position: 'BTN' })
    recordDecision(stats, score('correct', 0), { street: 'preflop', position: 'CO' })
    recordDecision(stats, score('blunder', 3), { street: 'preflop', position: 'BTN' })
    noteHandComplete(stats)

    expect(stats.overall.decisions).toBe(3)
    expect(stats.overall.correct).toBe(2)
    expect(stats.overall.mistakes).toBe(1)
    expect(stats.overall.evLossBb).toBe(3)
    expect(stats.byPosition.BTN).toMatchObject({ decisions: 2, correct: 1, mistakes: 1 })
    expect(stats.byStreet.preflop?.decisions).toBe(3)
    expect(stats.byClassification.best).toBe(1)
    expect(stats.byClassification.blunder).toBe(1)
  })

  it('derives accuracy, per-hand EV loss, and mbb/g', () => {
    const stats = createSessionStats()
    recordDecision(stats, score('best', 0), { street: 'preflop', position: 'BTN' })
    recordDecision(stats, score('wrong', 2), { street: 'preflop', position: 'BTN' })
    noteHandComplete(stats)

    expect(accuracy(stats.overall)).toBe(0.5)
    expect(avgEvLossPerHand(stats)).toBe(2) // 2bb lost over 1 hand
    expect(evLossMbbPerGame(stats)).toBe(2000)
  })

  it('reports zero for empty stats without dividing by zero', () => {
    const stats = createSessionStats()
    expect(accuracy(stats.overall)).toBe(0)
    expect(avgEvLossPerHand(stats)).toBe(0)
  })
})
