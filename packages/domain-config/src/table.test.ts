import { describe, expect, it } from 'vitest'
import { buttonIndexFor, NUM_SEATS_6MAX, positionFor, POSITIONS_6MAX } from './index'

describe('buttonIndexFor', () => {
  it('is the inverse of positionFor for the hero seat (seat 0)', () => {
    for (const position of POSITIONS_6MAX) {
      const button = buttonIndexFor(0, position)
      expect(positionFor(0, button)).toBe(position)
    }
  })

  it('round-trips for every seat / position pair', () => {
    for (let seat = 0; seat < NUM_SEATS_6MAX; seat++) {
      for (const position of POSITIONS_6MAX) {
        const button = buttonIndexFor(seat, position)
        expect(button).toBeGreaterThanOrEqual(0)
        expect(button).toBeLessThan(NUM_SEATS_6MAX)
        expect(positionFor(seat, button)).toBe(position)
      }
    }
  })
})
