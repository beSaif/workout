"use client"

import { TrainingBlock, BlockPhase } from "@/lib/types"
import { getBlockLength, PHASE_SESSION_TYPE, PHASE_LABEL } from "@/lib/prescription"

const PHASE_STYLE: Record<BlockPhase, { bar: string; label: string; meta: string; bg: string }> = {
  accumulation: {
    bar: "bg-[#2d6a2d]",
    label: "text-[#2d6a2d]",
    meta: "text-[#4a8a4a]",
    bg: "bg-[#f0f7f0]",
  },
  transmutation: {
    bar: "bg-[#5a2d8a]",
    label: "text-[#5a2d8a]",
    meta: "text-[#7a4daa]",
    bg: "bg-[#f5f0ff]",
  },
  realization: {
    bar: "bg-[#1e3a5f]",
    label: "text-[#1e3a5f]",
    meta: "text-[#3b5f8a]",
    bg: "bg-[#eff6ff]",
  },
  deload: {
    bar: "bg-[#888888]",
    label: "text-[#555555]",
    meta: "text-[#888888]",
    bg: "bg-[#f5f5f5]",
  },
  reacclimation: {
    bar: "bg-[#b06a1e]",
    label: "text-[#8a4d14]",
    meta: "text-[#b06a1e]",
    bg: "bg-[#fdf3e7]",
  },
}

interface BlockHeaderProps {
  block: TrainingBlock
  confirmedCount: number
}

/** What the cycle just finished showed, and what the next one does about it. Deload blocks only. */
function reviewText(block: TrainingBlock): string | null {
  const review = block.review
  if (!review) return null
  const peak = block.anchorWeight
  const change =
    review.change === "volume-up"
      ? " Volume days get a set more next cycle."
      : review.change === "volume-reset"
      ? " Volume days go back to their base sets."
      : review.change === "rep-range"
      ? block.repRange === "heavy"
        ? " Two cycles without a new peak, so Volume switches to heavier sixes to fours."
        : " Two cycles without a new peak, so Volume goes back to eights to sixes."
      : ""
  if (review.outcome === "untested") return `Cycle done without the peak single. The peak stays ${peak}kg.`
  if (review.outcome === "raised") return `Cycle done: peak ${review.previousAnchor} → ${peak}kg.${change}`
  const held = peak === review.previousAnchor ? `peak holds at ${peak}kg` : `peak ${review.previousAnchor} → ${peak}kg`
  return `Cycle done: ${held}. A full deload week first.${change}`
}

export default function BlockHeader({ block, confirmedCount }: BlockHeaderProps) {
  const style = PHASE_STYLE[block.phase] ?? PHASE_STYLE.accumulation
  const total = getBlockLength(block)
  const review = reviewText(block)
  // Re-acclimation has no session-type equivalent — show its phase name so the
  // banner reads "Re-acclimation", not the "Volume" its sessions log as.
  const label =
    block.phase === "reacclimation" ? PHASE_LABEL[block.phase] : PHASE_SESSION_TYPE[block.phase]

  return (
    <div className={`${style.bg} rounded-xl px-4 py-3 mb-3${block.status === "completed" ? " opacity-75" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-4 rounded-full ${style.bar}`} />
          <span className={`text-sm font-semibold ${style.label}`}>
            {block.status === "completed" ? "✓ " : ""}{label}
          </span>
        </div>
        <span className={`text-xs font-semibold ${style.label} opacity-60`}>
          {confirmedCount}/{total}
        </span>
      </div>

      {review && <p className={`text-xs ${style.meta} mb-2`}>{review}</p>}

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-black/10 overflow-hidden">
        <div
          className={`h-full rounded-full ${style.bar} transition-all duration-500`}
          style={{ width: total > 0 ? `${(confirmedCount / total) * 100}%` : "0%" }}
        />
      </div>
    </div>
  )
}
