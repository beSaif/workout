import { DOT_KEY, MainLift, Session } from "./types"
import { localSource, notifyLocalChange } from "./useLocalValue"
import { haptic } from "./haptics"

/**
 * Dot, the small companion that lives on top of the home screen and the logger.
 *
 * It only reacts: there are no points, streaks or anything to collect. This module is
 * the side the rest of the app talks to — the on/off switch, the moments the logger
 * reports, and the coach's line for the tap bubble. How Dot moves lives in
 * components/buddy/DotBuddy.tsx.
 */

export const DOT_CHANGE_EVENT = "dot-change"
export const DOT_MOMENT_EVENT = "dot-moment"

export function loadDotEnabled(): boolean {
  try {
    return localStorage.getItem(DOT_KEY) !== "off"
  } catch {
    return true
  }
}

export function saveDotEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(DOT_KEY)
    else localStorage.setItem(DOT_KEY, "off")
  } catch {
    // Private mode: the switch just will not stick past this page.
  }
  notifyLocalChange()
  window.dispatchEvent(new Event(DOT_CHANGE_EVENT))
}

/** The switch, for useLocalValue. */
export const dotEnabledSource = localSource([DOT_KEY], loadDotEnabled)

/**
 * A finished set, as Dot sees it. A new best outranks a grinder, which outranks a tick.
 * Dot meets a best like any other set; only the buzz tells them apart.
 */
export type DotMoment = { kind: "set" | "heavy" | "pr" }

/**
 * The buzz for a finished set. The last set of an exercise buzzes harder, unless it is
 * a best, whose own buzz says more. Call it inside the tap.
 */
export function buzzSetMoment(moment: DotMoment, finishesExercise = false): void {
  haptic(finishesExercise && moment.kind !== "pr" ? "exercise" : moment.kind)
}

/**
 * Report a finished set: the phone buzzes now, inside the tap, and Dot reacts once the
 * screen has caught up. Call it from the Done handler. `buzzed` says the tap already
 * played the buzz through buzzSetMoment and the report is only for Dot.
 */
export function reportSetMoment(
  moment: DotMoment,
  { finishesExercise = false, buzzed = false }: { finishesExercise?: boolean; buzzed?: boolean } = {}
): void {
  if (!buzzed) buzzSetMoment(moment, finishesExercise)
  window.dispatchEvent(new CustomEvent<DotMoment>(DOT_MOMENT_EVENT, { detail: moment }))
}

/** A set at or above this RPE is a grinder worth flagging. */
export const HEAVY_RPE = 9.5

/**
 * What a just-finished set deserves.
 *
 * A best needs something to beat — the first time a lift is logged everything is a
 * "best", and celebrating that would be noise. A set is heavy when it was a grinder
 * or came in short of the reps it was planned for.
 */
export function classifySet({
  e1rm,
  bestBefore,
  rpe,
  reps,
  plannedReps,
}: {
  e1rm: number | null
  bestBefore: number | null
  rpe: number | null
  reps: number
  plannedReps: number | null
}): DotMoment["kind"] {
  if (e1rm != null && bestBefore != null && e1rm > bestBefore) return "pr"
  if (rpe != null && rpe >= HEAVY_RPE) return "heavy"
  if (plannedReps != null && reps < plannedReps) return "heavy"
  return "set"
}

/** One line of technique per session, so the bubble does not say the same thing daily. */
const CUES: Record<MainLift | "any", string[]> = {
  bench: [
    "Shoulder blades pinned, touch low, drive through the floor.",
    "Squeeze the bar like you want to bend it. Elbows tucked on the way down.",
    "Same touch point every rep, then press back over your face.",
    "Big breath at the top and hold it through the whole rep.",
  ],
  squat: [
    "Brace before you unrack. Knees out, sit between your hips.",
    "Mid-foot pressure the whole way. Chest up out of the hole.",
    "Breathe and brace every rep, not once per set.",
  ],
  deadlift: [
    "Take the slack out before the bar leaves the floor.",
    "Push the floor away. Hips and shoulders rise together.",
    "Bar stays on your legs from floor to lockout.",
  ],
  any: [
    "Control the lowering, two seconds down.",
    "Same setup every set. Consistency is the progress.",
    "Leave a rep in the tank on the first set.",
  ],
}

export interface DotCue {
  title: string
  line: string
}

/**
 * The tap bubble on the home screen: today's prescription and one coaching cue.
 * Null when there is nothing coming up to talk about.
 */
export function buildDotCue(
  upcoming: Session | undefined,
  mainLift: MainLift | undefined,
  dayName: string | undefined
): DotCue | null {
  if (!upcoming) return null
  const working = upcoming.sets.filter((s) => !s.isWarmup)
  const pick = (lines: string[]) => lines[upcoming.id % lines.length]
  if (working.length > 0 && mainLift) {
    const top = working[0]
    return { title: `${top.kg}kg × ${top.reps} × ${working.length}`, line: pick(CUES[mainLift]) }
  }
  if (dayName) return { title: dayName, line: pick(CUES.any) }
  return null
}
