"use client"

import { useCallback, useRef } from "react"
import { Session, TrainingBlock, TrainingDay, UserProfile } from "@/lib/types"
import { getMainLiftLabel, getSessionLabel, isLiftFocused } from "@/lib/trainingMode"
import { getBestE1RM, getLatestBW, sessionWork } from "@/lib/stats"
import { MuscleGroupConfig, getMuscleLabel } from "@/lib/exerciseConfig"
import { PHASE_SESSION_TYPE } from "@/lib/prescription"
import ShareCard from "@/components/ShareCard"
import ShareImageSheet from "@/components/ShareImageSheet"

interface Props {
  session: Session
  sessions: Session[]
  blocks: TrainingBlock[]
  profile: UserProfile
  exerciseConfig: MuscleGroupConfig[]
  trainingDays: TrainingDay[]
  onClose: () => void
}

export default function ShareImageModal({
  session,
  sessions,
  blocks,
  profile,
  exerciseConfig,
  trainingDays,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)

  const bestE1RM = getBestE1RM(sessions)
  const bodyweight = session.bw ?? getLatestBW(sessions) ?? profile.bw

  // A Balanced session has no main lift to headline, so the card leads with the
  // training day and the muscles it trained instead.
  const mainLiftLabel = getMainLiftLabel(profile)
  const work = sessionWork(session, mainLiftLabel)
  const dayLabel = getSessionLabel(session, trainingDays)
  const muscleLabels = work.muscles.map((m) => getMuscleLabel(exerciseConfig, m))

  // A rebuild session logs its type as "Volume"; look up its block so the card
  // can label it "Rebuild" and show the phase it resumes into.
  const block = blocks.find((b) => b.id === session.blockId)
  const isRebuild = block?.phase === "reacclimation"
  const resumeBlock =
    isRebuild && block?.resumeBlockId != null
      ? blocks.find((b) => b.id === block.resumeBlockId)
      : undefined
  const resumePhaseType = resumeBlock ? PHASE_SESSION_TYPE[resumeBlock.phase] : null

  const dateStr = session.date ?? new Date().toISOString()
  const fileName = `${isLiftFocused(profile) && profile.mainLift ? profile.mainLift : "session"}-${dateStr.slice(0, 10)}.png`

  // The card is rendered offscreen at full width, so the snapshot is the same
  // 1080px image regardless of the phone it was shared from.
  const capture = useCallback(async () => {
    const node = cardRef.current
    if (!node) throw new Error("no node")
    const { toBlob } = await import("html-to-image")
    // Card height is content-driven, so capture its measured height
    // rather than a fixed value to avoid empty space or clipping.
    return toBlob(node, {
      width: 1080,
      height: Math.ceil(node.offsetHeight),
      pixelRatio: 1,
      backgroundColor: "#ffffff",
      cacheBust: true,
    })
  }, [])

  return (
    <>
      <ShareImageSheet
        title="share your lift"
        fileName={fileName}
        alt="Workout share card"
        capture={capture}
        onClose={onClose}
      />

      {/* Offscreen full-resolution card for capture (laid out, not display:none) */}
      <div
        aria-hidden
        style={{ position: "fixed", left: -99999, top: 0, pointerEvents: "none" }}
      >
        <ShareCard
          ref={cardRef}
          session={session}
          bestE1RM={bestE1RM}
          bodyweight={bodyweight}
          target={profile.target ?? null}
          date={session.date}
          mainLiftLabel={session.type === "Free" ? null : mainLiftLabel}
          dayLabel={dayLabel}
          muscleLabels={muscleLabels}
          work={work}
          isRebuild={isRebuild}
          resumePhaseType={resumePhaseType}
        />
      </div>
    </>
  )
}
