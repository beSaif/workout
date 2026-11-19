"use client"

import { useState } from "react"
import { CycleLength } from "@/lib/types"
import { loadStep } from "@/lib/prescription"
import type { CycleSetup } from "@/lib/layoff"
import CycleSetupFields from "@/components/CycleSetupFields"
import EscapeKey from "@/components/EscapeKey"

interface RestartCycleSheetProps {
  /** Lift name for the copy, e.g. "Bench". */
  liftShort: string
  /** What the cycle runs at now, which the pickers start from. */
  current: CycleSetup
  /** Sessions logged this cycle, which stop counting towards the plan. */
  sessionsLogged: number
  onRestart: (setup: CycleSetup) => void
  onClose: () => void
}

/** Sends the current cycle back to Volume session 1, set up again from scratch. */
export default function RestartCycleSheet({ liftShort, current, sessionsLogged, onRestart, onClose }: RestartCycleSheetProps) {
  const [peak, setPeak] = useState(current.anchor)
  const [perWeek, setPerWeek] = useState(Math.min(6, Math.max(2, Math.round(current.sessionsPerWeek))))
  const [length, setLength] = useState<CycleLength>(current.cycleLength)

  const logged =
    sessionsLogged === 0
      ? "Nothing logged this cycle is lost."
      : `The ${sessionsLogged === 1 ? "session" : `${sessionsLogged} sessions`} you logged this cycle stay in history, but stop moving the plan.`

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <EscapeKey onEscape={onClose} />
      <div className="bg-raised w-full max-w-[393px] rounded-t-2xl max-h-[92dvh] overflow-y-auto">
        <div className="px-6 pt-6">
          <div className="flex items-start justify-between">
            <p className="text-2xl font-bold text-ink tracking-tight">Restart cycle</p>
            <button onClick={onClose} aria-label="Close" className="text-ink-6 mt-1 -mr-1 p-1 active:opacity-70">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <path d="M1.41 0L0 1.41 5.59 7 0 12.59 1.41 14 7 8.41 12.59 14 14 12.59 8.41 7 14 1.41 12.59 0 7 5.59 1.41 0z" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-ink-5 mt-1">
            Back to Volume session 1, starting on a heavy day. {logged}
          </p>

          <p className="text-sm text-ink-4 mt-5">What do you want to peak at?</p>
          <CycleSetupFields
            liftShort={liftShort}
            peak={peak}
            onPeak={setPeak}
            minPeak={loadStep(current.anchor)}
            perWeek={perWeek}
            onPerWeek={setPerWeek}
            length={length}
            onLength={setLength}
          />
        </div>

        <div className="px-6 pt-5 pb-10">
          <button
            onClick={() => onRestart({ anchor: peak, sessionsPerWeek: perWeek, cycleLength: length })}
            className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 active:bg-brand-fill-3 transition-colors"
          >
            Restart cycle · peak {peak}kg
          </button>
          <button onClick={onClose} className="w-full text-sm text-ink-5 py-3 mt-1 active:opacity-70">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
