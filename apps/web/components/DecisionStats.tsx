import type { Position } from '@gto/domain-config'
import { createRng } from '@gto/hand-eval'
import type { DecisionPoint } from '@gto/poker-engine'
import {
  equityVsRange,
  potOddsPct,
  villainContinuingRange,
  type ActionFrequency,
} from '@gto/strategy'
import { useEffect, useState } from 'react'
import { strategyProvider } from '../lib/strategyProvider'
import { StatStrip, type Stat } from './StatStrip'

interface EquityState {
  equity: number | null
  villain: Position | null
}

/** Best (highest-EV) action's EV, when the node carries per-action EV (solver). */
function headlineEv(row: ActionFrequency[] | null): number | null {
  if (!row) return null
  const withEv = row.filter((a) => a.ev !== undefined)
  if (withEv.length === 0) return null
  return Math.max(...withEv.map((a) => a.ev!))
}

/**
 * Compact pot-odds / win-chance / EV strip for the hero's current decision, shown
 * near the action controls. Pot odds and EV are arithmetic from the node; the win
 * chance is a Monte-Carlo of the hero hand vs the villain's continuing range
 * (shared with the Live Solver tab). Postflop uses the live board; preflop the
 * facing opener/3-bettor charted range.
 */
export function DecisionStats({
  decision,
  strategyRow,
}: {
  decision: DecisionPoint
  strategyRow: ActionFrequency[] | null
}) {
  const [eq, setEq] = useState<EquityState>({ equity: null, villain: null })

  // Re-run when the decision identity changes (hand / street / action faced).
  const key = `${decision.handId}:${decision.street}:${decision.actionHistory.length}:${decision.toCallChips}`
  useEffect(() => {
    let cancelled = false
    setEq({ equity: null, villain: null })
    void (async () => {
      const { villain, range } = await villainContinuingRange(decision.nodeKey, strategyProvider)
      let equity: number | null = null
      if (range.length > 0) {
        const [c0, c1] = decision.heroHoleCards
        const rng = createRng(`dec:${key}:${c0}:${c1}`)
        const board = [...decision.board]
        const iterations = board.length >= 3 ? 6_000 : 12_000
        equity = equityVsRange([c0, c1], range, board, { iterations, rng })?.equity ?? null
      }
      if (!cancelled) setEq({ equity, villain })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const potOdds = potOddsPct(decision.toCallChips, decision.potChips)
  const ev = headlineEv(strategyRow)

  const stats: Stat[] = [
    {
      label: 'Pot odds',
      value: potOdds != null ? `${(potOdds * 100).toFixed(0)}%` : '—',
      hint: potOdds != null ? 'equity to call' : 'nothing to call',
    },
    {
      label: 'Win chance',
      value: eq.equity != null ? `${(eq.equity * 100).toFixed(0)}%` : '—',
      hint: eq.villain ? `vs ${eq.villain} range` : 'no single villain',
      tone: 'green',
    },
    {
      label: 'GTO EV',
      value: ev != null ? `${ev >= 0 ? '+' : ''}${ev.toFixed(2)}bb` : '—',
      hint: ev != null ? 'best action' : 'solver only',
    },
  ]

  return <StatStrip stats={stats} />
}
