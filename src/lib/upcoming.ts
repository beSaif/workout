import { BlockPhase, Session, TrainingBlock, TrainingDay, UserProfile } from "./types"
import { getMainLiftShortLabel, isLiftFocused } from "./trainingMode"
import {
  prescribeBlockSession,
  prescribeForBlock,
  getBlockLength,
  blockPosition,
  cycleLoadOffset,
  blockLengthFor,
  measureSessionsPerWeek,
  PHASE_LABEL,
  PHASE_SESSION_TYPE,
  type Prescription,
} from "./prescription"
import { generateWarmups } from "./warmup"
import { calcE1RM } from "./e1rm"
import { closeBlock } from "./jump"
import { MuscleGroupConfig, DEFAULT_TRAINING_DAYS } from "./exerciseConfig"
import { suggestNextDay } from "./balance"

/**
 * The upcoming session and the block bookkeeping around it: what Home shows as "up
 * next", what Skip / Restore do to it, and how logging a session moves the block on.
 * Pure: no React, no storage, no network. Anything that reads the clock takes `now`.
 */

export function getActiveBlock(blocks: TrainingBlock[]): TrainingBlock | undefined {
  return blocks.find((b) => b.status === "active")
}

/**
 * The next session to train. In lift-focused mode it opens with the main lift at the
 * active block's prescribed load (warm-ups, then working sets); in Balanced mode it is
 * a Free card for the next training day.
 */
export function createUpcomingSession(
  sessions: Session[],
  blocks: TrainingBlock[],
  config: MuscleGroupConfig[],
  profile: UserProfile,
  trainingDays: TrainingDay[] = DEFAULT_TRAINING_DAYS,
  now: Date = new Date()
): Session {
  const maxIdAll = sessions.length > 0 ? Math.max(...sessions.map((s) => s.id)) : 0
  const nextDayAll = suggestNextDay(sessions, trainingDays, config, { now })?.day

  // Balanced mode: no main lift, no block. The upcoming card is just the next training day.
  if (!isLiftFocused(profile)) {
    return {
      id: maxIdAll + 1,
      date: null,
      type: "Free",
      bw: null,
      sets: [],
      confirmed: false,
      coachNote: "",
      selectedTrainingDayId: nextDayAll?.id,
      selectedMuscleGroups: nextDayAll?.muscleGroupIds ?? [],
    }
  }

  const activeBlock = getActiveBlock(blocks)

  let prescription: Prescription
  let blockId: number | undefined

  if (activeBlock) {
    const sessionIndexInBlock = blockPosition(activeBlock)
    prescription = prescribeForBlock(activeBlock, sessionIndexInBlock, cycleLoadOffset(blocks, sessions, activeBlock))
    blockId = activeBlock.id
  } else {
    prescription = prescribeBlockSession("accumulation", 0, profile.anchor ?? 0)
  }

  const warmups = generateWarmups(prescription.weight, prescription.reps)
  const workingSets = Array.from({ length: prescription.sets }, (_, i) => ({
    id: `S${i + 1}`,
    kg: prescription.weight,
    reps: prescription.reps,
    rpe: null as null,
    e1rm: calcE1RM(prescription.weight, prescription.reps),
    note: "",
    isWarmup: false,
  }))
  const maxId = sessions.length > 0 ? Math.max(...sessions.map((s) => s.id)) : 0

  const sessionIndex = activeBlock ? blockPosition(activeBlock) : 0
  const phase = activeBlock?.phase ?? "accumulation"
  const blockLength = activeBlock ? getBlockLength(activeBlock) : blockLengthFor("accumulation", measureSessionsPerWeek(sessions, null))
  const effort = prescription.rpe != null ? ` ${prescription.light ? "Light day, aim" : "Aim"} for RPE ${prescription.rpe}.` : ""
  const coachNote = `[${PHASE_LABEL[phase]} ${sessionIndex + 1}/${blockLength}] ${prescription.weight}kg × ${prescription.reps} × ${prescription.sets}.${effort} Stay tight, drive the bar.`

  const nextDay = suggestNextDay(sessions, trainingDays, config, { now })?.day

  return {
    id: maxId + 1,
    date: null,
    type: prescription.sessionType,
    bw: null,
    confirmed: false,
    coachNote,
    sets: [...warmups, ...workingSets],
    selectedTrainingDayId: nextDay?.id,
    selectedMuscleGroups: nextDay?.muscleGroupIds ?? [],
    blockId,
  }
}

/**
 * The upcoming card must match the current training mode: a Free card in Balanced mode,
 * a prescribed one in lift-focused mode. A mismatch means the user switched modes since
 * the card was generated, so it needs regenerating.
 *
 * A lift-focused card whose main lift was skipped is stored as Free too, but that is a
 * deliberate choice for today rather than a stale card — it stays as it is.
 */
export function upcomingMatchesMode(upcoming: Session | undefined, profile: UserProfile): boolean {
  if (!upcoming) return false
  if (isLiftFocused(profile)) return upcoming.skippedMainLift === true || upcoming.type !== "Free"
  return upcoming.type === "Free"
}

/** A block slot by phase and place, e.g. "Intensity 3" — what the program calls it. */
export function slotLabel(phase: BlockPhase, index: number): string {
  const name = phase === "reacclimation" ? PHASE_LABEL[phase] : PHASE_SESSION_TYPE[phase]
  return `${name} ${index + 1}`
}

export function countSkippedSlots(blocks: TrainingBlock[]): number {
  return blocks.reduce((n, b) => n + (b.skippedSlots?.length ?? 0), 0)
}

/** The prescribed opener of an upcoming session, e.g. "62.5kg × 6 × 4". */
export function describePrescription(session: Session): string | null {
  const working = session.sets.filter((s) => !s.isWarmup)
  const top = working[0]
  return top ? `${top.kg}kg × ${top.reps} × ${working.length}` : null
}

export function backfillMuscles(
  sessions: Session[],
  config: MuscleGroupConfig[],
  trainingDays: TrainingDay[] = DEFAULT_TRAINING_DAYS,
  now: Date = new Date()
): Session[] {
  const upcoming = sessions.find((s) => !s.confirmed)
  if (!upcoming || upcoming.selectedMuscleGroups !== undefined) return sessions
  const nextDay = suggestNextDay(sessions, trainingDays, config, { now })?.day
  return sessions.map((s) =>
    s.id === upcoming.id
      ? { ...s, selectedTrainingDayId: nextDay?.id, selectedMuscleGroups: nextDay?.muscleGroupIds ?? [] }
      : s
  )
}

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    if (!a.confirmed) return -1
    if (!b.confirmed) return 1
    return new Date(b.date!).getTime() - new Date(a.date!).getTime()
  })
}

/**
 * The upcoming card with its main lift skipped ("Skip Bench"). It drops to accessories
 * only and leaves the block, so the load it was going to carry opens the next session.
 */
export function skipMainLift(session: Session, profile: Pick<UserProfile, "mainLift"> | null | undefined): Session {
  const liftShort = getMainLiftShortLabel(profile)
  const held = describePrescription(session)
  return {
    ...session,
    type: "Free",
    sets: [],
    blockId: undefined,
    skippedMainLift: true,
    coachNote: held
      ? `${liftShort} sat out today — ${held} moves to the next session. Everything else, full effort.`
      : `${liftShort} sat out today — its load moves to the next session.`,
  }
}

/** A skipped card with its main lift put back, keeping its id and the training day already chosen. */
export function restoreMainLift(
  session: Session,
  confirmedSessions: Session[],
  blocks: TrainingBlock[],
  config: MuscleGroupConfig[],
  profile: UserProfile,
  trainingDays: TrainingDay[] = DEFAULT_TRAINING_DAYS,
  now: Date = new Date()
): Session {
  const regenerated = createUpcomingSession(confirmedSessions, blocks, config, profile, trainingDays, now)
  return {
    ...regenerated,
    id: session.id,
    selectedTrainingDayId: session.selectedTrainingDayId,
    selectedMuscleGroups: session.selectedMuscleGroups,
  }
}

/**
 * Lift-focused, no main-lift sets, yet not marked as skipped. The logger can't remove
 * the main lift any more, but a draft saved by an older version still can, and such a
 * session must not use up the block slot it was prescribed for.
 */
function droppedMainLift(session: Session, profile: UserProfile): boolean {
  return isLiftFocused(profile) && !session.skippedMainLift && session.sets.length === 0
}

/**
 * The session as Home stores it once logged. One that lost its main lift is filed the
 * way Skip on the up-next card files it (accessories only, outside the block), so the
 * current stretch and History show it as a skip. The user's notes stay as written.
 */
export function asLoggedSession(session: Session, profile: UserProfile): Session {
  if (!droppedMainLift(session, profile)) return session
  return { ...session, type: "Free", sets: [], blockId: undefined, skippedMainLift: true }
}

/**
 * The blocks once `session` is logged: it joins the active block, which closes (and
 * hands over to the next) when that fills it. `completed` is the block that just closed.
 *
 * Balanced mode never advances a block; whatever blocks exist stay parked for a later
 * switch back. A session that skipped the main lift doesn't advance one either — the
 * block stays where it is so the load it was carrying is prescribed again next time.
 * Nor does one logged without any main-lift sets: that is a skip, however it got here.
 */
export function blocksAfterConfirm(
  blocks: TrainingBlock[],
  session: Session,
  confirmedSessions: Session[],
  profile: UserProfile
): { blocks: TrainingBlock[]; completed: TrainingBlock | null } {
  const advancesBlock = isLiftFocused(profile) && !session.skippedMainLift && !droppedMainLift(session, profile)
  const activeBlock = advancesBlock ? getActiveBlock(blocks) : undefined
  if (!activeBlock) return { blocks, completed: null }

  const updatedBlockSessionIds = [...activeBlock.sessionIds, session.id]
  const isBlockComplete =
    blockPosition({ ...activeBlock, sessionIds: updatedBlockSessionIds }) >= getBlockLength(activeBlock)

  if (isBlockComplete) {
    const completedBlock: TrainingBlock = {
      ...activeBlock,
      sessionIds: updatedBlockSessionIds,
      status: "completed",
      endDate: session.date ?? null,
    }
    // Re-acclimation finishes by resuming the interrupted block it was rebuilding
    // toward, rather than advancing into a fresh phase.
    return { blocks: closeBlock(blocks, completedBlock, confirmedSessions), completed: completedBlock }
  }
  return {
    blocks: blocks.map((b) => (b.id === activeBlock.id ? { ...b, sessionIds: updatedBlockSessionIds } : b)),
    completed: null,
  }
}
