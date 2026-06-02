import { createRng, type SeededRng } from '@gto/hand-eval'
import {
  applyAction,
  createHand,
  decisionPoint,
  runToShowdown,
  type Action,
  type DecisionPoint,
  type HandState,
} from '@gto/poker-engine'
import {
  decideGtoAction,
  handClass,
  PreflopChartProvider,
  SEED_CHART,
  type NodeStrategy,
} from '@gto/strategy'
import {
  createSessionStats,
  noteHandComplete,
  recordDecision,
  scoreFromStrategy,
  type DecisionScore,
  type SessionStats,
} from '@gto/scoring'
import { create } from 'zustand'

const provider = new PreflopChartProvider(SEED_CHART)
const HERO_SEAT = 0
const NUM_SEATS = 6
const MAX_STEPS = 200 // safety bound on the bot-advance loop

type ControllerList = ('human' | 'bot')[]
const CONTROLLERS: ControllerList = Array.from({ length: NUM_SEATS }, (_, i) =>
  i === HERO_SEAT ? 'human' : 'bot',
)

interface DriveResult {
  state: HandState
  decision: DecisionPoint | null
  strategy: NodeStrategy | null
}

/**
 * Advance the hand: let bots act from the GTO strategy until it is the hero's
 * preflop turn or the hand ends. Postflop is not trained in the MVP, so once
 * preflop closes the hand is run out to showdown (spec §2.2).
 */
async function drive(start: HandState, botRng: SeededRng): Promise<DriveResult> {
  let state = start
  for (let i = 0; i < MAX_STEPS; i++) {
    if (state.phase === 'complete') return { state, decision: null, strategy: null }

    // Preflop closed but the hand continues → run out (no postflop training yet).
    if (state.street !== 'preflop') {
      return { state: runToShowdown(state), decision: null, strategy: null }
    }

    const dp = decisionPoint(state)
    if (!dp) return { state, decision: null, strategy: null }

    if (dp.seatIndex === HERO_SEAT) {
      const strategy = provider.supports(dp.nodeKey) ? await provider.getStrategy(dp.nodeKey) : null
      return { state, decision: dp, strategy }
    }

    state = applyAction(state, await decideGtoAction(dp, provider, botRng))
  }
  return { state, decision: null, strategy: null }
}

export interface PlayStore {
  baseSeed: string
  handNumber: number
  buttonIndex: number
  state: HandState | null
  decision: DecisionPoint | null
  strategy: NodeStrategy | null
  lastScore: DecisionScore | null
  /** The hero's most recent scored spot, kept for post-hand review. */
  reviewStrategy: NodeStrategy | null
  reviewHand: string | null
  stats: SessionStats
  botRng: SeededRng
  busy: boolean
  newHand: () => Promise<void>
  heroAct: (action: Action) => Promise<void>
}

export const usePlayStore = create<PlayStore>((set, get) => ({
  baseSeed: 'gto',
  handNumber: 0,
  buttonIndex: 0,
  state: null,
  decision: null,
  strategy: null,
  lastScore: null,
  reviewStrategy: null,
  reviewHand: null,
  stats: createSessionStats(),
  botRng: createRng('gto:bots'),
  busy: false,

  async newHand() {
    const handNumber = get().handNumber + 1
    const buttonIndex = handNumber % NUM_SEATS
    const seed = `${get().baseSeed}-${handNumber}`
    set({ busy: true, lastScore: null, reviewStrategy: null, reviewHand: null })
    const fresh = createHand({
      handId: seed,
      buttonIndex,
      heroSeat: HERO_SEAT,
      controllers: CONTROLLERS,
      seed,
    })
    const res = await drive(fresh, get().botRng)
    const stats = get().stats
    if (res.state.phase === 'complete') noteHandComplete(stats)
    set({
      handNumber,
      buttonIndex,
      state: res.state,
      decision: res.decision,
      strategy: res.strategy,
      stats: { ...stats },
      busy: false,
    })
  },

  async heroAct(action) {
    const { state, decision, strategy, stats } = get()
    if (!state || !decision || get().busy) return
    set({ busy: true })

    let lastScore: DecisionScore | null = get().lastScore
    let reviewStrategy = get().reviewStrategy
    let reviewHand = get().reviewHand
    if (strategy) {
      lastScore = scoreFromStrategy(action, decision, strategy)
      recordDecision(stats, lastScore, { street: decision.street, position: decision.position })
      reviewStrategy = strategy
      reviewHand = handClass(decision.heroHoleCards[0], decision.heroHoleCards[1])
    }

    const res = await drive(applyAction(state, action), get().botRng)
    if (res.state.phase === 'complete') noteHandComplete(stats)
    set({
      state: res.state,
      decision: res.decision,
      strategy: res.strategy,
      lastScore,
      reviewStrategy,
      reviewHand,
      stats: { ...stats },
      busy: false,
    })
  },
}))

export { HERO_SEAT, NUM_SEATS }
