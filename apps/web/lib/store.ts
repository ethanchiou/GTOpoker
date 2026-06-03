import { createRng, type SeededRng } from '@gto/hand-eval'
import {
  applyAction,
  createHand,
  decisionPoint,
  reconstructHandFromLink,
  type Action,
  type DecisionPoint,
  type HandLink,
  type HandState,
} from '@gto/poker-engine'
import { decideGtoAction, handClass, type NodeStrategy } from '@gto/strategy'
import { strategyProvider as provider } from './strategyProvider'
import { recordHandSimulated } from './analytics'
import { buildReplaySteps, type ReplayStep } from './replay'
import {
  createSessionStats,
  noteHandComplete,
  recordDecision,
  scoreFromStrategy,
  type DecisionScore,
  type SessionStats,
} from '@gto/scoring'
import { create } from 'zustand'

export interface Settings {
  /** Multiplier on bot think-time; 0 = instant (no per-action animation). */
  botTimeScale: number
  /** When true, folding plays the hand out; when false, it jumps to the result. */
  showFullHand: boolean
}

/** Bot turn-time presets surfaced in the settings menu (Instant = 0). */
export const BOT_SPEEDS = [
  { label: 'Instant', scale: 0 },
  { label: 'Fast', scale: 0.5 },
  { label: 'Normal', scale: 1 },
  { label: 'Slow', scale: 1.8 },
] as const

const DEFAULT_SETTINGS: Settings = { botTimeScale: 1, showFullHand: false }
const SETTINGS_KEY = 'gto-trainer-settings'

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: Settings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

// The strategy spine is constructed once in `lib/strategyProvider.ts` and shared
// with the Live Solver tab so both hold one provider + solve cache (spec §6.1).
const HERO_SEAT = 0
const NUM_SEATS = 6
const MAX_STEPS = 200 // safety bound on the bot-advance loop
const MAX_NEW_HAND_ATTEMPTS = 25
const INITIAL_BASE_SEED = createSessionSeed()

type ControllerList = ('human' | 'bot')[]
const CONTROLLERS: ControllerList = Array.from({ length: NUM_SEATS }, (_, i) =>
  i === HERO_SEAT ? 'human' : 'bot',
)

interface DriveResult {
  state: HandState
  decision: DecisionPoint | null
  strategy: NodeStrategy | null
}

function createSessionSeed(): string {
  return `gto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Human-like bot think time (ms) so bots don't all act in the same frame. Varies
 * with the spot — aggression and later streets take longer, with occasional snap
 * actions and tanks — drawn from a dedicated seeded RNG so it never perturbs the
 * action stream (`botRng`) the hands are reproduced from (replay reconstructs from
 * `history`, so timing is purely cosmetic).
 */
function botThinkMs(action: Action, dp: DecisionPoint, rng: SeededRng): number {
  let ms = 300 + rng.nextFloat() * 500 // 0.3–0.8s base
  if (action.type === 'raise' || action.type === 'bet') ms += 250 + rng.nextFloat() * 350 // sizing takes thought
  if (dp.street === 'turn') ms += 150
  if (dp.street === 'river') ms += 300
  const r = rng.nextFloat()
  if (r < 0.12) ms = 150 + rng.nextFloat() * 150 // snap
  else if (r > 0.9) ms += 700 + rng.nextFloat() * 900 // tank
  return Math.min(2600, Math.round(ms))
}

/**
 * Advance the hand: let bots act from the GTO strategy (preflop charts + the
 * heads-up postflop solver) until it is the hero's turn or the hand ends. The
 * hero is now trained on every street (spec §2.1, Phase 2): we stop at the
 * hero's decision on any street and surface the strategy for it. Heads-up-by-the
 * -flop spots are solved; multiway/unsupported postflop nodes return a null
 * strategy and are flagged in the UI rather than graded.
 */
/**
 * Optional animation hook: when provided, each bot acts after a human-like delay
 * and the intermediate state is pushed via `onStep` so bots are seen acting one
 * at a time. Omitted for the pre-hero deal (snappy) and only used for the bot
 * responses after the hero acts.
 */
interface DriveAnim {
  onStep: (state: HandState) => void
  rng: SeededRng
  /** Multiplier on each bot's think-time (from the bot-turn-time setting). */
  scale: number
}

async function drive(start: HandState, botRng: SeededRng, anim?: DriveAnim): Promise<DriveResult> {
  let state = start
  for (let i = 0; i < MAX_STEPS; i++) {
    if (state.phase === 'complete') return { state, decision: null, strategy: null }

    const dp = decisionPoint(state)
    if (!dp) return { state, decision: null, strategy: null }

    if (dp.seatIndex === HERO_SEAT) {
      const strategy = provider.supports(dp.nodeKey) ? await provider.getStrategy(dp.nodeKey) : null
      return { state, decision: dp, strategy }
    }

    const action = await decideGtoAction(dp, provider, botRng)
    if (anim) await sleep(botThinkMs(action, dp, anim.rng) * anim.scale)
    state = applyAction(state, action)
    anim?.onStep(state)
  }
  return { state, decision: null, strategy: null }
}

/** A hero GTO chart snapshot for one replay step, plus a friendly node label. */
export interface ReplayStrategy {
  strategy: NodeStrategy
  heroHand: string
  label: string
}

/** Friendly description of a hero decision node ("Turn · facing raise"). */
function describeNode(dp: DecisionPoint): string {
  const street = dp.street[0]!.toUpperCase() + dp.street.slice(1)
  if (dp.street === 'preflop') {
    const raises = dp.actionHistory.filter((r) => r.action.type === 'raise').length
    if (raises === 0) return `${street} · open`
    if (raises === 1) return `${street} · facing raise`
    return `${street} · facing ${raises + 1}-bet`
  }
  if (dp.toCallChips > 0) {
    const lastAgg = [...dp.actionHistory]
      .reverse()
      .find((r) => r.street === dp.street && (r.action.type === 'bet' || r.action.type === 'raise'))
    return `${street} · facing ${lastAgg?.action.type === 'raise' ? 'raise' : 'bet'}`
  }
  return `${street} · first to act`
}

/**
 * The hero GTO chart active at each replay step, carried forward from the most
 * recent hero decision so the chart visibly evolves (street to street, and when
 * the opponent raises) as the replay is scrubbed. Steps before the hero's first
 * decision reuse that first chart; unsupported (multiway) nodes keep the prior one.
 */
async function buildReplayStrategies(steps: ReplayStep[]): Promise<(ReplayStrategy | null)[]> {
  const perStep: (ReplayStrategy | null)[] = new Array(steps.length).fill(null)
  let current: ReplayStrategy | null = null
  for (let i = 0; i < steps.length; i++) {
    const dp = decisionPoint(steps[i]!.state)
    if (dp && dp.seatIndex === HERO_SEAT && provider.supports(dp.nodeKey)) {
      const strategy = await provider.getStrategy(dp.nodeKey)
      current = {
        strategy,
        heroHand: handClass(dp.heroHoleCards[0], dp.heroHoleCards[1]),
        label: describeNode(dp),
      }
    }
    perStep[i] = current
  }
  const firstIdx = perStep.findIndex((s) => s !== null)
  if (firstIdx > 0) for (let i = 0; i < firstIdx; i++) perStep[i] = perStep[firstIdx]!
  return perStep
}

/**
 * The hero's last decision in a link's action sequence, paired with the action
 * taken there — used to re-derive the GTO feedback for a shared finished hand.
 * The actions are already known legal (reconstruction succeeded), so the walk
 * never throws.
 */
function findLastHeroDecision(link: HandLink): { dp: DecisionPoint; action: Action } | null {
  let state = createHand({
    handId: link.seed,
    seed: link.seed,
    buttonIndex: link.buttonIndex,
    heroSeat: HERO_SEAT,
    controllers: CONTROLLERS,
  })
  let result: { dp: DecisionPoint; action: Action } | null = null
  for (const action of link.actions) {
    const dp = decisionPoint(state)
    if (dp && dp.seatIndex === HERO_SEAT) result = { dp, action }
    state = applyAction(state, action)
  }
  return result
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
  chartRevealed: boolean
  stats: SessionStats
  scenarioRng: SeededRng
  botRng: SeededRng
  /** Drives bot think-time only; kept separate so it never perturbs `botRng`. */
  timingRng: SeededRng
  /** User settings (bot turn time, show-full-hand); persisted to localStorage. */
  settings: Settings
  /** True when the hero's hand is resolved (complete, or folded out and skipped). */
  handDone: boolean
  busy: boolean
  /** Stepwise reconstruction of the current hand while the replayer is open (else null). */
  replaySteps: ReplayStep[] | null
  replayIndex: number
  /** Hero GTO chart per replay step (null while still being derived). */
  replayStrategies: (ReplayStrategy | null)[] | null
  newHand: () => Promise<void>
  /** Reconstruct and show a specific hand from a shared link (no session-stat side effects). */
  loadHandFromLink: (link: HandLink) => Promise<void>
  revealChart: () => void
  setSettings: (patch: Partial<Settings>) => void
  heroAct: (action: Action) => Promise<void>
  startReplay: () => void
  exitReplay: () => void
  replayGoto: (index: number) => void
  replayStep: (delta: number) => void
}

export const usePlayStore = create<PlayStore>((set, get) => ({
  baseSeed: INITIAL_BASE_SEED,
  handNumber: 0,
  buttonIndex: 0,
  state: null,
  decision: null,
  strategy: null,
  lastScore: null,
  reviewStrategy: null,
  reviewHand: null,
  chartRevealed: false,
  stats: createSessionStats(),
  scenarioRng: createRng(`${INITIAL_BASE_SEED}:scenarios`),
  botRng: createRng(`${INITIAL_BASE_SEED}:bots`),
  timingRng: createRng(`${INITIAL_BASE_SEED}:timing`),
  settings: loadSettings(),
  handDone: false,
  busy: false,
  replaySteps: null,
  replayIndex: 0,
  replayStrategies: null,

  async newHand() {
    let handNumber = get().handNumber
    const { baseSeed, scenarioRng, botRng } = get()
    let buttonIndex = get().buttonIndex
    let res: DriveResult | null = null

    set({
      busy: true,
      handDone: false,
      lastScore: null,
      reviewStrategy: null,
      reviewHand: null,
      chartRevealed: false,
      replaySteps: null,
      replayIndex: 0,
      replayStrategies: null,
    })

    for (let attempt = 0; attempt < MAX_NEW_HAND_ATTEMPTS; attempt++) {
      handNumber += 1
      buttonIndex = scenarioRng.nextInt(NUM_SEATS)
      const seed = `${baseSeed}-${handNumber}-${scenarioRng.nextU32().toString(36)}`
      const fresh = createHand({
        handId: seed,
        buttonIndex,
        heroSeat: HERO_SEAT,
        controllers: CONTROLLERS,
        seed,
      })
      const attemptResult = await drive(fresh, botRng)
      if (attemptResult.decision) {
        res = attemptResult
        break
      }
    }

    if (!res) {
      handNumber += 1
      buttonIndex = HERO_SEAT // Hero BTN guarantees a preflop decision after bots ahead act.
      const seed = `${baseSeed}-${handNumber}-${scenarioRng.nextU32().toString(36)}`
      res = await drive(
        createHand({
          handId: seed,
          buttonIndex,
          heroSeat: HERO_SEAT,
          controllers: CONTROLLERS,
          seed,
        }),
        botRng,
      )
    }

    set({
      handNumber,
      buttonIndex,
      state: res.state,
      decision: res.decision,
      strategy: res.strategy,
      busy: false,
    })

    recordHandSimulated('trainer')
  },

  async loadHandFromLink(link) {
    set({
      busy: true,
      handDone: false,
      lastScore: null,
      reviewStrategy: null,
      reviewHand: null,
      chartRevealed: false,
      replaySteps: null,
      replayIndex: 0,
      replayStrategies: null,
    })

    let state: HandState
    try {
      state = reconstructHandFromLink(link, { heroSeat: HERO_SEAT, controllers: CONTROLLERS })
    } catch {
      // Corrupt or stale link — fall back to a fresh hand.
      await get().newHand()
      return
    }

    const dp = decisionPoint(state)
    if (state.phase !== 'complete' && dp && dp.seatIndex === HERO_SEAT) {
      // A pending hero decision: present it as a fresh spot (chart hidden, no
      // feedback pre-filled for streets the recipient didn't play).
      const strategy = provider.supports(dp.nodeKey) ? await provider.getStrategy(dp.nodeKey) : null
      set({ state, decision: dp, strategy, handDone: false, busy: false })
      return
    }

    // A finished / folded-out hand: re-derive the last hero decision's GTO
    // feedback so the review matches live play — but never touch session stats,
    // since this is someone else's shared hand, not the viewer's own decision.
    let lastScore: DecisionScore | null = null
    let reviewStrategy: NodeStrategy | null = null
    let reviewHand: string | null = null
    const heroDecision = findLastHeroDecision(link)
    if (heroDecision && provider.supports(heroDecision.dp.nodeKey)) {
      reviewStrategy = await provider.getStrategy(heroDecision.dp.nodeKey)
      lastScore = scoreFromStrategy(heroDecision.action, heroDecision.dp, reviewStrategy)
      reviewHand = handClass(heroDecision.dp.heroHoleCards[0], heroDecision.dp.heroHoleCards[1])
    }
    set({ state, decision: null, strategy: null, handDone: true, lastScore, reviewStrategy, reviewHand, busy: false })
  },

  revealChart() {
    set({ chartRevealed: true })
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },

  async heroAct(action) {
    const { state, decision, strategy, stats, settings, timingRng } = get()
    if (!state || !decision || get().busy) return
    set({ busy: true, handDone: false })

    let lastScore: DecisionScore | null = get().lastScore
    let reviewStrategy = get().reviewStrategy
    let reviewHand = get().reviewHand
    if (strategy) {
      lastScore = scoreFromStrategy(action, decision, strategy)
      recordDecision(stats, lastScore, { street: decision.street, position: decision.position })
      reviewStrategy = strategy
      reviewHand = handClass(decision.heroHoleCards[0], decision.heroHoleCards[1])
    }

    const next = applyAction(state, action)

    // Folding ends the hero's involvement. With "Show full hand" off we skip the
    // bot playout and jump straight to the GTO result (no runout shown).
    if (action.type === 'fold' && !settings.showFullHand) {
      noteHandComplete(stats)
      set({
        state: next,
        decision: null,
        strategy: null,
        handDone: true,
        lastScore,
        reviewStrategy,
        reviewHand,
        chartRevealed: false,
        stats: { ...stats },
        busy: false,
      })
      return
    }

    // Animate bot responses one at a time unless the turn time is Instant (0).
    const anim = settings.botTimeScale > 0 ? { onStep: (s: HandState) => set({ state: s }), rng: timingRng, scale: settings.botTimeScale } : undefined
    const res = await drive(next, get().botRng, anim)
    if (res.state.phase === 'complete') noteHandComplete(stats)
    set({
      state: res.state,
      decision: res.decision,
      strategy: res.strategy,
      handDone: res.decision === null,
      lastScore,
      reviewStrategy,
      reviewHand,
      chartRevealed: false,
      stats: { ...stats },
      busy: false,
    })
  },

  startReplay() {
    const { state } = get()
    if (!state || state.history.length === 0) return
    const steps = buildReplaySteps(state, { heroSeat: HERO_SEAT, controllers: CONTROLLERS })
    set({ replaySteps: steps, replayIndex: 0, replayStrategies: null })
    // Derive each step's hero chart off the main thread; apply only if this same
    // replay is still open (guards against exit / a newly started replay).
    void buildReplayStrategies(steps).then((replayStrategies) => {
      if (get().replaySteps === steps) set({ replayStrategies })
    })
  },

  exitReplay() {
    set({ replaySteps: null, replayIndex: 0, replayStrategies: null })
  },

  replayGoto(index) {
    const { replaySteps } = get()
    if (!replaySteps) return
    set({ replayIndex: Math.max(0, Math.min(replaySteps.length - 1, index)) })
  },

  replayStep(delta) {
    get().replayGoto(get().replayIndex + delta)
  },
}))

export { HERO_SEAT, NUM_SEATS }
