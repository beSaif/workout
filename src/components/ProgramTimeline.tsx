"use client"

import { TrainingBlock, BlockPhase } from "@/lib/types"
import { blockPosition, getBlockLength } from "@/lib/prescription"
import { PHASE_THEME } from "@/lib/phaseStyle"

const PHASE_ORDER: BlockPhase[] = ["accumulation", "transmutation", "realization", "deload"]

const PHASE_SHORT: Record<BlockPhase, string> = {
  accumulation: "Volume",
  transmutation: "Intensity",
  realization: "Peak",
  deload: "Deload",
  reacclimation: "Rebuild",
}

type StepStatus = "completed" | "active" | "upcoming" | "resume"

interface Step {
  phase: BlockPhase
  status: StepStatus
  block?: TrainingBlock
}

interface ProgramTimelineProps {
  blocks: TrainingBlock[]
  selectedBlockId?: number | null
  onBlockSelect: (block: TrainingBlock | null) => void
  selectedUpcomingPhase?: BlockPhase | null
  onUpcomingPhaseSelect?: (phase: BlockPhase | null) => void
  /** Opens the sheet that edits the cycle's peak. */
  onEditPeak?: () => void
  /** Sessions a phase still to come will have, for the count under its step. */
  upcomingLength?: (phase: BlockPhase) => number
}

export default function ProgramTimeline({ blocks, selectedBlockId, onBlockSelect, selectedUpcomingPhase, onUpcomingPhaseSelect, onEditPeak, upcomingLength }: ProgramTimelineProps) {
  const sorted = [...blocks].sort((a, b) => a.id - b.id)
  const activeBlock = sorted.find((b) => b.status === "active")
  if (!activeBlock) return null

  // A re-acclimation block is a temporary detour and isn't part of the four-phase
  // cycle. Anchor the timeline on the interrupted block it will resume, so the
  // standard cycle still renders — but surface the rebuild as its own step and
  // mark the resume phase as "resume" rather than "now".
  const isReacclimation =
    PHASE_ORDER.indexOf(activeBlock.phase) === -1 && activeBlock.resumeBlockId !== undefined
  const anchorBlock = isReacclimation
    ? sorted.find((b) => b.id === activeBlock.resumeBlockId) ?? activeBlock
    : activeBlock

  const activePhaseIdx = PHASE_ORDER.indexOf(anchorBlock.phase)
  if (activePhaseIdx === -1) return null
  const activeIdx = sorted.findIndex((b) => b.id === anchorBlock.id)
  const cycleStartIdx = activeIdx - activePhaseIdx

  const steps: Step[] = []
  PHASE_ORDER.forEach((phase, i) => {
    if (i < activePhaseIdx) {
      steps.push({ phase, status: "completed", block: sorted[cycleStartIdx + i] })
      return
    }
    if (i === activePhaseIdx) {
      // In a re-acclimation detour, insert the rebuild step before the phase it
      // resumes, and show that phase as "resume" instead of the active "now".
      if (isReacclimation) {
        steps.push({ phase: activeBlock.phase, status: "active", block: activeBlock })
        steps.push({ phase, status: "resume", block: anchorBlock })
      } else {
        steps.push({ phase, status: "active", block: anchorBlock })
      }
      return
    }
    steps.push({ phase, status: "upcoming" })
  })

  function handleStepClick(step: Step) {
    if (step.status === "active") {
      onBlockSelect(null)
      onUpcomingPhaseSelect?.(null)
      return
    }
    if ((step.status === "completed" || step.status === "resume") && step.block) {
      onUpcomingPhaseSelect?.(null)
      onBlockSelect(step.block)
      return
    }
    if (step.status === "upcoming") {
      onBlockSelect(null)
      onUpcomingPhaseSelect?.(step.phase === selectedUpcomingPhase ? null : step.phase)
    }
  }

  /** The small line under a step: where that phase stands. */
  function stepNote(step: Step): string {
    if (step.status === "completed") return "done"
    if (step.status === "resume") return "resume"
    if (step.status === "active" && step.block) {
      return `${Math.min(blockPosition(step.block), getBlockLength(step.block))}/${getBlockLength(step.block)}`
    }
    const n = upcomingLength?.(step.phase)
    return n != null ? `${n} session${n === 1 ? "" : "s"}` : ""
  }

  // Dots sit at the centre of equal columns; the track runs from the first to the last,
  // filled up to the phase in progress.
  const edge = 50 / steps.length
  const nowIdx = steps.findIndex((st) => st.status === "active")
  const filled = steps.length > 1 ? (Math.max(0, nowIdx) / (steps.length - 1)) * (100 - 2 * edge) : 0

  return (
    <div className="mb-4">
      <div className="relative flex">
        <div className="absolute top-[5px] h-px bg-[#e5e5e5]" style={{ left: `${edge}%`, right: `${edge}%` }} />
        <div
          className="absolute top-[5px] h-px transition-all duration-500"
          style={{ left: `${edge}%`, width: `${filled}%`, backgroundColor: PHASE_THEME[steps[Math.max(0, nowIdx)].phase].color, opacity: 0.35 }}
        />
        {steps.map((step) => (
          <button
            key={step.phase}
            onClick={() => handleStepClick(step)}
            className="relative flex-1 flex flex-col items-center gap-1 active:opacity-70"
          >
            <StepDot
              step={step}
              note={stepNote(step)}
              isSelected={
                step.status === "upcoming"
                  ? step.phase === selectedUpcomingPhase
                  : step.block != null && step.block.id === selectedBlockId
              }
              isActiveBlock={step.status === "active"}
            />
          </button>
        ))}
      </div>
      {/* The peak belongs to the whole cycle, so it is shown once here, not on every phase.
          By the deload the next cycle's peak is already set. */}
      <button
        onClick={onEditPeak}
        disabled={!onEditPeak}
        className="mt-3 mx-auto flex items-center gap-1.5 rounded-full bg-[#f5f5f5] px-3 py-1 text-[11px] text-[#777777] active:opacity-70"
      >
        <span>{anchorBlock.phase === "deload" ? "Next cycle peaks at" : "This cycle peaks at"}</span>
        <span className="font-semibold text-[#111111]">{anchorBlock.anchorWeight}kg</span>
        {onEditPeak && <span className="font-semibold text-[#1e3a5f]">· Edit</span>}
      </button>
    </div>
  )
}

function StepDot({
  step,
  note,
  isSelected,
  isActiveBlock,
}: {
  step: Step
  note: string
  isSelected: boolean
  isActiveBlock: boolean
}) {
  const { phase, status } = step
  const color = PHASE_THEME[phase].color
  const isUpcoming = status === "upcoming"
  const isCompleted = status === "completed"
  const isResume = status === "resume"

  // Only the active ("now") step reads as lit. The resume step is a phase you'll return
  // to later, so, like upcoming, it renders muted unless tapped to browse that block.
  const isDimmed = (isUpcoming || isResume) && !isSelected

  return (
    <>
      <span
        className="relative z-10 w-[11px] h-[11px] rounded-full border-2 bg-white transition-all"
        style={{
          borderColor: isDimmed ? "#d4d4d4" : color,
          backgroundColor: isActiveBlock || isCompleted || isSelected ? color : "#ffffff",
          opacity: isCompleted && !isSelected ? 0.55 : 1,
          boxShadow: isActiveBlock ? `0 0 0 3px ${color}26` : "none",
        }}
      />
      <span
        className="text-[11px] leading-tight transition-colors"
        style={{
          color: isDimmed ? "#999999" : isCompleted && !isSelected ? "#888888" : color,
          fontWeight: isActiveBlock || isSelected ? 700 : 500,
        }}
      >
        {PHASE_SHORT[phase]}
      </span>
      <span
        className="text-[10px] leading-none tabular-nums"
        style={{ color: isActiveBlock ? color : "#aaaaaa", opacity: isActiveBlock ? 0.75 : 1 }}
      >
        {note}
      </span>
    </>
  )
}
