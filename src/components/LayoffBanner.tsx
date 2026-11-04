"use client"

import { LayoffTier } from "@/lib/layoff"

interface LayoffBannerProps {
  tier: Exclude<LayoffTier, "none">
  days: number
  /** Phase name of the active block, e.g. "Accumulation". */
  phaseLabel: string
  /** Sessions already logged in the active block — what a restart would rewind. */
  sessionsIntoBlock: number
  anchorWeight: number
  onRestart: () => void
  onDismiss: () => void
}

function weeksText(days: number): string {
  if (days < 14) return `${days} days`
  const weeks = Math.floor(days / 7)
  return `${weeks} weeks`
}

export default function LayoffBanner({
  tier,
  days,
  phaseLabel,
  sessionsIntoBlock,
  anchorWeight,
  onRestart,
  onDismiss,
}: LayoffBannerProps) {
  // Nothing logged in this block yet — a restart would rewind nothing, so the
  // heads-up is all that's useful.
  const canRestart = tier === "restart" && sessionsIntoBlock > 0

  return (
    <div className="mb-4 rounded-xl bg-[#fdf3e7] border border-[#f0dcc0] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#8a4d14]">
            {weeksText(days)} since your last session
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#b06a1e]">
            {canRestart ? (
              <>
                That long off costs real strength — the loads left in this block were
                planned for the you of {weeksText(days)} ago. Restart {phaseLabel} from
                session 1 with the cycle&apos;s {anchorWeight}kg peak eased 5%, and climb back through it.
                Your logged sessions stay in history.
              </>
            ) : tier === "restart" ? (
              <>
                Expect to have lost a little off the top. This block hasn&apos;t started
                yet, so the plan is already fresh — treat session 1 as a re-entry and stop
                sets that spike past RPE 8.
              </>
            ) : (
              <>
                Not long enough to lose much, but the bar will feel heavy. Take the
                prescribed weight, and drop a rep or two if RPE spikes — don&apos;t chase
                the plan on the first session back.
              </>
            )}
          </p>
        </div>
        {/* "Keep going" below is the dismiss affordance when actions are shown. */}
        {!canRestart && (
          <button
            onClick={onDismiss}
            className="shrink-0 text-[#c9a06a] active:opacity-70 pt-0.5"
            aria-label="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <path d="M1.41 0L0 1.41 5.59 7 0 12.59 1.41 14 7 8.41 12.59 14 14 12.59 8.41 7 14 1.41 12.59 0 7 5.59 1.41 0z" />
            </svg>
          </button>
        )}
      </div>

      {canRestart && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onRestart}
            className="flex-1 py-2.5 rounded-lg bg-[#b06a1e] text-sm font-semibold text-white active:opacity-80"
          >
            Restart {phaseLabel}
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 py-2.5 rounded-lg bg-white border border-[#f0dcc0] text-sm font-medium text-[#8a4d14] active:opacity-70"
          >
            Keep going
          </button>
        </div>
      )}
    </div>
  )
}
