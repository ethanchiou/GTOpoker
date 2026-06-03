'use client'

import { useEffect, useRef, useState } from 'react'
import { BOT_SPEEDS, usePlayStore } from '../lib/store'

export function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const settings = usePlayStore((s) => s.settings)
  const setSettings = usePlayStore((s) => s.setSettings)

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
        onClick={() => setOpen((o) => !o)}
      >
        ☰
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl shadow-black/40"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Settings</h2>

          <div className="mb-4">
            <div className="text-sm font-medium text-slate-200">Bot turn time</div>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">How long bots take to act. Instant removes the wait.</p>
            <div className="flex gap-1">
              {BOT_SPEEDS.map((speed) => {
                const active = settings.botTimeScale === speed.scale
                return (
                  <button
                    key={speed.label}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'border-amber-400 bg-amber-400 text-slate-950'
                        : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                    onClick={() => setSettings({ botTimeScale: speed.scale })}
                  >
                    {speed.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-200">Show full hand</div>
              <p className="mt-0.5 text-xs text-slate-500">
                When off, folding jumps straight to the GTO result instead of playing the hand out.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={settings.showFullHand}
              aria-label="Show full hand"
              onClick={() => setSettings({ showFullHand: !settings.showFullHand })}
              className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
                settings.showFullHand ? 'bg-amber-400' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  settings.showFullHand ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
