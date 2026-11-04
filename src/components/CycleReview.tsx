"use client"

import { TrainingBlock } from "@/lib/types"
import { PHASE_THEME } from "@/lib/phaseStyle"

/** How the peak test that closed the cycle went, and what the next cycle does about it. */
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

/** The deload's summary of the cycle it closes. Renders nothing for any other block. */
export default function CycleReview({ block }: { block: TrainingBlock }) {
  const lines = reviewLines(block)
  if (!lines) return null
  const theme = PHASE_THEME.realization
  return (
    <div className="rounded-xl px-4 py-3 mb-3" style={{ backgroundColor: theme.tint }}>
      <p className="text-sm font-semibold" style={{ color: theme.color }}>
        {lines.title}
      </p>
      {lines.detail && <p className="text-xs mt-0.5 leading-snug" style={{ color: theme.muted }}>{lines.detail}</p>}
    </div>
  )
}
