import { accuracy, avgEvLossPerHand, evLossMbbPerGame, type SessionStats } from '@gto/scoring'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-900/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-lg font-semibold text-slate-100">{value}</div>
    </div>
  )
}

export function SessionStatsView({ stats }: { stats: SessionStats }) {
  const o = stats.overall
  const positions = Object.entries(stats.byPosition)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Hands" value={`${stats.hands}`} />
        <Stat label="Decisions" value={`${o.decisions}`} />
        <Stat label="Accuracy" value={`${(accuracy(o) * 100).toFixed(0)}%`} />
        <Stat label="Mistakes" value={`${o.mistakes}`} />
        <Stat label="EV loss / hand" value={`${avgEvLossPerHand(stats).toFixed(2)}bb`} />
        <Stat label="mbb/g" value={`${evLossMbbPerGame(stats).toFixed(0)}`} />
      </div>

      {positions.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">By position</div>
          <div className="space-y-1">
            {positions.map(([pos, b]) => (
              <div key={pos} className="flex items-center justify-between rounded bg-slate-900/40 px-3 py-1 text-sm">
                <span className="font-semibold text-slate-200">{pos}</span>
                <span className="font-mono text-slate-400">
                  {b!.correct}/{b!.decisions} correct · {b!.evLossBb.toFixed(2)}bb lost
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
