"use client"

import { TrainingBlock, BlockPhase } from "@/lib/types"
import { getBlockLength, PHASE_SESSION_TYPE, PHASE_LABEL } from "@/lib/prescription"
import { PHASE_THEME, PHASE_PURPOSE } from "@/lib/phaseStyle"

type BlockHeaderProps =
  | {
      block: TrainingBlock
      confirmedCount: number
      projected?: undefined
    }
  | {
      /** A phase still to come: shown from its plan, with no block behind it yet. */
      projected: { phase: BlockPhase; total: number }
      block?: undefined
      confirmedCount?: undefined
    }

/** How the peak test that closed the cycle went, and what the next cycle does about it. Deload blocks only. */
function reviewLines(block: TrainingBlock): { title: string; detail: string | null } | null {
  const review = block.review
  if (!review) return null
  const peak = block.anchorWeight
  const change =
    review.change === "volume-up"
      ? "Volume days get a set more next cycle."
      : review.change === "volume-reset"
      ? "Volume days go back to their base sets."
      : review.change === "rep-range"
      ? block.repRange === "heavy"
        ? "Two cycles without a new peak, so Volume switches to heavier sixes to fours."
        : "Two cycles without a new peak, so Volume goes back to eights to sixes."
      : null
  if (review.outcome === "untested") {
    return { title: "Peak single skipped", detail: `Your peak stays ${peak}kg.` }
  }
  if (review.outcome === "raised") {
    return { title: `Peak test done · ${review.previousAnchor} → ${peak}kg`, detail: change }
  }
  const title =
    peak === review.previousAnchor
      ? `Peak test done · holds at ${peak}kg`
      : `Peak test done · ${review.previousAnchor} → ${peak}kg`
  return { title, detail: ["A full deload week first.", change].filter(Boolean).join(" ") }
}

function phaseName(phase: BlockPhase): string {
  // Re-acclimation has no session-type equivalent: show its phase name so the banner
  // reads "Re-acclimation", not the "Volume" its sessions log as.
  return phase === "reacclimation" ? PHASE_LABEL[phase] : PHASE_SESSION_TYPE[phase]
}

export default function BlockHeader(props: BlockHeaderProps) {
  const phase = props.projected ? props.projected.phase : props.block.phase
  const theme = PHASE_THEME[phase] ?? PHASE_THEME.accumulation
  const completed = props.block?.status === "completed"
  const total = props.projected ? props.projected.total : getBlockLength(props.block)
  const done = props.projected ? 0 : props.confirmedCount
  const review = props.block ? reviewLines(props.block) : null

  return (
    <div
      className={`rounded-xl px-4 py-3 mb-3${completed ? " opacity-75" : ""}`}
      style={{ backgroundColor: theme.tint }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: theme.color }} />
          <span className="text-sm font-semibold" style={{ color: theme.color }}>
            {completed ? "✓ " : ""}
            {phaseName(phase)}
          </span>
          {props.projected && (
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: theme.muted }}>
              Projected
            </span>
          )}
        </div>
        <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: theme.muted }}>
          {props.projected
            ? `${total} session${total === 1 ? "" : "s"}`
            : completed
            ? `${done} of ${total}`
            : `${Math.min(done, total)} of ${total} done`}
        </span>
      </div>

      <p className="text-xs mt-1 mb-2.5" style={{ color: theme.muted }}>
        {PHASE_PURPOSE[phase]}
      </p>

      {review && (
        <div className="rounded-lg bg-white/80 px-3 py-2 mb-2.5">
          <p className="text-xs font-semibold" style={{ color: theme.color }}>
            {review.title}
          </p>
          {review.detail && <p className="text-xs text-[#777777] mt-0.5 leading-snug">{review.detail}</p>}
        </div>
      )}

      {/* Progress through the phase; a projected phase has none yet */}
      <div className="h-1 rounded-full bg-black/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            backgroundColor: theme.color,
            width: total > 0 ? `${(Math.min(done, total) / total) * 100}%` : "0%",
          }}
        />
      </div>
    </div>
  )
}
