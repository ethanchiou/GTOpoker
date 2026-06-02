import { describe, expect, it } from 'vitest'
import { NUM_SEATS_6MAX, POSITIONS_6MAX } from './index'

describe('positions', () => {
  it('has six positions in preflop action order', () => {
    expect(POSITIONS_6MAX).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'])
    expect(POSITIONS_6MAX).toHaveLength(NUM_SEATS_6MAX)
  })
})
