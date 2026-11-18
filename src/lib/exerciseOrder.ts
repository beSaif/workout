import { MuscleGroup } from "./types"

/** One row of the logger's exercise list: the main lift, or one accessory. */
export type ExerciseGroup =
  | { kind: "main" }
  | { kind: "extra"; muscle: MuscleGroup; exercise: string }

/** A stable id for drag and drop. */
export function groupId(g: ExerciseGroup): string {
  return g.kind === "main" ? "main" : `extra-${g.muscle}-${g.exercise}`
}

/**
 * The main lift opens every session it is in, so it is pinned first. Only Main Lift
 * sessions carry one; this also fixes a draft saved before the pin, where it may sit lower.
 */
export function withMainFirst(order: ExerciseGroup[]): ExerciseGroup[] {
  const i = order.findIndex((g) => g.kind === "main")
  return i > 0 ? [order[i], ...order.slice(0, i), ...order.slice(i + 1)] : order
}

/** A drag of one row onto another. The main lift neither moves nor has anything put above it. */
export function reorderGroups(order: ExerciseGroup[], activeId: string, overId: string): ExerciseGroup[] {
  const from = order.findIndex((g) => groupId(g) === activeId)
  const to = order.findIndex((g) => groupId(g) === overId)
  if (from < 0 || to < 0 || order[from].kind === "main" || order[to].kind === "main") return order
  const next = order.slice()
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
