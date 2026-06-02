import { rankOf, suitOf, type Card } from '@gto/hand-eval'

const SUIT_SYMBOL = ['♣', '♦', '♥', '♠']
const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']

export interface CardFace {
  rank: string
  suit: string
  red: boolean
}

export function cardFace(card: Card): CardFace {
  const suit = suitOf(card)
  return { rank: RANK_LABEL[rankOf(card)]!, suit: SUIT_SYMBOL[suit]!, red: suit === 1 || suit === 2 }
}

/** Chips → big blinds, trimmed (e.g. 250/100 → "2.5"). */
export function bb(chips: number, bigBlindChips: number): string {
  const v = chips / bigBlindChips
  return Number.isInteger(v) ? `${v}` : v.toFixed(1)
}

const ACTION_LABELS: Record<string, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
}

/** Human label for a chart action id ('raiseTo:2.5' → 'Raise 2.5bb'). */
export function actionLabel(actionId: string): string {
  if (ACTION_LABELS[actionId]) return ACTION_LABELS[actionId]!
  const m = /^raiseTo:([\d.]+)$/.exec(actionId)
  if (m) return `Raise ${m[1]}bb`
  return actionId
}

/** Color for an action id, used by the strategy heatmap and legend. */
export function actionColor(actionId: string): string {
  if (actionId === 'fold') return '#64748b' // slate
  if (actionId === 'call') return '#22c55e' // green
  if (actionId === 'check') return '#14b8a6' // teal
  if (actionId.startsWith('raiseTo:')) return '#ef4444' // red
  return '#a855f7'
}

const CLASS_STYLE: Record<string, { label: string; color: string }> = {
  best: { label: 'Best', color: '#22c55e' },
  correct: { label: 'Correct', color: '#84cc16' },
  inaccuracy: { label: 'Inaccuracy', color: '#eab308' },
  wrong: { label: 'Wrong', color: '#f97316' },
  blunder: { label: 'Blunder', color: '#ef4444' },
}

export function classificationStyle(c: string): { label: string; color: string } {
  return CLASS_STYLE[c] ?? { label: c, color: '#94a3b8' }
}
