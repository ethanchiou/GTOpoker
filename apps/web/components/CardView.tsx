import type { Card } from '@gto/hand-eval'
import { cardFace } from '../lib/format'

const SIZES = {
  sm: 'h-9 w-7 text-sm',
  md: 'h-14 w-10 text-lg',
} as const

export function CardView({
  card,
  hidden,
  size = 'md',
}: {
  card?: Card
  hidden?: boolean
  size?: keyof typeof SIZES
}) {
  if (hidden || card === undefined) {
    return (
      <div
        className={`${SIZES[size]} rounded-md border border-slate-700 bg-gradient-to-br from-indigo-900 to-slate-800 shadow`}
        aria-label="hidden card"
      />
    )
  }
  const f = cardFace(card)
  return (
    <div
      className={`${SIZES[size]} flex flex-col items-center justify-center rounded-md border border-slate-300 bg-white font-semibold leading-none shadow ${
        f.red ? 'text-red-600' : 'text-slate-900'
      }`}
      aria-label={`${f.rank}${f.suit}`}
    >
      <span>{f.rank}</span>
      <span>{f.suit}</span>
    </div>
  )
}
