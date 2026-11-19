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
 * A drag of one row onto another: the dragged row takes the other's place. Any row moves,
 * the main lift included; it only opens the session by default (buildDefaultOrder).
 */
export function reorderGroups(order: ExerciseGroup[], activeId: string, overId: string): ExerciseGroup[] {
  const from = order.findIndex((g) => groupId(g) === activeId)
  const to = order.findIndex((g) => groupId(g) === overId)
  if (from < 0 || to < 0) return order
  const next = order.slice()
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
