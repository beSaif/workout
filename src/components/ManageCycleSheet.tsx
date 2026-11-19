"use client"

import { ReactNode } from "react"
import EscapeKey from "@/components/EscapeKey"

interface ManageCycleSheetProps {
  /** The peak the pill shows: this cycle's, or by the deload the next one's. */
  peak: number
  /** In a deload the peak already belongs to the next cycle. */
  nextCycle: boolean
  onChangePeak: () => void
  /** Opens the report of the last cycle that finished, e.g. "Cycle 2". Absent before the first one. */
  lastReport?: { label: string; open: () => void }
  /** Opens the restart sheet. Absent when the cycle has nothing to restart. */
  onRestart?: () => void
  onClose: () => void
}

/**
 * What can be done to the current cycle, behind the peak pill: change the peak, look back
 * at the last cycle's report and, set apart at the bottom, restart the cycle.
 */
export default function ManageCycleSheet({ peak, nextCycle, onChangePeak, lastReport, onRestart, onClose }: ManageCycleSheetProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-cycle-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <EscapeKey onEscape={onClose} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-raised w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between mb-4">
          <p id="manage-cycle-title" className="text-base font-semibold text-ink">
            {nextCycle ? "Next cycle" : "This cycle"}
          </p>
          <button onClick={onClose} aria-label="Close" className="text-ink-6 -mt-1 -mr-1 p-1 active:opacity-70">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <path d="M1.41 0L0 1.41 5.59 7 0 12.59 1.41 14 7 8.41 12.59 14 14 12.59 8.41 7 14 1.41 12.59 0 7 5.59 1.41 0z" />
            </svg>
          </button>
        </div>

        <div className="rounded-xl bg-surface-2 overflow-hidden divide-y divide-line-soft">
          <Row title="Change peak" detail={`${nextCycle ? "Next cycle peaks" : "Peaks"} at ${peak}kg`} onClick={onChangePeak} />
          {lastReport && <Row title={`${lastReport.label} report`} detail="How the last cycle went" onClick={lastReport.open} />}
        </div>

        {onRestart && (
          <div className="mt-6">
            <div className="rounded-xl bg-surface-2 overflow-hidden">
              <Row
                title={<span className="text-bad">Restart cycle</span>}
                detail="Back to Volume session 1. Logged sessions stay in history."
                onClick={onRestart}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ title, detail, onClick }: { title: ReactNode; detail: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-surface-3">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-ink-5 mt-0.5">{detail}</span>
      </span>
      <svg width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden="true" className="text-ink-6 shrink-0">
        <path d="M1.5 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
