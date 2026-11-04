"use client"

import { TrainingBlock, BlockPhase } from "@/lib/types"

const PHASE_ORDER: BlockPhase[] = ["accumulation", "transmutation", "realization", "deload"]

const PHASE_SHORT: Record<BlockPhase, string> = {
  accumulation: "Volume",
  transmutation: "Intensity",
  realization: "Peak",
  deload: "Deload",
  reacclimation: "Rebuild",
}

const PHASE_COLOR: Record<BlockPhase, string> = {
  accumulation: "#2d6a2d",
  transmutation: "#5a2d8a",
  realization: "#1e3a5f",
  deload: "#888888",
  reacclimation: "#b06a1e",
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
}

export default function ProgramTimeline({ blocks, selectedBlockId, onBlockSelect, selectedUpcomingPhase, onUpcomingPhaseSelect, onEditPeak }: ProgramTimelineProps) {
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

  return (
    <div className="mb-4">
      <div className="flex items-start justify-between px-1">
        {steps.map((step, i) => (
          <div key={step.phase} className="flex items-center">
            <button
              onClick={() => handleStepClick(step)}
              className="flex flex-col items-center gap-0.5"
              style={{ minWidth: 52 }}
            >
              <StepDot
                step={step}
                isSelected={
                  step.status === "upcoming"
                    ? step.phase === selectedUpcomingPhase
                    : step.block != null && step.block.id === selectedBlockId
                }
                isActiveBlock={step.status === "active"}
              />
            </button>
            {i < steps.length - 1 && (
              <span className="text-[#cccccc] text-xs mx-1 mt-0.5 leading-none">›</span>
            )}
          </div>
        ))}
      </div>
      {/* The peak belongs to the whole cycle, so it is shown once here, not on every phase.
          By the deload the next cycle's peak is already set. */}
      <button
        onClick={onEditPeak}
        disabled={!onEditPeak}
        className="mt-2 w-full text-center text-[11px] text-[#999999] active:opacity-70"
      >
        {anchorBlock.phase === "deload" ? "Next cycle peaks at " : "This cycle peaks at "}
        <span className="font-semibold text-[#555555]">{anchorBlock.anchorWeight}kg</span>
        {onEditPeak && <span className="underline ml-1">edit</span>}
      </button>
    </div>
  )
}

function StepDot({
  step,
  isSelected,
  isActiveBlock,
}: {
  step: Step
  isSelected: boolean
  isActiveBlock: boolean
}) {
  const { phase, status } = step
  const color = PHASE_COLOR[phase]
  const isUpcoming = status === "upcoming"
  const isCompleted = status === "completed"
  const isResume = status === "resume"

  // Only the active ("now") step should read as lit. The resume step is a phase
  // you'll return to later, so — like upcoming — it renders muted unless the user
  // taps it to browse that block.
  const isDimmed = (isUpcoming || isResume) && !isSelected

  const dotBg = isDimmed ? "#dddddd" : color
  const dotOpacity = isDimmed ? 0.4 : isCompleted && !isSelected ? 0.55 : 1
  const textColor = isDimmed ? "#aaaaaa" : isCompleted ? (isSelected ? color : "#999999") : color

  return (
    <>
      <div
        className="w-2 h-2 rounded-full mb-0.5 transition-all"
        style={{
          backgroundColor: dotBg,
          opacity: dotOpacity,
          boxShadow: isActiveBlock ? `0 0 0 2px ${color}40` : isSelected ? `0 0 0 2px ${color}80` : "none",
        }}
      />
      <span
        className="text-[10px] text-center leading-tight transition-colors"
        style={{
          color: textColor,
          fontWeight: isActiveBlock || isSelected ? 700 : 500,
          opacity: isCompleted && !isSelected ? 0.75 : 1,
        }}
      >
        {isCompleted ? "✓ " : ""}{PHASE_SHORT[phase]}
        {isActiveBlock && <span className="block text-[8px] opacity-60">now</span>}
        {isResume && <span className="block text-[8px] opacity-60">resume</span>}
      </span>
    </>
  )
}
