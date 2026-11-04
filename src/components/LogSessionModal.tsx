"use client"

import { useState, useEffect, useRef } from "react"
import {
  Session,
  MainLiftSet,
  MuscleGroup,
  ExtraWorkout,
  MAIN_LIFT_LABEL,
} from "@/lib/types"
import { calcE1RM } from "@/lib/e1rm"
import { saveDraft, clearDraft, saveMiniPlayer } from "@/lib/storage"
import type { SessionDraft } from "@/lib/types"
import { MuscleGroupConfig, getMuscleLabel, getExercisesForMuscle, getSessionExercisesForMuscle, sortedMuscleGroups, sortedCardioGroups, isCardioMuscle, getDefaultSets, DEFAULT_CARDIO_MINUTES } from "@/lib/exerciseConfig"
import {
  CardioField,
  CARDIO_FIELDS,
  CARDIO_FIELD_DEFAULT,
  CARDIO_FIELD_LABEL,
  CARDIO_FIELD_UNIT,
  CARDIO_FIELD_VALUES,
  MAX_CARDIO_FIELDS,
  formatCardioNumber,
  formatCardioSet,
  formatDerivedCardio,
} from "@/lib/cardio"
import { getBestE1RMForExercise, getLastSetsForExercise, getTopSet } from "@/lib/exerciseHistory"
import { getBestE1RM } from "@/lib/stats"
import { buzzSetMoment, classifySet, reportSetMoment, type DotMoment } from "@/lib/buddy"
import HapticTap from "@/components/HapticTap"
import { afterHapticTap } from "@/lib/haptics"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DrumRollPicker } from "@/components/DrumRollPicker"
import SessionProgressDashes, { type ProgressDash } from "@/components/SessionProgressDashes"

/**
 * Rest after a set, in seconds, by what the set was: a heavy main-lift set needs the
 * full three minutes, a 20kg warm-up or an accessory does not.
 */
const REST_SECONDS = {
  warmup: 60,
  main: 180,
  accessory: 90,
  cardio: 60,
} as const

/** How long the Done that finishes an exercise pops before the rest timer takes over. */
const DONE_POP_MS = 220

const KG_VALUES = Array.from(
  { length: Math.floor((300 - 20) / 2.5) + 1 },
  (_, i) => 20 + i * 2.5
)
/** Main-lift reps start at 0: a set logged at 0 is a missed attempt (a failed single, say). */
const REPS_VALUES = Array.from({ length: 21 }, (_, i) => i)
const formatMainReps = (v: number | null) => (v === 0 ? "miss" : v == null ? "—" : String(v))
const RPE_VALUES: (number | null)[] = [
  null,
  ...Array.from({ length: 19 }, (_, i) => 1 + i * 0.5),
]
const EXTRA_KG_VALUES = Array.from(
  { length: Math.floor(150 / 2.5) + 1 },
  (_, i) => i * 2.5
)
const EXTRA_REPS_VALUES = Array.from({ length: 30 }, (_, i) => i + 1)
/** Every minute up to an hour, then coarser — nobody dials 73 minutes one click at a time. */
const CARDIO_MIN_VALUES = [
  ...Array.from({ length: 60 }, (_, i) => i + 1),
  ...Array.from({ length: 12 }, (_, i) => 65 + i * 5),
]

interface LogSessionModalProps {
  session: Session
  onConfirm: (session: Session) => void
  onClose: () => void
  onMinimize?: () => void
  mode?: "log" | "edit"
  previousSessions?: Session[]
  initialDraft?: SessionDraft
  exerciseConfig: MuscleGroupConfig[]
  mainLiftLabel: string
}

interface EditableSet extends MainLiftSet {
  _kgStr: string
  _repsStr: string
  _rpeStr: string
}

interface EditableExtraSet {
  kgStr: string
  repsStr: string
  /**
   * Minutes, on a cardio set only. Its presence is what makes the card show a
   * duration dial instead of kg x reps, and what makes `handleConfirm` write the set
   * out as timed work — so it is set once, when the exercise is seeded, and kept
   * through every edit.
   */
  minutesStr?: string
  /**
   * The optional cardio numbers, each present only while its chip is on. Turning a
   * chip off drops the string, which is what keeps the field out of the logged set.
   */
  distanceStr?: string
  speedStr?: string
  inclineStr?: string
  /**
   * Seeded, never touched by the user. A pristine set follows the set above it as
   * that one is dialled in, so a brand-new exercise only has to be typed once.
   * Anything the user edits — or adds by hand — stops following.
   */
  pristine?: boolean
}

type ExtraWorkoutState = Record<string, Record<string, EditableExtraSet[]>>

/** The `EditableExtraSet` key holding a cardio field while it is being dialled in. */
const CARDIO_FIELD_KEY: Record<CardioField, "distanceStr" | "speedStr" | "inclineStr"> = {
  distance: "distanceStr",
  speed: "speedStr",
  incline: "inclineStr",
}

/** The fields a set is currently logging, in display order. */
function activeCardioFields(set: EditableExtraSet | undefined): CardioField[] {
  if (!set) return []
  return CARDIO_FIELDS.filter((f) => set[CARDIO_FIELD_KEY[f]] != null)
}

/** The bout as numbers, for the derived line and the "last" preview. */
function cardioSetValues(set: EditableExtraSet) {
  const num = (raw?: string) => (raw != null ? parseFloat(raw) || 0 : undefined)
  return {
    minutes: num(set.minutesStr),
    distance: num(set.distanceStr),
    speed: num(set.speedStr),
    incline: num(set.inclineStr),
  }
}

type CarouselItem =
  | { type: "main"; set: EditableSet; globalIndex: number }
  | { type: "extra"; muscle: MuscleGroup; exercise: string; setIndex: number }

type ExerciseGroup =
  | { kind: "main" }
  | { kind: "extra"; muscle: MuscleGroup; exercise: string }

function groupId(g: ExerciseGroup): string {
  return g.kind === "main" ? "main" : `extra-${g.muscle}-${g.exercise}`
}

function buildDefaultOrder(
  session: Session,
  exerciseConfig: MuscleGroupConfig[],
  exclude?: string
): ExerciseGroup[] {
  // A Free (Balanced-mode) session carries no main-lift sets, so it gets no main group.
  const order: ExerciseGroup[] = session.sets.length > 0 ? [{ kind: "main" }] : []
  const selected = session.selectedMuscleGroups ?? []
  for (const muscle of selected) {
    for (const exercise of getSessionExercisesForMuscle(exerciseConfig, muscle, { exclude })) {
      order.push({ kind: "extra", muscle, exercise })
    }
  }
  // Logged cardio is not among the muscle groups, so it is ordered from the bouts.
  for (const workout of session.extraWorkouts ?? []) {
    if (selected.includes(workout.muscle) || !isCardioMuscle(exerciseConfig, workout.muscle)) continue
    for (const exercise of workout.exercises) {
      order.push({ kind: "extra", muscle: workout.muscle, exercise: exercise.name })
    }
  }
  return order
}

/**
 * The exercise a muscle group should not repeat, because the session already opens with
 * it as its own main lift. Undefined for a Balanced session, which has no main lift.
 *
 * A session that already carries it as a logged accessory keeps it — dropping it there
 * would hide work the user did.
 */
function mainLiftDuplicate(session: Session, mainLiftLabel: string): string | undefined {
  if (session.sets.length === 0) return undefined
  const logged = (session.extraWorkouts ?? []).some((w) =>
    w.exercises.some((e) => e.name === mainLiftLabel)
  )
  return logged ? undefined : mainLiftLabel
}

function buildCarouselItems(
  order: ExerciseGroup[],
  sets: EditableSet[],
  extraState: ExtraWorkoutState
): CarouselItem[] {
  return order.flatMap((group): CarouselItem[] => {
    if (group.kind === "main") {
      return sets.map((set, i) => ({ type: "main" as const, set, globalIndex: i }))
    }
    return (extraState[group.muscle]?.[group.exercise] ?? []).map((_, setIndex) => ({
      type: "extra" as const,
      muscle: group.muscle,
      exercise: group.exercise,
      setIndex,
    }))
  })
}

function SortableGroupRow({
  id,
  group,
  sets,
  extraState,
  completedSets,
  exerciseConfig,
  mainLiftLabel,
  onDelete,
}: {
  id: string
  group: ExerciseGroup
  sets: EditableSet[]
  extraState: ExtraWorkoutState
  completedSets: Set<string>
  exerciseConfig: MuscleGroupConfig[]
  mainLiftLabel: string
  onDelete?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  const label =
    group.kind === "main"
      ? mainLiftLabel
      : `${getMuscleLabel(exerciseConfig, group.muscle)} · ${group.exercise}`

  const isCardio = group.kind === "extra" && isCardioMuscle(exerciseConfig, group.muscle)

  let count: number
  let completedCount: number
  let topKg: number | null = null
  let topReps: number | null = null
  let topCardio: EditableExtraSet | null = null

  if (group.kind === "main") {
    count = sets.length
    const completedMain = sets.filter(s => completedSets.has(s.id))
    completedCount = completedMain.length
    const topSet = completedMain
      .filter(s => !s.isWarmup)
      .reduce<EditableSet | null>((best, s) =>
        !best || s.kg > best.kg || (s.kg === best.kg && s.reps > best.reps) ? s : best
      , null)
    if (topSet) { topKg = topSet.kg; topReps = topSet.reps }
  } else {
    const extraSets = extraState[group.muscle]?.[group.exercise] ?? []
    count = extraSets.length
    const completedExtra = extraSets.filter((_, i) =>
      completedSets.has(`extra-${group.muscle}-${group.exercise}-${i}`)
    )
    completedCount = completedExtra.length
    if (isCardio) {
      // A cardio row reads as the time put in, so its "top" is the longest bout.
      const longest = completedExtra.reduce<EditableExtraSet | null>((best, s) => {
        const mins = parseFloat(s.minutesStr ?? "0") || 0
        return !best || mins > (parseFloat(best.minutesStr ?? "0") || 0) ? s : best
      }, null)
      if (longest && (parseFloat(longest.minutesStr ?? "0") || 0) > 0) topCardio = longest
    } else {
      const topSet = completedExtra.reduce<EditableExtraSet | null>((best, s) => {
        const kg = parseFloat(s.kgStr)
        const bkg = best ? parseFloat(best.kgStr) : -1
        return kg > bkg || (kg === bkg && parseInt(s.repsStr) > parseInt(best!.repsStr)) ? s : best
      }, null)
      if (topSet) { topKg = parseFloat(topSet.kgStr); topReps = parseInt(topSet.repsStr) }
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 py-3.5 px-1 border-b border-[#f0f0f0] select-none ${
        isDragging ? "bg-[#f9f9f9] shadow-sm rounded-lg z-10 relative" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-[#cccccc] touch-none cursor-grab active:cursor-grabbing p-1 shrink-0"
        aria-label="Drag to reorder"
      >
        <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
          <circle cx="3" cy="3" r="1.5" />
          <circle cx="9" cy="3" r="1.5" />
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="9" cy="8" r="1.5" />
          <circle cx="3" cy="13" r="1.5" />
          <circle cx="9" cy="13" r="1.5" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#111111] truncate">{label}</p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {count <= 10 && Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full shrink-0 ${
                i < completedCount ? "bg-[#1e3a5f]" : "bg-[#e0e0e0]"
              }`}
            />
          ))}
          <span className="text-[11px] text-[#aaaaaa] ml-0.5">{completedCount} / {count}</span>
        </div>
        {topCardio !== null ? (
          <p className="text-[10px] text-[#1e3a5f] mt-0.5 font-medium">
            {formatCardioSet(cardioSetValues(topCardio))}
          </p>
        ) : topKg !== null && topReps !== null ? (
          <p className="text-[10px] text-[#1e3a5f] mt-0.5 font-medium">
            Top: {topKg} × {topReps}
          </p>
        ) : null}
      </div>
      {onDelete && (
        <button
          onClick={onDelete}
          className="text-[#cccccc] hover:text-red-400 transition-colors p-1 shrink-0"
          aria-label="Delete exercise"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      )}
    </div>
  )
}

function toEditable(set: MainLiftSet): EditableSet {
  return {
    ...set,
    _kgStr: String(set.kg),
    _repsStr: String(set.reps),
    _rpeStr: set.rpe != null ? String(set.rpe) : "",
  }
}

/**
 * What an exercise with no history opens at. Deliberately a real starting point
 * rather than 0 × 0: every set of a fresh exercise mirrors this one until it is
 * edited, so correcting the first set corrects them all.
 */
function defaultExtraSet(cardioFields?: CardioField[]): EditableExtraSet {
  if (!cardioFields) return { kgStr: "10", repsStr: "10", pristine: true }
  const set: EditableExtraSet = {
    kgStr: "0",
    repsStr: "0",
    minutesStr: String(DEFAULT_CARDIO_MINUTES),
    pristine: true,
  }
  for (const field of cardioFields.slice(0, MAX_CARDIO_FIELDS)) {
    set[CARDIO_FIELD_KEY[field]] = String(CARDIO_FIELD_DEFAULT[field])
  }
  return set
}

/** A copy of a set, as the next set: same numbers, and no longer following. */
function copyExtraSet(set: EditableExtraSet): EditableExtraSet {
  const copy: EditableExtraSet = { kgStr: set.kgStr, repsStr: set.repsStr }
  if (set.minutesStr != null) copy.minutesStr = set.minutesStr
  // The next bout logs the same things as this one — chips are per exercise, not per set.
  for (const field of activeCardioFields(set)) {
    copy[CARDIO_FIELD_KEY[field]] = set[CARDIO_FIELD_KEY[field]]
  }
  return copy
}

/**
 * The sets an exercise opens with: last session's, extended by repeating its final
 * set when the exercise is prescribed more sets than were logged last time. With no
 * history at all, every set mirrors the neutral default until one is edited.
 */
function seedExerciseSets(
  exerciseName: string,
  numSets: number,
  previousSessions: Session[],
  cardioFields?: CardioField[]
): EditableExtraSet[] {
  const lastSets = getLastSetsForExercise(exerciseName, previousSessions)
  if (!lastSets || lastSets.length === 0) {
    return Array.from({ length: numSets }, () => defaultExtraSet(cardioFields))
  }
  return Array.from({ length: numSets }, (_, i) => {
    const source = lastSets[Math.min(i, lastSets.length - 1)]
    const set: EditableExtraSet = { kgStr: String(source.kg), repsStr: String(source.reps) }
    // History decides the numbers, but the config decides the kind: an exercise moved
    // into the cardio library still opens as a duration, at whatever it last ran for.
    if (cardioFields) {
      set.minutesStr = String(source.minutes ?? DEFAULT_CARDIO_MINUTES)
      // What the last bout logged is what this one opens with — that is what makes a
      // chip stick. The config's own fields are only the fallback for a bout that
      // predates them, or one logged before the exercise moved into cardio.
      const fromHistory = CARDIO_FIELDS.filter((f) => source[f] != null)
      const fields = fromHistory.length > 0 ? fromHistory : cardioFields
      for (const field of fields.slice(0, MAX_CARDIO_FIELDS)) {
        set[CARDIO_FIELD_KEY[field]] = String(source[field] ?? CARDIO_FIELD_DEFAULT[field])
      }
    }
    // Only the repeats follow; a set that came from history is already its own.
    return i < lastSets.length ? set : { ...set, pristine: true }
  })
}

function initExtraWorkoutState(
  session: Session,
  exerciseConfig: MuscleGroupConfig[],
  previousSessions: Session[] = [],
  exclude?: string
): ExtraWorkoutState {
  const groups = session.selectedMuscleGroups ?? []

  // Checked before the empty-groups bail-out: a cardio-only session has logged bouts
  // but no muscle groups.
  if (session.extraWorkouts && session.extraWorkouts.length > 0) {
    const state: ExtraWorkoutState = {}
    for (const workout of session.extraWorkouts) {
      state[workout.muscle] = {}
      for (const exercise of workout.exercises) {
        state[workout.muscle][exercise.name] = exercise.sets.map((s) => {
          const set: EditableExtraSet = { kgStr: String(s.kg), repsStr: String(s.reps) }
          if (s.minutes != null) set.minutesStr = String(s.minutes)
          for (const field of CARDIO_FIELDS) {
            if (s[field] != null) set[CARDIO_FIELD_KEY[field]] = String(s[field])
          }
          return set
        })
      }
    }
    return state
  }
  if (groups.length === 0) return {}

  const state: ExtraWorkoutState = {}
  for (const muscle of groups) {
    state[muscle] = {}
    const muscleGroup = exerciseConfig.find((g) => g.id === muscle)
    const cardio = isCardioMuscle(exerciseConfig, muscle)
    for (const exerciseName of getSessionExercisesForMuscle(exerciseConfig, muscle, { exclude })) {
      const exConfig = muscleGroup?.exercises.find((e) => e.name === exerciseName)
      const numSets = exConfig ? getDefaultSets(exConfig) : 3
      const fields = cardio ? exConfig?.cardioFields ?? [] : undefined
      state[muscle][exerciseName] = seedExerciseSets(exerciseName, numSets, previousSessions, fields)
    }
  }
  return state
}

function getItemKey(item: CarouselItem): string {
  if (item.type === "main") return item.set.id
  return `extra-${item.muscle}-${item.exercise}-${item.setIndex}`
}

export default function LogSessionModal({
  session,
  onConfirm,
  onClose,
  onMinimize,
  mode = "log",
  previousSessions = [],
  initialDraft,
  exerciseConfig,
  mainLiftLabel,
}: LogSessionModalProps) {
  // Fixed for the life of the modal: the session's main lift does not change mid-log.
  const duplicateOfMainLift = mainLiftDuplicate(session, mainLiftLabel)

  const [sets, setSets] = useState<EditableSet[]>(
    () => initialDraft?.sets ?? session.sets.map(toEditable)
  )
  const [coachNote, setCoachNote] = useState(
    initialDraft?.coachNote ?? session.coachNote
  )
  const [completedSets, setCompletedSets] = useState<Set<string>>(
    () => new Set(initialDraft?.completedSets ?? [])
  )
  const [restEndTime, setRestEndTime] = useState<number | null>(() => {
    const t = initialDraft?.restEndTime ?? null
    return t && t > Date.now() ? t : null
  })
  const [restSeconds, setRestSeconds] = useState(0)
  const restActive = restEndTime !== null
  const [extraState, setExtraState] = useState<ExtraWorkoutState>(
    () =>
      initialDraft?.extraState ??
      initExtraWorkoutState(session, exerciseConfig, previousSessions, duplicateOfMainLift)
  )
  const [currentSetIndex, setCurrentSetIndex] = useState(
    initialDraft?.currentSetIndex ?? 0
  )
  const [exerciseOrder, setExerciseOrder] = useState<ExerciseGroup[]>(
    () => initialDraft?.exerciseOrder ?? buildDefaultOrder(session, exerciseConfig, duplicateOfMainLift)
  )
  const [showExercisesSheet, setShowExercisesSheet] = useState(false)
  const [exercisesSheetTab, setExercisesSheetTab] = useState<"current" | "add">("current")
  const [swapFromMuscle, setSwapFromMuscle] = useState<string | null>(null)
  const [pendingSwap, setPendingSwap] = useState<{ from: string; to: string } | null>(null)
  const [pendingDeleteExercise, setPendingDeleteExercise] = useState<
    { kind: "main" } | { kind: "extra"; muscle: string; exercise: string } | null
  >(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  useEffect(() => {
    if (mode === "edit") return
    saveDraft({
      sessionId: session.id,
      savedAt: new Date().toISOString(),
      sets,
      completedSets: Array.from(completedSets),
      extraState,
      coachNote,
      currentSetIndex,
      exerciseOrder,
    })
  }, [mode, session.id, sets, completedSets, extraState, coachNote, currentSetIndex, exerciseOrder])

  // Cardio is never stored among a session's muscle groups, so bring back any library
  // whose bouts are already in play (editing a logged session, resuming a draft) or
  // its section would not render and the bouts would be dropped on save.
  const [selectedGroups, setSelectedGroups] = useState<string[]>(() => {
    const base = session.selectedMuscleGroups ?? []
    const cardio = Object.keys(extraState).filter(
      (m) => !base.includes(m) && isCardioMuscle(exerciseConfig, m)
    )
    return [...base, ...cardio]
  })

  const carouselItems = buildCarouselItems(exerciseOrder, sets, extraState)
  const hasMain = exerciseOrder.some((g) => g.kind === "main")

  const completedCount = carouselItems.filter((item) =>
    completedSets.has(getItemKey(item))
  ).length
  const allDone = carouselItems.length === 0 || completedCount === carouselItems.length

  // One dash per set, clustered by exercise, for the progress row in the header.
  const progressDashes: ProgressDash[] = (() => {
    let groupKey = ""
    let setNo = 0
    return carouselItems.map((item) => {
      const key = getItemKey(item)
      const group = item.type === "main" ? "main" : `extra-${item.muscle}-${item.exercise}`
      if (group !== groupKey) {
        groupKey = group
        setNo = 0
      }
      setNo++
      const name =
        item.type === "main"
          ? `${mainLiftLabel}${item.set.isWarmup ? " warm-up" : ""}`
          : item.exercise
      const done = completedSets.has(key)
      return {
        key,
        groupKey: group,
        done,
        label: `${name} · set ${setNo}${done ? " (done)" : ""}`,
      }
    })
  })()

  const totalVolume = carouselItems.reduce((sum, item) => {
    if (!completedSets.has(getItemKey(item))) return sum
    if (item.type === "main") return sum + item.set.kg * item.set.reps
    const s = extraState[item.muscle]?.[item.exercise]?.[item.setIndex]
    return s ? sum + parseFloat(s.kgStr) * parseInt(s.repsStr) : sum
  }, 0)

  const notifIdRef = useRef<string | null>(null)
  /** The Done that just finished an exercise, popping before the logger moves on. */
  const [poppingKey, setPoppingKey] = useState<string | null>(null)
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (popTimerRef.current) clearTimeout(popTimerRef.current)
  }, [])

  function handleMinimize() {
    saveDraft({
      sessionId: session.id,
      savedAt: new Date().toISOString(),
      sets,
      completedSets: Array.from(completedSets),
      extraState,
      coachNote,
      currentSetIndex,
      exerciseOrder,
      restEndTime,
    })
    saveMiniPlayer({
      sessionId: session.id,
      label: hasMain ? mainLiftLabel : "Session",
      setsCompleted: completedCount,
      totalSets: carouselItems.length,
      restEndTime: restEndTime,
    })
    window.dispatchEvent(new CustomEvent('mini-player-update'))
    onMinimize?.()
  }

  function playBeep() {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.5)
      osc.onended = () => ctx.close()
    } catch {}
  }

  function cancelNotification() {
    const id = notifIdRef.current
    if (!id) return
    notifIdRef.current = null
    navigator.serviceWorker?.ready.then((reg) => {
      reg.active?.postMessage({ type: "CANCEL", id })
    })
  }

  function scheduleNotification(delay: number, body: string) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return
    if (!navigator.serviceWorker) return
    const id = String(Date.now())
    notifIdRef.current = id
    navigator.serviceWorker.ready.then((reg) => {
      if (notifIdRef.current !== id) return // cancelled before SW was ready
      reg.active?.postMessage({ type: "SCHEDULE", id, delay, title: "Rest done — go!", body, icon: "/apple-icon" })
    })
  }

  useEffect(() => {
    if (restEndTime === null) return

    let done = false
    function tick() {
      const remaining = Math.max(0, Math.ceil((restEndTime! - Date.now()) / 1000))
      setRestSeconds(remaining)
      if (remaining <= 0 && !done) {
        done = true
        cancelNotification()
        playBeep()
        navigator.vibrate?.([300, 100, 300])
        setRestEndTime(null)
      }
    }

    tick() // sync immediately on start
    const id = setInterval(tick, 500) // poll at 2 Hz for smooth display

    // Snap display the moment the tab becomes visible again
    function onVisibilityChange() {
      if (!document.hidden) {
        cancelNotification()
        tick()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [restEndTime])

  /** Whether marking `key` done finishes its exercise: every other set of it is done. */
  function finishesExercise(key: string): boolean {
    const item = carouselItems.find((i) => getItemKey(i) === key)
    if (!item) return false
    const sameExercise = (i: CarouselItem) =>
      item.type === "main"
        ? i.type === "main"
        : i.type === "extra" && i.muscle === item.muscle && i.exercise === item.exercise
    return carouselItems.every(
      (i) => !sameExercise(i) || getItemKey(i) === key || completedSets.has(getItemKey(i))
    )
  }

  /**
   * The Done button. The set that finishes an exercise buzzes harder and pops (a squash
   * and a brand-blue flash) for a moment before the logger moves on to the rest timer.
   * On an iPhone a web app's haptic has one strength, so the extra weight has to be
   * seen. Any other Done moves on at once.
   */
  function tapDone(key: string) {
    if (poppingKey) return
    if (mode === "edit" || completedSets.has(key) || !finishesExercise(key)) {
      afterHapticTap(() => markSetDone(key))
      return
    }
    // The buzz plays now, under the finger; the screen changes once the pop has played.
    buzzSetMoment(setMoment(carouselItems.find((i) => getItemKey(i) === key)), true)
    setPoppingKey(key)
    popTimerRef.current = setTimeout(() => {
      popTimerRef.current = null
      setPoppingKey(null)
      markSetDone(key, true)
    }, DONE_POP_MS)
  }

  function markSetDone(key: string, buzzed = false) {
    if (completedSets.has(key)) {
      setCompletedSets((prev) => { const n = new Set(prev); n.delete(key); return n })
      setRestEndTime(null)
      setRestSeconds(0)
      cancelNotification()
    } else {
      setCompletedSets((prev) => new Set([...prev, key]))
      if (mode !== "edit") {
        const item = carouselItems.find((i) => getItemKey(i) === key)
        reportSetMoment(setMoment(item), { finishesExercise: finishesExercise(key), buzzed })
        const rest = restAfter(item)
        setRestEndTime(Date.now() + rest * 1000)
        setRestSeconds(rest)
        advanceToNextSet()
        const body = nextItem ? getNextPreview(nextItem) : "Last set — great work"
        const doSchedule = () => scheduleNotification(rest * 1000, body)
        if (typeof Notification !== "undefined") {
          if (Notification.permission === "granted") {
            doSchedule()
          } else if (Notification.permission === "default") {
            Notification.requestPermission().then((perm) => {
              if (perm === "granted") doSchedule()
            })
          }
        }
      }
    }
  }

  /**
   * What a set just marked done means for the buzz and for Dot: a new best e1RM, a
   * grinder, or just a set. A best has to beat everything before it, this session's
   * earlier sets included, and Deload sets never count — the same rule the home
   * screen's PR call-out uses.
   */
  function setMoment(item: CarouselItem | undefined): DotMoment {
    if (!item) return { kind: "set" }
    const done = (k: string) => completedSets.has(k)
    const maxOf = (values: (number | null)[]) => {
      const nums = values.filter((v): v is number => v != null)
      return nums.length > 0 ? Math.max(...nums) : null
    }

    if (item.type === "main") {
      const set = item.set
      if (set.isWarmup) return { kind: "set" }
      const counts = session.type !== "Deload"
      const e1rm = calcE1RM(set.kg, set.reps)
      const history = getBestE1RM(previousSessions)
      const earlier = sets
        .filter((s) => s.id !== set.id && !s.isWarmup && done(s.id))
        .map((s) => calcE1RM(s.kg, s.reps))
      const bestBefore = counts && history != null ? maxOf([history, ...earlier]) : null
      const kind = classifySet({
        e1rm: counts ? e1rm : null,
        bestBefore,
        rpe: set.rpe,
        reps: set.reps,
        plannedReps: session.sets.find((s) => s.id === set.id)?.reps ?? null,
      })
      return { kind }
    }

    const all = extraState[item.muscle]?.[item.exercise] ?? []
    const e1rmOf = (s: EditableExtraSet | undefined) => {
      if (!s || s.minutesStr != null) return null
      const kg = parseFloat(s.kgStr)
      const reps = parseInt(s.repsStr)
      return kg > 0 && reps > 0 ? calcE1RM(kg, reps) : null
    }
    const e1rm = e1rmOf(all[item.setIndex])
    const history = getBestE1RMForExercise(item.exercise, previousSessions)
    const earlier = all.map((s, i) =>
      i !== item.setIndex && done(getItemKey({ ...item, setIndex: i })) ? e1rmOf(s) : null
    )
    const bestBefore = history != null ? maxOf([history, ...earlier]) : null
    return { kind: classifySet({ e1rm, bestBefore, rpe: null, reps: 0, plannedReps: null }) }
  }

  function restAfter(item: CarouselItem | undefined): number {
    if (!item) return REST_SECONDS.main
    if (item.type === "main") return item.set.isWarmup ? REST_SECONDS.warmup : REST_SECONDS.main
    const set = extraState[item.muscle]?.[item.exercise]?.[item.setIndex]
    return set?.minutesStr != null ? REST_SECONDS.cardio : REST_SECONDS.accessory
  }

  /** Rest runs in the banner, so the logger moves on to the next open set right away. */
  function advanceToNextSet() {
    setCurrentSetIndex((prev) => {
      for (let i = prev + 1; i < carouselItems.length; i++) {
        if (!completedSets.has(getItemKey(carouselItems[i]))) return i
      }
      return Math.min(prev + 1, carouselItems.length - 1)
    })
  }

  function dismissRest() {
    cancelNotification()
    setRestEndTime(null)
    setRestSeconds(0)
  }

  function navigatePrev() {
    setCurrentSetIndex((p) => Math.max(p - 1, 0))
    navigator.vibrate?.([8])
  }

  function navigateNext() {
    setCurrentSetIndex((p) => Math.min(p + 1, carouselItems.length - 1))
    navigator.vibrate?.([8])
  }

  function updateSet(index: number, field: "kg" | "reps" | "rpe", raw: string) {
    setSets((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s
        const updated = { ...s }
        if (field === "kg") {
          updated._kgStr = raw
          const val = parseFloat(raw)
          if (!isNaN(val) && val > 0) {
            updated.kg = val
            updated.e1rm = calcE1RM(val, updated.reps)
          }
        } else if (field === "reps") {
          updated._repsStr = raw
          const val = parseInt(raw, 10)
          if (!isNaN(val) && val >= 0) {
            updated.reps = val
            updated.e1rm = calcE1RM(updated.kg, val)
          }
        } else {
          updated._rpeStr = raw
          const val = parseFloat(raw)
          updated.rpe = isNaN(val) ? null : Math.min(10, Math.max(1, val))
        }
        return updated
      })
    )
  }

  function updateExtraSet(
    muscle: string,
    exercise: string,
    setIndex: number,
    field: "kg" | "reps" | "minutes" | CardioField,
    raw: string
  ) {
    setExtraState((prev) => {
      const next = { ...prev }
      next[muscle] = { ...next[muscle] }
      const arr = next[muscle][exercise]
      const key =
        field === "kg"
          ? "kgStr"
          : field === "reps"
            ? "repsStr"
            : field === "minutes"
              ? "minutesStr"
              : CARDIO_FIELD_KEY[field]
      const edited: EditableExtraSet = { ...arr[setIndex], [key]: raw, pristine: false }

      // Sets below that are still untouched trail the one being dialled in, so
      // typing set 1 of a new exercise fills the rest of it.
      let trailing = true
      next[muscle][exercise] = arr.map((s, i) => {
        if (i === setIndex) return edited
        if (i < setIndex) return s
        if (!trailing || !s.pristine) {
          trailing = false
          return s
        }
        if (s.minutesStr == null) {
          return { ...s, kgStr: edited.kgStr, repsStr: edited.repsStr }
        }
        const followed: EditableExtraSet = { ...s, minutesStr: edited.minutesStr }
        for (const f of CARDIO_FIELDS) {
          if (s[CARDIO_FIELD_KEY[f]] != null) followed[CARDIO_FIELD_KEY[f]] = edited[CARDIO_FIELD_KEY[f]]
        }
        return followed
      })
      return next
    })
  }

  /**
   * Turn an optional cardio number on or off for an exercise.
   *
   * Applied to every bout of it at once: the chips say what this exercise records, not
   * what one particular bout did, so a two-bout treadmill entry can't end up half
   * logging incline. Switching one on seeds it from the first bout that already has a
   * value, so toggling by accident costs nothing.
   */
  function toggleCardioField(muscle: string, exercise: string, field: CardioField) {
    const key = CARDIO_FIELD_KEY[field]
    setExtraState((prev) => {
      const arr = prev[muscle]?.[exercise]
      if (!arr || arr.length === 0) return prev
      const turningOff = arr.some((s) => s[key] != null)
      if (!turningOff && activeCardioFields(arr[0]).length >= MAX_CARDIO_FIELDS) return prev
      const seed = arr.find((s) => s[key] != null)?.[key] ?? String(CARDIO_FIELD_DEFAULT[field])
      const next = { ...prev }
      next[muscle] = {
        ...next[muscle],
        [exercise]: arr.map((s) => {
          const updated = { ...s }
          if (turningOff) delete updated[key]
          else updated[key] = seed
          return updated
        }),
      }
      return next
    })
  }

  function nextSetId(currentSets: EditableSet[], isWarmup: boolean): string {
    const prefix = isWarmup ? "W" : "S"
    const max = currentSets.reduce((m, s) => {
      const match = s.id.match(new RegExp(`^${prefix}(\\d+)$`))
      return match ? Math.max(m, parseInt(match[1])) : m
    }, 0)
    return `${prefix}${max + 1}`
  }

  function addSetAfterCurrent(globalIndex: number) {
    setSets((prev) => {
      const current = prev[globalIndex]
      const newSet: EditableSet = {
        ...current,
        id: nextSetId(prev, current.isWarmup),
        note: "",
      }
      const next = [...prev]
      next.splice(globalIndex + 1, 0, newSet)
      return next
    })
    setCurrentSetIndex((p) => p + 1)
  }

  /**
   * Where the carousel lands after deleting the current set. Back on the set before it
   * when that one is still to do — the set you were on before "Add set after" put you
   * on the one now being removed — otherwise on the set that slides into its place.
   */
  function indexAfterDelete(prev: number): number {
    const before = carouselItems[prev - 1]
    if (before && !completedSets.has(getItemKey(before))) return prev - 1
    return Math.max(0, Math.min(prev, carouselItems.length - 2))
  }

  function deleteCurrentSet(globalIndex: number, setId: string) {
    if (sets.length <= 1) return
    setSets((prev) => prev.filter((_, i) => i !== globalIndex))
    setCompletedSets((prev) => {
      const next = new Set(prev)
      next.delete(setId)
      return next
    })
    setCurrentSetIndex(indexAfterDelete)
  }

  function addExtraSetAfter(muscle: string, exercise: string, setIndex: number) {
    setExtraState((prev) => {
      const next = { ...prev }
      next[muscle] = { ...next[muscle] }
      const arr = [...next[muscle][exercise]]
      arr.splice(setIndex + 1, 0, copyExtraSet(arr[setIndex]))
      next[muscle][exercise] = arr
      return next
    })
    setCompletedSets((prev) => {
      const prefix = `extra-${muscle}-${exercise}-`
      const next = new Set<string>()
      for (const key of prev) {
        if (!key.startsWith(prefix)) { next.add(key); continue }
        const idx = parseInt(key.slice(prefix.length))
        next.add(idx > setIndex ? `${prefix}${idx + 1}` : key)
      }
      return next
    })
    setCurrentSetIndex((p) => p + 1)
  }

  function deleteExtraSet(muscle: string, exercise: string, setIndex: number) {
    if ((extraState[muscle]?.[exercise]?.length ?? 0) <= 1) return
    setExtraState((prev) => {
      const next = { ...prev }
      next[muscle] = { ...next[muscle] }
      next[muscle][exercise] = next[muscle][exercise].filter((_, i) => i !== setIndex)
      return next
    })
    setCompletedSets((prev) => {
      const prefix = `extra-${muscle}-${exercise}-`
      const next = new Set<string>()
      for (const key of prev) {
        if (!key.startsWith(prefix)) { next.add(key); continue }
        const idx = parseInt(key.slice(prefix.length))
        if (idx === setIndex) continue
        next.add(idx > setIndex ? `${prefix}${idx - 1}` : key)
      }
      return next
    })
    setCurrentSetIndex(indexAfterDelete)
  }

  function deleteSet(globalIndex: number, setId: string) {
    if (sets.length <= 1) return
    setSets((prev) => prev.filter((_, i) => i !== globalIndex))
    setCompletedSets((prev) => { const n = new Set(prev); n.delete(setId); return n })
  }

  function addExerciseToMuscle(muscleId: string, exerciseName: string) {
    setSelectedGroups((prev) => (prev.includes(muscleId) ? prev : [...prev, muscleId]))
    setExtraState((prev) => {
      const muscleExercises = prev[muscleId] ?? {}
      if (muscleExercises[exerciseName]) return prev
      const muscleGroup = exerciseConfig.find((g) => g.id === muscleId)
      const exConfig = muscleGroup?.exercises.find((e) => e.name === exerciseName)
      const count = exConfig ? getDefaultSets(exConfig) : 3
      const cardio = isCardioMuscle(exerciseConfig, muscleId)
      const fields = cardio ? exConfig?.cardioFields ?? [] : undefined
      return {
        ...prev,
        [muscleId]: {
          ...muscleExercises,
          [exerciseName]: seedExerciseSets(exerciseName, count, previousSessions, fields),
        },
      }
    })
    setExerciseOrder((prev) =>
      prev.some((g) => g.kind === "extra" && g.muscle === muscleId && g.exercise === exerciseName)
        ? prev
        : [...prev, { kind: "extra", muscle: muscleId, exercise: exerciseName }]
    )
  }

  function addMuscleGroup(muscleId: string) {
    // Same list a fresh session would open the group with, so "Add all" on Chest does
    // not hand back the main lift the session already covers. Adding that one
    // deliberately from the row below still works.
    for (const name of getSessionExercisesForMuscle(exerciseConfig, muscleId, {
      exclude: duplicateOfMainLift,
    })) {
      addExerciseToMuscle(muscleId, name)
    }
  }

  function removeMuscleGroup(muscleId: string) {
    setSelectedGroups((prev) => prev.filter((g) => g !== muscleId))
    setExtraState((prev) => {
      const next = { ...prev }
      delete next[muscleId]
      return next
    })
    setExerciseOrder((prev) =>
      prev.filter((g) => !(g.kind === "extra" && g.muscle === muscleId))
    )
    setCompletedSets((prev) => {
      const prefix = `extra-${muscleId}-`
      const next = new Set<string>()
      for (const key of prev) {
        if (!key.startsWith(prefix)) next.add(key)
      }
      return next
    })
  }

  function swapMuscleGroup(fromId: string, toId: string) {
    removeMuscleGroup(fromId)
    addMuscleGroup(toId)
    setPendingSwap(null)
  }

  function deleteExercise(muscle: string, exercise: string) {
    const willBeEmpty = Object.keys(extraState[muscle] ?? {}).filter(e => e !== exercise).length === 0

    setExtraState((prev) => {
      const next = { ...prev }
      if (willBeEmpty) {
        delete next[muscle]
      } else {
        const muscleExercises = { ...next[muscle] }
        delete muscleExercises[exercise]
        next[muscle] = muscleExercises
      }
      return next
    })

    if (willBeEmpty) {
      setSelectedGroups((prev) => prev.filter(g => g !== muscle))
    }

    setExerciseOrder((prev) =>
      prev.filter(g => !(g.kind === "extra" && g.muscle === muscle && g.exercise === exercise))
    )

    setCompletedSets((prev) => {
      const prefix = `extra-${muscle}-${exercise}-`
      const next = new Set<string>()
      for (const key of prev) {
        if (!key.startsWith(prefix)) next.add(key)
      }
      return next
    })

    setCurrentSetIndex((prev) => Math.max(0, Math.min(prev, carouselItems.length - 2)))
    setPendingDeleteExercise(null)
  }

  function deleteMainExercise() {
    if (mainLiftLabel === MAIN_LIFT_LABEL.bench) {
      setPendingDeleteExercise(null)
      return
    }
    setSets([])
    setCompletedSets((prev) => {
      const next = new Set<string>()
      for (const key of prev) {
        if (key.startsWith("extra-")) next.add(key)
      }
      return next
    })
    setExerciseOrder((prev) => prev.filter(g => g.kind !== "main"))
    setCurrentSetIndex(0)
    setPendingDeleteExercise(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setExerciseOrder((prev) => {
      const oldIdx = prev.findIndex((g) => groupId(g) === active.id)
      const newIdx = prev.findIndex((g) => groupId(g) === over.id)
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  function closeExercisesSheet() {
    setShowExercisesSheet(false)
    setSwapFromMuscle(null)
    const items = buildCarouselItems(exerciseOrder, sets, extraState)
    const first = items.findIndex((item) => !completedSets.has(getItemKey(item)))
    setCurrentSetIndex(first >= 0 ? first : 0)
  }

  function handleConfirm() {
    const trainedGroups = selectedGroups.filter((g) => !isCardioMuscle(exerciseConfig, g))
    const extraWorkouts: ExtraWorkout[] = selectedGroups
      .filter((muscle) => extraState[muscle])
      .map((muscle) => ({
        muscle,
        exercises: Object.entries(extraState[muscle])
          .filter(([, sets]) => sets.length > 0)
          .map(([name, sets]) => ({
            name,
            sets: sets.map((s) =>
              s.minutesStr != null
                ? {
                    kg: 0,
                    reps: 0,
                    rpe: null,
                    minutes: parseFloat(s.minutesStr) || 0,
                    ...Object.fromEntries(
                      activeCardioFields(s).map((f) => [f, parseFloat(s[CARDIO_FIELD_KEY[f]]!) || 0])
                    ),
                  }
                : {
                    kg: parseFloat(s.kgStr) || 0,
                    reps: parseInt(s.repsStr, 10) || 0,
                    rpe: null,
                  }
            ),
          })),
      }))

    const finalSession: Session = {
      ...session,
      confirmed: true,
      date: mode === "edit" ? session.date : new Date().toISOString(),
      coachNote,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      sets: sets.map(({ _kgStr: _, _repsStr: __, _rpeStr: ___, ...rest }) => rest),
      extraWorkouts: extraWorkouts.length > 0 ? extraWorkouts : undefined,
      // Cardio rides along in selectedGroups so its section renders, but it is not a
      // muscle trained: the logged bouts live in extraWorkouts, not the day's label.
      selectedMuscleGroups: trainedGroups.length > 0 ? trainedGroups : undefined,
    }
    clearDraft()
    onConfirm(finalSession)
  }

  const timerMins = Math.floor(restSeconds / 60)
  const timerSecs = restSeconds % 60
  const timerDisplay = `${timerMins}:${String(timerSecs).padStart(2, "0")}`

  const currentItem = carouselItems[currentSetIndex]
  const nextItem = carouselItems[currentSetIndex + 1] ?? null

  function getNextPreview(item: CarouselItem): string {
    if (item.type === "main") {
      return item.set.isWarmup
        ? `${item.set.id} · ${item.set.kg}kg × ${item.set.reps} (warm-up)`
        : `${item.set.id} · ${item.set.kg}kg × ${item.set.reps}`
    }
    const set = extraState[item.muscle]?.[item.exercise]?.[item.setIndex]
    return set?.minutesStr != null
      ? `${item.exercise} · ${formatCardioSet(cardioSetValues(set))}`
      : `${item.exercise} · Set ${item.setIndex + 1}`
  }

  const availableGroups = sortedMuscleGroups(exerciseConfig).filter(
    (g) => !selectedGroups.includes(g.id)
  )

  const exercisesSheet = showExercisesSheet ? (
    <>
      <div className="absolute inset-0 bg-black/20 z-10" onClick={closeExercisesSheet} />
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.10)] flex flex-col z-20 max-h-[75%]">
        <div className="flex justify-center pt-3 shrink-0">
          <div className="w-9 h-1 bg-[#e0e0e0] rounded-full" />
        </div>
        <div className="pt-3 pb-2 px-4 flex items-center justify-between shrink-0">
          <p className="text-[10px] uppercase tracking-widest font-medium text-[#aaaaaa]">
            Exercises
          </p>
          <button onClick={closeExercisesSheet} className="text-sm font-semibold text-[#1e3a5f]">
            Done
          </button>
        </div>
        <div className="px-4 pb-3 flex gap-1.5 shrink-0">
          <button
            onClick={() => setExercisesSheetTab("current")}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              exercisesSheetTab === "current"
                ? "bg-[#111111] text-white"
                : "bg-[#f5f5f5] text-[#777777] hover:bg-[#ebebeb]"
            }`}
          >
            Current
          </button>
          <button
            onClick={() => setExercisesSheetTab("add")}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              exercisesSheetTab === "add"
                ? "bg-[#111111] text-white"
                : "bg-[#f5f5f5] text-[#777777] hover:bg-[#ebebeb]"
            }`}
          >
            Add
          </button>
        </div>

        {exercisesSheetTab === "current" && (
          <>
            <div className="px-4 py-2.5 border-y border-[#f0f0f0] flex items-center gap-2 shrink-0">
              <span className="text-[12px] font-semibold text-[#111111]">
                {completedCount} / {carouselItems.length} sets
              </span>
              <span className="text-[#dddddd]">·</span>
              <span className="text-[12px] text-[#777777]">
                {totalVolume.toLocaleString()} kg volume
              </span>
            </div>
            {selectedGroups.length > 0 && (
              <div className="px-4 py-3 border-b border-[#f0f0f0] shrink-0 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-[#aaaaaa] font-medium">
                  Muscle groups
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedGroups.map((muscleId) => (
                    <div key={muscleId} className="flex items-center gap-1 rounded-full bg-[#f5f5f5] pl-3 pr-1 py-1">
                      <span className="text-xs font-medium text-[#333333]">
                        {getMuscleLabel(exerciseConfig, muscleId)}
                      </span>
                      {availableGroups.length > 0 && (
                        <button
                          onClick={() => setSwapFromMuscle(swapFromMuscle === muscleId ? null : muscleId)}
                          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full transition-colors ${
                            swapFromMuscle === muscleId
                              ? "bg-[#1e3a5f] text-white"
                              : "text-[#777777] hover:text-[#111111]"
                          }`}
                        >
                          Swap
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {swapFromMuscle && (
                  <div className="rounded-xl border border-[#e8e8e8] p-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-[#aaaaaa] font-medium px-2 pt-1 pb-0.5">
                      Swap {getMuscleLabel(exerciseConfig, swapFromMuscle)} with…
                    </p>
                    {availableGroups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setPendingSwap({ from: swapFromMuscle, to: g.id })}
                        className="w-full text-left px-2 py-2 rounded-lg hover:bg-[#f5f5f5] text-sm text-[#111111]"
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto py-1 px-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={exerciseOrder.map(groupId)}
                  strategy={verticalListSortingStrategy}
                >
                  {exerciseOrder.map((group) => {
                    const isBenchMain = group.kind === "main" && mainLiftLabel === MAIN_LIFT_LABEL.bench
                    return (
                      <SortableGroupRow
                        key={groupId(group)}
                        id={groupId(group)}
                        group={group}
                        sets={sets}
                        extraState={extraState}
                        completedSets={completedSets}
                        exerciseConfig={exerciseConfig}
                        mainLiftLabel={mainLiftLabel}
                        onDelete={isBenchMain
                          ? undefined
                          : group.kind === "extra"
                            ? () => setPendingDeleteExercise({ kind: "extra", muscle: group.muscle, exercise: group.exercise })
                            : () => setPendingDeleteExercise({ kind: "main" })}
                      />
                    )
                  })}
                </SortableContext>
              </DndContext>
            </div>
          </>
        )}

        {exercisesSheetTab === "add" && (
          <div className="flex-1 overflow-y-auto py-3 px-4 space-y-3 border-t border-[#f0f0f0]">
            {[...sortedMuscleGroups(exerciseConfig), ...sortedCardioGroups(exerciseConfig)].map((g) => {
              const present = extraState[g.id] ?? {}
              const allExercises = getExercisesForMuscle(exerciseConfig, g.id)
              const addable = getSessionExercisesForMuscle(exerciseConfig, g.id, {
                exclude: duplicateOfMainLift,
              })
              const allAdded = addable.length > 0 && addable.every((name) => present[name])
              return (
                <div key={g.id} className="rounded-xl border border-[#e8e8e8] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#111111]">{g.name}</p>
                      {g.cardio && (
                        <p className="text-[10px] text-[#aaaaaa] mt-0.5">Logged in minutes</p>
                      )}
                    </div>
                    {!allAdded && (
                      <button
                        onClick={() => addMuscleGroup(g.id)}
                        className="text-[10px] uppercase tracking-wide text-[#1e3a5f] hover:text-[#16304f] font-semibold px-2 py-1"
                      >
                        Add all
                      </button>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {allExercises.map((name) => {
                      const added = !!present[name]
                      return (
                        <div key={name} className="flex items-center justify-between py-1.5">
                          <span className="text-sm text-[#333333]">{name}</span>
                          {added ? (
                            <span className="text-[10px] uppercase tracking-wide text-[#aaaaaa]">Added</span>
                          ) : (
                            <button
                              onClick={() => addExerciseToMuscle(g.id, name)}
                              className="text-[10px] uppercase tracking-wide text-[#1e3a5f] hover:text-[#16304f] font-semibold px-2 py-1"
                            >
                              + Add
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  ) : null

  const swapConfirmation = pendingSwap ? (
    <>
      <div className="absolute inset-0 bg-black/30 z-30" onClick={() => setPendingSwap(null)} />
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] z-40 p-5">
        <p className="text-sm font-semibold text-[#111111] mb-1">Swap muscle group?</p>
        <p className="text-base font-bold text-[#111111]">
          {getMuscleLabel(exerciseConfig, pendingSwap.from)} → {getMuscleLabel(exerciseConfig, pendingSwap.to)}
        </p>
        <p className="text-xs text-[#aaaaaa] mt-1 mb-4">
          All {getMuscleLabel(exerciseConfig, pendingSwap.from)} exercises and sets will be removed and replaced with default {getMuscleLabel(exerciseConfig, pendingSwap.to)} exercises.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setPendingSwap(null)}
            className="flex-1 rounded-xl py-3 text-sm font-semibold bg-[#f5f5f5] text-[#333333] hover:bg-[#ebebeb] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => swapMuscleGroup(pendingSwap.from, pendingSwap.to)}
            className="flex-1 rounded-xl py-3 text-sm font-semibold bg-[#1e3a5f] text-white hover:bg-[#16304f] transition-colors"
          >
            Swap
          </button>
        </div>
      </div>
    </>
  ) : null

  // Edit mode — scrollable full-session list
  if (mode === "edit") {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        <div className="mx-auto w-full max-w-[393px] flex flex-col flex-1 min-h-0 relative">

          {/* Sticky header */}
          <div className="px-4 pt-6 pb-4 shrink-0 border-b border-[#f0f0f0]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#111111]">
                Edit Session {String(session.id).padStart(2, "0")}
              </h2>
              <button
                onClick={onClose}
                className="text-[#777777] hover:text-[#111111] text-xl leading-none px-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-5 space-y-7 pb-12">

              {/* Main lift — absent on Free (Balanced-mode) sessions */}
              {hasMain && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#aaaaaa] font-medium">
                    {mainLiftLabel}
                  </p>
                  {mainLiftLabel !== MAIN_LIFT_LABEL.bench && (
                    <button
                      onClick={() => setPendingDeleteExercise({ kind: "main" })}
                      className="text-xs text-[#bbbbbb] hover:text-red-400 transition-colors px-1"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {sets.map((set, idx) => (
                    <div
                      key={set.id}
                      className="rounded-2xl border border-[#e8e8e8] p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-[#333333]">
                          {set.id}{set.isWarmup ? " · Warm-up" : ""}
                        </span>
                        <button
                          onClick={() => deleteSet(idx, set.id)}
                          disabled={sets.length <= 1}
                          className="text-[11px] text-[#bbbbbb] disabled:opacity-30 hover:text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <DrumRollPicker
                          values={KG_VALUES}
                          selected={set.kg}
                          onChange={(v) => { if (v !== null) updateSet(idx, "kg", String(v)) }}
                          label="kg"
                        />
                        <DrumRollPicker
                          values={REPS_VALUES}
                          selected={set.reps}
                          onChange={(v) => { if (v !== null) updateSet(idx, "reps", String(v)) }}
                          label="reps"
                          format={formatMainReps}
                        />
                        {!set.isWarmup && (
                          <DrumRollPicker
                            values={RPE_VALUES}
                            selected={set.rpe}
                            onChange={(v) => updateSet(idx, "rpe", v === null ? "" : String(v))}
                            label="rpe"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => addSetAfterCurrent(sets.length - 1)}
                  className="mt-2 w-full py-2.5 rounded-xl border border-dashed border-[#e8e8e8] text-xs text-[#aaaaaa] hover:text-[#777777] hover:border-[#aaaaaa] transition-colors"
                >
                  + Add set
                </button>
              </div>
              )}

              {/* Muscle group sections */}
              {selectedGroups.map((muscleId) => (
                <div key={muscleId}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] uppercase tracking-widest text-[#aaaaaa] font-medium">
                      {getMuscleLabel(exerciseConfig, muscleId)}
                    </p>
                    <button
                      onClick={() => removeMuscleGroup(muscleId)}
                      className="text-[10px] uppercase tracking-wide text-[#bbbbbb] hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="space-y-4">
                    {Object.entries(extraState[muscleId] ?? {}).map(([exercise, exerciseSets]) => (
                      <div key={exercise}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-[#333333]">{exercise}</p>
                          <button
                            onClick={() => setPendingDeleteExercise({ kind: "extra", muscle: muscleId, exercise })}
                            className="text-[10px] uppercase tracking-wide text-[#bbbbbb] hover:text-red-400 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                        <div className="space-y-2">
                          {exerciseSets.map((s, i) => (
                            <div key={i} className="rounded-xl border border-[#e8e8e8] p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] text-[#aaaaaa]">Set {i + 1}</span>
                                <button
                                  onClick={() => deleteExtraSet(muscleId, exercise, i)}
                                  disabled={exerciseSets.length <= 1}
                                  className="text-[11px] text-[#bbbbbb] disabled:opacity-30 hover:text-red-400 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                              <div className="flex gap-2">
                                {s.minutesStr != null ? (
                                  <>
                                    <DrumRollPicker
                                      values={CARDIO_MIN_VALUES}
                                      selected={parseFloat(s.minutesStr)}
                                      onChange={(v) => { if (v !== null) updateExtraSet(muscleId, exercise, i, "minutes", String(v)) }}
                                      label="min"
                                    />
                                    {activeCardioFields(s).map((field) => (
                                      <DrumRollPicker
                                        key={field}
                                        values={CARDIO_FIELD_VALUES[field]}
                                        selected={parseFloat(s[CARDIO_FIELD_KEY[field]]!)}
                                        onChange={(v) => { if (v !== null) updateExtraSet(muscleId, exercise, i, field, String(v)) }}
                                        label={CARDIO_FIELD_UNIT[field]}
                                        format={(v) => (v == null ? "—" : formatCardioNumber(v))}
                                      />
                                    ))}
                                  </>
                                ) : (
                                  <>
                                    <DrumRollPicker
                                      values={EXTRA_KG_VALUES}
                                      selected={parseFloat(s.kgStr)}
                                      onChange={(v) => { if (v !== null) updateExtraSet(muscleId, exercise, i, "kg", String(v)) }}
                                      label="kg"
                                    />
                                    <DrumRollPicker
                                      values={EXTRA_REPS_VALUES}
                                      selected={parseInt(s.repsStr, 10)}
                                      onChange={(v) => { if (v !== null) updateExtraSet(muscleId, exercise, i, "reps", String(v)) }}
                                      label="reps"
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => addExtraSetAfter(muscleId, exercise, exerciseSets.length - 1)}
                          className="mt-1.5 w-full py-2 rounded-xl border border-dashed border-[#e8e8e8] text-xs text-[#aaaaaa] hover:text-[#777777] hover:border-[#aaaaaa] transition-colors"
                        >
                          + Add set
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Manage exercises */}
              <button
                onClick={() => { setExercisesSheetTab("add"); setShowExercisesSheet(true) }}
                className="w-full py-3 rounded-2xl border border-dashed border-[#e8e8e8] text-xs font-medium text-[#aaaaaa] hover:text-[#777777] hover:border-[#aaaaaa] transition-colors"
              >
                + Add exercise or muscle group
              </button>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-[#777777] mb-1.5 uppercase tracking-wide">
                  Session Notes
                </label>
                <textarea
                  value={coachNote}
                  onChange={(e) => setCoachNote(e.target.value)}
                  rows={3}
                  placeholder="How did it feel?"
                  className="w-full border border-[#e8e8e8] rounded-lg px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#1e3a5f] resize-none"
                />
              </div>

              <button
                onClick={handleConfirm}
                className="w-full bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-[#16304f] transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>

          {exercisesSheet}
          {swapConfirmation}

          {/* Delete exercise confirmation */}
          {pendingDeleteExercise && (
            <>
              <div className="absolute inset-0 bg-black/30 z-30" onClick={() => setPendingDeleteExercise(null)} />
              <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] z-40 p-5">
                <p className="text-sm font-semibold text-[#111111] mb-1">Remove exercise?</p>
                {pendingDeleteExercise.kind === "main" ? (
                  <>
                    <p className="text-base font-bold text-[#111111]">{mainLiftLabel}</p>
                    <p className="text-xs text-[#aaaaaa] mt-1 mb-4">
                      All sets will be removed. This session will have no main lift.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-bold text-[#111111]">{pendingDeleteExercise.exercise}</p>
                    {(() => {
                      const p = pendingDeleteExercise
                      const willBeEmpty = Object.keys(extraState[p.muscle] ?? {}).filter(e => e !== p.exercise).length === 0
                      return willBeEmpty ? (
                        <p className="text-xs text-[#aaaaaa] mt-1 mb-4">
                          This will also remove the {getMuscleLabel(exerciseConfig, p.muscle)} group.
                        </p>
                      ) : (
                        <div className="mb-4" />
                      )
                    })()}
                  </>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setPendingDeleteExercise(null)}
                    className="flex-1 rounded-xl py-3 text-sm font-semibold bg-[#f5f5f5] text-[#333333] hover:bg-[#ebebeb] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => pendingDeleteExercise.kind === "main"
                      ? deleteMainExercise()
                      : deleteExercise(pendingDeleteExercise.muscle, pendingDeleteExercise.exercise)
                    }
                    className="flex-1 rounded-xl py-3 text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    )
  }

  return (
    <div className={`fixed inset-0 z-50 flex flex-col overflow-hidden transition-colors duration-300 pt-[env(safe-area-inset-top)] ${restActive ? "bg-[#eff6ff]" : "bg-white"}`}>
      {restActive && (
        <div className="w-full bg-[#1e3a5f] flex items-center justify-between px-5 py-3 shrink-0">
          <span className="text-white/50 text-xs uppercase tracking-widest">Resting</span>
          <span className="text-white font-bold tabular-nums text-lg">{timerDisplay}</span>
          <button
            onClick={dismissRest}
            className="text-white/60 text-xs font-semibold hover:text-white/80 active:text-white transition-colors"
          >
            Skip rest
          </button>
        </div>
      )}
      <div className="mx-auto w-full max-w-[393px] px-4 flex flex-col flex-1 min-h-0 relative">

        {/* Header + Progress — pinned at top */}
        <div className="pt-6 pb-4 shrink-0">
          <div className="flex items-center mb-5">
            {mode === "log" && onMinimize && (
              <button
                onClick={handleMinimize}
                className="text-[#777777] hover:text-[#111111] mr-2 p-1 -ml-1"
                aria-label="Minimize"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="5 8 10 13 15 8" />
                </svg>
              </button>
            )}
            <h2 className="flex-1 text-base font-semibold text-[#111111]">
              Log Session {String(session.id).padStart(2, "0")}
            </h2>
            <button
              onClick={onClose}
              className="text-[#777777] hover:text-[#111111] text-xl leading-none px-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {mode === "log" && carouselItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-[#aaaaaa] uppercase tracking-widest">Progress</span>
                <span className="text-[10px] text-[#aaaaaa] tabular-nums">
                  {completedCount} / {carouselItems.length}
                </span>
              </div>
              <SessionProgressDashes
                dashes={progressDashes}
                currentIndex={currentSetIndex}
                onSelect={setCurrentSetIndex}
              />
            </div>
          )}
        </div>

        {/* Centered content area */}
        <div className="flex-1 flex flex-col min-h-0 pb-8">

          {!allDone && carouselItems.length > 0 && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Card — flex-1 so it absorbs remaining space and centers the card */}
              <div className="flex-1 flex flex-col justify-center min-h-0 overflow-hidden">
              <div>
                {/* Main lift set card (warmup or working) */}
                {currentItem?.type === "main" && (() => {
                  const item = currentItem
                  const isDone = completedSets.has(item.set.id)
                  const isWarmup = item.set.isWarmup
                  return (
                    <div
                      data-ledge
                      data-ledge-watch
                      className={`rounded-2xl border-2 p-5 transition-colors ${
                        isDone ? "border-[#1e3a5f]/30 bg-[#1e3a5f]/[0.03]" : "border-[#e8e8e8]"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-widest text-[#aaaaaa] mb-1">
                        {mainLiftLabel}{isWarmup ? " · Warm-up" : ""}
                      </p>
                      <div className="flex items-center justify-between mb-5">
                        <span className="text-3xl font-bold text-[#111111] leading-none">
                          {item.set.id}
                          {isDone && <span className="ml-2 text-[#1e3a5f] text-2xl">✓</span>}
                        </span>
                        {!isWarmup && item.set.e1rm != null && (
                          <span className="text-sm font-semibold text-[#1e3a5f]">
                            e1RM {item.set.e1rm}kg
                          </span>
                        )}
                      </div>

                      {isWarmup ? (
                        <div className="flex items-baseline gap-2 mb-5">
                          <span className="text-2xl font-semibold text-[#333333]">
                            {item.set.kg}kg
                          </span>
                          <span className="text-sm text-[#aaaaaa]">&times; {item.set.reps} reps</span>
                        </div>
                      ) : (
                        <div key={item.set.id} className="flex gap-2 mb-5">
                          <DrumRollPicker
                            values={KG_VALUES}
                            selected={item.set.kg}
                            onChange={(v) => { if (v !== null) updateSet(item.globalIndex, "kg", String(v)) }}
                            label="kg"
                            disabled={isDone}
                          />
                          <DrumRollPicker
                            values={REPS_VALUES}
                            selected={item.set.reps}
                            onChange={(v) => { if (v !== null) updateSet(item.globalIndex, "reps", String(v)) }}
                            label="reps"
                            format={formatMainReps}
                            disabled={isDone}
                          />
                          <DrumRollPicker
                            values={RPE_VALUES}
                            selected={item.set.rpe}
                            onChange={(v) => updateSet(item.globalIndex, "rpe", v === null ? "" : String(v))}
                            label="rpe"
                            disabled={isDone}
                          />
                        </div>
                      )}

                      <button
                        onClick={() => tapDone(item.set.id)}
                        className={`relative w-full rounded-xl py-3.5 text-sm font-semibold transition-[background-color,color,transform] duration-100 active:scale-[0.97] ${
                          poppingKey === item.set.id
                            ? "bg-[#1e3a5f] text-white done-pop"
                            : isDone
                            ? "bg-[#1e3a5f]/10 text-[#1e3a5f] hover:bg-[#1e3a5f]/20 active:bg-[#1e3a5f]/30"
                            : "bg-[#111111] text-white hover:bg-[#333333] active:bg-[#000000]"
                        }`}
                      >
                        {isDone || poppingKey === item.set.id ? "✓ Done" : "Done"}
                        <HapticTap />
                      </button>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#f0f0f0]">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => deleteCurrentSet(item.globalIndex, item.set.id)}
                            disabled={sets.length <= 1}
                            className="text-xs text-[#bbbbbb] disabled:opacity-30 hover:text-red-400 transition-colors px-1"
                          >
                            Delete set
                          </button>
                          {mainLiftLabel !== MAIN_LIFT_LABEL.bench && (
                            <button
                              onClick={() => setPendingDeleteExercise({ kind: "main" })}
                              className="text-xs text-[#bbbbbb] hover:text-red-400 transition-colors px-1"
                            >
                              Delete exercise
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => addSetAfterCurrent(item.globalIndex)}
                          className="text-xs text-[#bbbbbb] hover:text-[#111111] transition-colors px-1"
                        >
                          + Add set after
                        </button>
                      </div>
                    </div>
                  )
                })()}

                {/* Extra work card */}
                {currentItem?.type === "extra" && (() => {
                  const item = currentItem
                  const key = getItemKey(item)
                  const isDone = completedSets.has(key)
                  const currentExtraSet = extraState[item.muscle]?.[item.exercise]?.[item.setIndex]
                  const isCardio = currentExtraSet?.minutesStr != null
                  const topSet = getTopSet(item.exercise, previousSessions)
                  return (
                    <div
                      data-ledge
                      data-ledge-watch
                      className={`rounded-2xl border-2 p-5 transition-colors ${
                        isDone ? "border-[#1e3a5f]/30 bg-[#1e3a5f]/[0.03]" : "border-[#e8e8e8]"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-widest text-[#aaaaaa] mb-1">
                        {getMuscleLabel(exerciseConfig, item.muscle)}
                      </p>
                      <div className="flex items-start justify-between mb-5">
                        <div>
                          <p className="text-xl font-bold text-[#111111] leading-tight">
                            {item.exercise}
                            {isDone && <span className="ml-2 text-[#1e3a5f] text-lg">✓</span>}
                          </p>
                          <p className="text-xs text-[#aaaaaa] mt-0.5">
                            {isCardio ? "Bout" : "Set"} {item.setIndex + 1}
                          </p>
                        </div>
                        {topSet && (
                          <span className="text-xs text-[#aaaaaa] mt-0.5 text-right">
                            {isCardio
                              ? `last: ${formatCardioSet(topSet)}`
                              : `best: ${topSet.kg}kg \u00d7 ${topSet.reps}`}
                          </span>
                        )}
                      </div>
                      {isCardio && (() => {
                        const fields = activeCardioFields(currentExtraSet)
                        const derived = formatDerivedCardio(cardioSetValues(currentExtraSet!))
                        return (
                          <div className="mb-5">
                            <div
                              key={`${item.muscle}-${item.exercise}-${item.setIndex}-${fields.join("-")}`}
                              className="flex gap-2"
                            >
                              <DrumRollPicker
                                values={CARDIO_MIN_VALUES}
                                selected={parseFloat(currentExtraSet?.minutesStr ?? String(DEFAULT_CARDIO_MINUTES))}
                                onChange={(v) => { if (v !== null) updateExtraSet(item.muscle, item.exercise, item.setIndex, "minutes", String(v)) }}
                                label="min"
                                disabled={isDone}
                              />
                              {fields.map((field) => (
                                <DrumRollPicker
                                  key={field}
                                  values={CARDIO_FIELD_VALUES[field]}
                                  selected={parseFloat(currentExtraSet![CARDIO_FIELD_KEY[field]]!)}
                                  onChange={(v) => { if (v !== null) updateExtraSet(item.muscle, item.exercise, item.setIndex, field, String(v)) }}
                                  label={CARDIO_FIELD_UNIT[field]}
                                  format={(v) => (v == null ? "—" : formatCardioNumber(v))}
                                  disabled={isDone}
                                />
                              ))}
                            </div>
                            {derived && (
                              <p className="mt-2 text-center text-[11px] text-[#aaaaaa] tabular-nums">
                                {derived}
                              </p>
                            )}
                            {!isDone && (
                              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                                {CARDIO_FIELDS.map((field) => {
                                  const on = fields.includes(field)
                                  const full = !on && fields.length >= MAX_CARDIO_FIELDS
                                  return (
                                    <button
                                      key={field}
                                      onClick={() => toggleCardioField(item.muscle, item.exercise, field)}
                                      disabled={full}
                                      title={full ? "Turn one off first — the card fits two" : undefined}
                                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                        on
                                          ? "border-[#1e3a5f] bg-[#1e3a5f]/[0.06] text-[#1e3a5f]"
                                          : full
                                            ? "border-[#f0f0f0] text-[#dddddd]"
                                            : "border-[#e8e8e8] text-[#aaaaaa] hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
                                      }`}
                                    >
                                      {on ? "− " : "+ "}
                                      {CARDIO_FIELD_LABEL[field]}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      {!isCardio && (
                        <div key={`${item.muscle}-${item.exercise}-${item.setIndex}`} className="flex gap-2 mb-5">
                          <DrumRollPicker
                            values={EXTRA_KG_VALUES}
                            selected={parseFloat(currentExtraSet?.kgStr ?? "0")}
                            onChange={(v) => { if (v !== null) updateExtraSet(item.muscle, item.exercise, item.setIndex, "kg", String(v)) }}
                            label="kg"
                            disabled={isDone}
                          />
                          <DrumRollPicker
                            values={EXTRA_REPS_VALUES}
                            selected={parseInt(currentExtraSet?.repsStr ?? "10", 10)}
                            onChange={(v) => { if (v !== null) updateExtraSet(item.muscle, item.exercise, item.setIndex, "reps", String(v)) }}
                            label="reps"
                            disabled={isDone}
                          />
                        </div>
                      )}
                      <button
                        onClick={() => tapDone(key)}
                        className={`relative w-full rounded-xl py-3.5 text-sm font-semibold transition-[background-color,color,transform] duration-100 active:scale-[0.97] ${
                          poppingKey === key
                            ? "bg-[#1e3a5f] text-white done-pop"
                            : isDone
                            ? "bg-[#1e3a5f]/10 text-[#1e3a5f] hover:bg-[#1e3a5f]/20 active:bg-[#1e3a5f]/30"
                            : "bg-[#111111] text-white hover:bg-[#333333] active:bg-[#000000]"
                        }`}
                      >
                        {isDone || poppingKey === key ? "✓ Done" : "Done"}
                        <HapticTap />
                      </button>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#f0f0f0]">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => deleteExtraSet(item.muscle, item.exercise, item.setIndex)}
                            disabled={(extraState[item.muscle]?.[item.exercise]?.length ?? 0) <= 1}
                            className="text-xs text-[#bbbbbb] disabled:opacity-30 hover:text-red-400 transition-colors px-1"
                          >
                            Delete set
                          </button>
                          <button
                            onClick={() => setPendingDeleteExercise({ kind: "extra", muscle: item.muscle, exercise: item.exercise })}
                            className="text-xs text-[#bbbbbb] hover:text-red-400 transition-colors px-1"
                          >
                            Delete exercise
                          </button>
                        </div>
                        <button
                          onClick={() => addExtraSetAfter(item.muscle, item.exercise, item.setIndex)}
                          className="text-xs text-[#bbbbbb] hover:text-[#111111] transition-colors px-1"
                        >
                          + Add set after
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>
              </div>

              {/* Prev / Next */}
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={navigatePrev}
                  disabled={currentSetIndex === 0}
                  className="text-sm font-semibold text-[#777777] disabled:text-[#d4d4d4] px-3 py-2 rounded-lg hover:bg-[#f5f5f5] disabled:hover:bg-transparent transition-colors"
                >
                  ‹ Prev
                </button>
                <button
                  onClick={navigateNext}
                  disabled={currentSetIndex === carouselItems.length - 1}
                  className="text-sm font-semibold text-[#777777] disabled:text-[#d4d4d4] px-3 py-2 rounded-lg hover:bg-[#f5f5f5] disabled:hover:bg-transparent transition-colors"
                >
                  Next ›
                </button>
              </div>
            </div>
          )}

          {/* Notes + Confirm — shown after all sets are done */}
          {allDone && (
            <div className="flex-1 flex flex-col justify-center">
            <div className="w-full space-y-4">
              <div data-ledge data-ledge-home className="text-center mb-2">
                <p className="text-sm font-semibold text-[#1e3a5f]">Session complete</p>
                <p className="text-xs text-[#aaaaaa] mt-0.5">All sets done — add a note and confirm</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#777777] mb-1.5 uppercase tracking-wide">
                  Session Notes
                </label>
                <textarea
                  value={coachNote}
                  onChange={(e) => setCoachNote(e.target.value)}
                  rows={3}
                  placeholder="How did it feel?"
                  className="w-full border border-[#e8e8e8] rounded-lg px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#1e3a5f] resize-none"
                />
              </div>
              <button
                onClick={handleConfirm}
                className="w-full bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-[#16304f] transition-colors"
              >
                Confirm Session
              </button>
            </div>
            </div>
          )}

        </div>

        {/* Exercises sheet trigger — bottom center, only during active logging */}
        {mode === "log" && !allDone && carouselItems.length > 0 && (
          <button
            onClick={() => { setExercisesSheetTab("current"); setShowExercisesSheet(true) }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 text-[#aaaaaa] hover:text-[#111111] px-3 py-1 transition-colors"
            aria-label="Manage exercises"
          >
            <svg width="10" height="6" viewBox="0 0 20 11" fill="none">
              <path d="M1 10L10 1L19 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[11px] uppercase tracking-widest font-medium">Exercises</span>
          </button>
        )}

        {exercisesSheet}
        {swapConfirmation}

        {/* Delete exercise confirmation */}
        {pendingDeleteExercise && (
          <>
            <div className="absolute inset-0 bg-black/30 z-30" onClick={() => setPendingDeleteExercise(null)} />
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.15)] z-40 p-5">
              <p className="text-sm font-semibold text-[#111111] mb-1">Remove exercise?</p>
              {pendingDeleteExercise.kind === "main" ? (
                <>
                  <p className="text-base font-bold text-[#111111]">{mainLiftLabel}</p>
                  <p className="text-xs text-[#aaaaaa] mt-1 mb-4">
                    All sets will be removed. This session will have no main lift.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-bold text-[#111111]">{pendingDeleteExercise.exercise}</p>
                  {(() => {
                    const willBeEmpty = Object.keys(extraState[pendingDeleteExercise.muscle] ?? {}).filter(e => e !== pendingDeleteExercise.exercise).length === 0
                    return willBeEmpty ? (
                      <p className="text-xs text-[#aaaaaa] mt-1 mb-4">
                        This will also remove the {getMuscleLabel(exerciseConfig, pendingDeleteExercise.muscle)} group.
                      </p>
                    ) : (
                      <div className="mb-4" />
                    )
                  })()}
                </>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setPendingDeleteExercise(null)}
                  className="flex-1 rounded-xl py-3 text-sm font-semibold bg-[#f5f5f5] text-[#333333] hover:bg-[#ebebeb] active:bg-[#e0e0e0] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => pendingDeleteExercise.kind === "main"
                    ? deleteMainExercise()
                    : deleteExercise(pendingDeleteExercise.muscle, pendingDeleteExercise.exercise)
                  }
                  className="flex-1 rounded-xl py-3 text-sm font-semibold bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
