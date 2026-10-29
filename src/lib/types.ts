export interface MainLiftSet {
  id: string
  kg: number
  reps: number
  rpe: number | null
  e1rm: number | null
  note: string
  isWarmup: boolean
}

/**
 * "Free" is an accessories-only session: no main lift, no block. Every Balanced-mode
 * session is one, and so is a lift-focused session whose main lift was skipped
 * (those carry `skippedMainLift`, which is what tells the two apart).
 */
export type SessionType = "Volume" | "Intensity" | "Peak" | "Deload" | "Free"

export interface Session {
  id: number
  date: string | null
  type: SessionType
  bw: number | null
  sets: MainLiftSet[]
  confirmed: boolean
  coachNote: string
  selectedMuscleGroups?: MuscleGroup[]
  selectedTrainingDayId?: string
  extraWorkouts?: ExtraWorkout[]
  blockId?: number
  /**
   * Lift-focused only: the user chose to train this day without their main lift.
   * Such a session is stored as "Free" and stays outside the block (no blockId, never
   * added to sessionIds), so the load it was going to carry is served again next time.
   */
  skippedMainLift?: boolean
}

export type BlockPhase = "accumulation" | "transmutation" | "realization" | "deload" | "reacclimation"
export type BlockStatus = "active" | "completed" | "interrupted"

export interface TrainingBlock {
  id: number
  phase: BlockPhase
  status: BlockStatus
  sessionIds: number[]
  /**
   * 0-based slots of this block the user jumped over without training them. A slot
   * counts towards the block's progress like a logged session, so the next session
   * prescribes from `sessionIds.length + skippedSlots.length` (see blockPosition).
   */
  skippedSlots?: number[]
  anchorWeight: number
  /**
   * Sessions in this block, set from the user's benching frequency when the block is
   * made. Blocks saved before it existed fall back to BLOCK_LENGTHS.
   */
  length?: number
  startDate: string | null
  endDate: string | null
  /** Re-acclimation only: per-session rebuild loads (kg). Block length = rebuildLoads.length. */
  rebuildLoads?: number[]
  /** Re-acclimation only: id of the interrupted block to reactivate once rebuilds are done. */
  resumeBlockId?: number
}

export type MainLift = "bench" | "deadlift" | "squat"

export const MAIN_LIFT_LABEL: Record<MainLift, string> = {
  bench: "Bench Press",
  deadlift: "Deadlift",
  squat: "Squat",
}

export const MAIN_LIFT_SHORT: Record<MainLift, string> = {
  bench: "Bench",
  deadlift: "Deadlift",
  squat: "Squat",
}

/**
 * How the app is organised for this user.
 * - "lift-focused": one main lift opens every session, block periodization, target tracking.
 * - "balanced": sessions are whatever the training day says; no main lift, no blocks.
 * Profiles saved before this field existed have no value and are treated as lift-focused.
 */
export type TrainingMode = "lift-focused" | "balanced"

export const TRAINING_MODE_LABEL: Record<TrainingMode, string> = {
  "lift-focused": "Lift-focused",
  balanced: "Balanced",
}

export const TRAINING_MODE_DESC: Record<TrainingMode, string> = {
  "lift-focused": "One main lift opens every session. Block periodization, prescribed loads and a target to chase.",
  balanced: "Just your training days. Log whatever the day calls for, no forced lift and no block phases.",
}

export interface UserProfile {
  email: string
  name: string
  bw: number
  trainingMode?: TrainingMode
  /** Required in lift-focused mode; absent for Balanced users who never picked one. */
  mainLift?: MainLift
  anchor?: number
  target?: number
  /**
   * Bodyweight check-ins (asked weekly; the name predates that). Absent means the user has never been asked — which is
   * what makes the one-time opt-in prompt fire — so this stays tri-state on purpose.
   */
  weighInDaily?: boolean
  /** Goal bodyweight in kg. Only drives the goal line and projection on /weight. */
  goalBw?: number
  createdAt: string
}

/**
 * The slice of a profile anyone signed in may see — exactly what the gymbro card
 * draws. Bodyweight, check-in settings and the join date stay between gymbros.
 */
export type PublicProfile = Pick<
  UserProfile,
  "email" | "name" | "trainingMode" | "mainLift" | "anchor" | "target"
>

/**
 * One bodyweight reading. At most one per calendar date — a second check-in on the
 * same day replaces the first rather than stacking.
 */
export interface WeightEntry {
  /** The user's LOCAL calendar date, "YYYY-MM-DD". This is the entry's identity. */
  date: string
  kg: number
  /** When it was recorded or last edited, ISO. */
  loggedAt: string
}

export const STORAGE_KEY = "lift-tracker-sessions"
export const DRAFT_KEY = "lift-tracker-draft"
export const BLOCKS_KEY = "lift-tracker-blocks"
export const EXERCISES_KEY = "lift-tracker-exercises"
export const PROFILE_KEY = "lift-tracker-profile"
export const PRESENCES_KEY = "lift-tracker-presences"
export const FRIENDS_KEY = "lift-tracker-friends"
export const LAYOFF_DISMISS_KEY = "lift-tracker-layoff-dismissed"
export const WHATS_NEW_SEEN_KEY = "lift-tracker-whats-new-seen"
export const EXERCISES_MIGRATION_KEY = "lift-tracker-exercises-migration"
export const WEIGHTS_KEY = "lift-tracker-weights"
/** Which KV writes this device made that the server has not acknowledged yet. */
export const PENDING_SYNC_KEY = "lift-tracker-pending-sync"
/** The day the check-in prompt was last dismissed on this device, "YYYY-MM-DD". */
export const WEIGH_IN_SKIP_KEY = "lift-tracker-weigh-in-skipped"
/** The routine as it was before the last plan was applied, so the import can be undone. */
export const ROUTINE_UNDO_KEY = "lift-tracker-routine-undo"
/**
 * Device preferences for Dot and its haptics, "off" when switched off. Absent means on.
 * They belong to the phone, not the account, so signing out leaves them alone.
 */
export const DOT_KEY = "lift-tracker-dot"
export const HAPTICS_KEY = "lift-tracker-haptics"

export interface SessionDraft {
  sessionId: number
  savedAt: string
  sets: Array<{
    id: string
    kg: number
    reps: number
    rpe: number | null
    e1rm: number | null
    note: string
    isWarmup: boolean
    _kgStr: string
    _repsStr: string
    _rpeStr: string
  }>
  completedSets: string[]
  extraState: Record<
    string,
    Record<
      string,
      Array<{
        kgStr: string
        repsStr: string
        minutesStr?: string
        distanceStr?: string
        speedStr?: string
        inclineStr?: string
      }>
    >
  >
  coachNote: string
  currentSetIndex: number
  exerciseOrder?: Array<
    | { kind: "main" }
    | { kind: "extra"; muscle: MuscleGroup; exercise: string }
  >
  restEndTime?: number | null
}

export interface PresenceRecord {
  inSession: boolean
  startedAt: string | null
}

export interface UserPresence extends PresenceRecord {
  email: string
  name: string
}

/**
 * A friend's last session, summarised against *their* training days and muscle names
 * (both live under per-user keys the viewer cannot read). Built by /api/friends/profile.
 */
export interface FriendSessionSummary {
  label: string
  muscles: string[]
  exercises: number
  sets: number
  volume: number
  topSet: { kg: number; reps: number; exercise: string } | null
}

export interface FriendRequest {
  email: string
  name: string
  sentAt: string
}

export type MuscleGroup = string

export interface TrainingDay {
  id: string
  name: string
  order: number
  muscleGroupIds: string[]
}

export const TRAINING_DAYS_KEY = "lift-tracker-training-days"

export interface ExtraSet {
  kg: number
  reps: number
  rpe: number | null
  /**
   * Duration in minutes. Present only on cardio sets, which are logged as time rather
   * than load: those carry `kg: 0` and `reps: 0`, so tonnage, PRs and top-set maths
   * skip them on their own. Its presence is what marks a set as cardio, both in the
   * logger and in everything that reads a session back.
   */
  minutes?: number
  /**
   * The optional detail of a cardio bout, each absent unless the user asked to log it.
   * Time alone is a complete bout — these only ever add to it, so nothing downstream
   * may assume any of them is there.
   *
   * `distance` and `speed` are two views of the same thing, and logging one lets the
   * card show the other: which one you log is which one the machine told you.
   */
  /** Kilometres covered. */
  distance?: number
  /** Kilometres per hour, as set on the machine. */
  speed?: number
  /** Gradient, as a percentage. */
  incline?: number
}

/** A logged set that is cardio — timed work, no load. */
export function isCardioSet(set: ExtraSet): boolean {
  return set.minutes != null
}

export interface ExtraExercise {
  name: string
  sets: ExtraSet[]
}

export interface ExtraWorkout {
  muscle: MuscleGroup
  exercises: ExtraExercise[]
}

export interface GymbroMessage {
  id: string
  fromEmail: string
  fromName: string
  text: string
  sentAt: string
}
