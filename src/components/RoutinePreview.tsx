"use client"

import { useState } from "react"
import { RoutineBundle, summarizeRoutine } from "@/lib/routines"

/**
 * Someone's split, day by day: the Routine tab of a profile. Days start folded to
 * their muscle groups so the whole week fits on a screen; tap one for its exercises.
 */
export default function RoutinePreview({ routine }: { routine: RoutineBundle }) {
  const [openDays, setOpenDays] = useState<Set<string>>(new Set())
  const summary = summarizeRoutine(routine)
  const sortedDays = [...routine.trainingDays].sort((a, b) => a.order - b.order)
  const assigned = new Set(sortedDays.flatMap((d) => d.muscleGroupIds))
  const unassigned = routine.muscleGroups.filter((g) => !assigned.has(g.id))
  const groupById = new Map(routine.muscleGroups.map((g) => [g.id, g]))

  function toggle(dayId: string) {
    setOpenDays((prev) => {
      const next = new Set(prev)
      if (next.has(dayId)) next.delete(dayId)
      else next.add(dayId)
      return next
    })
  }

  const stats = [
    { value: summary.dayCount, label: summary.dayCount === 1 ? "day" : "days" },
    { value: summary.groupCount, label: summary.groupCount === 1 ? "muscle group" : "muscle groups" },
    { value: summary.exerciseCount, label: summary.exerciseCount === 1 ? "exercise" : "exercises" },
  ]

  return (
    <>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-surface-1 px-3 py-2.5">
            <p className="text-lg font-semibold text-ink tabular-nums leading-tight">{s.value}</p>
            <p className="text-[10px] text-ink-6 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3">
        Training Days
      </p>

      {sortedDays.length === 0 ? (
        <p className="text-sm text-ink-6 mb-6">No training days yet.</p>
      ) : (
        <div className="space-y-2 mb-6">
          {sortedDays.map((day) => {
            const groups = day.muscleGroupIds.flatMap((id) => groupById.get(id) ?? [])
            const exerciseCount = groups.reduce((n, g) => n + g.exercises.length, 0)
            const isOpen = openDays.has(day.id)
            return (
              <div key={day.id} className="bg-surface border border-line rounded-xl overflow-hidden">
                <button
                  onClick={() => toggle(day.id)}
                  aria-expanded={isOpen}
                  disabled={groups.length === 0}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-1 transition-colors disabled:hover:bg-surface"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-ink truncate">{day.name}</p>
                      {groups.length > 0 && (
                        <span className="shrink-0 text-[11px] text-ink-6">
                          {exerciseCount} exercise{exerciseCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {groups.length === 0 ? (
                      <p className="text-[11px] text-ink-6 mt-0.5">Rest or open day</p>
                    ) : (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {groups.map((g) => (
                          <span
                            key={g.id}
                            className="text-[11px] font-semibold text-brand bg-brand-tint-2 rounded-full px-2 py-0.5"
                          >
                            {g.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {groups.length > 0 && (
                    <svg
                      width="7" height="12" viewBox="0 0 7 12" fill="none"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                      className={`shrink-0 text-ink-7 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      <path d="M1 1l5 5-5 5" />
                    </svg>
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-line-soft px-4 py-3 space-y-3">
                    {groups.map((group) => {
                      const exercises = [...group.exercises].sort((a, b) => a.order - b.order)
                      return (
                        <div key={group.id}>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6">
                            {group.name}
                          </p>
                          {exercises.length === 0 ? (
                            <p className="text-xs text-ink-6 mt-1">No exercises</p>
                          ) : (
                            <ul className="mt-1 space-y-1">
                              {exercises.map((ex) => (
                                <li key={ex.id} className="flex items-baseline justify-between gap-2">
                                  <span className="text-[13px] text-ink-2 truncate">{ex.name}</span>
                                  {ex.defaultSets !== undefined && (
                                    <span className="shrink-0 text-[11px] text-ink-6 tabular-nums">
                                      {ex.defaultSets} set{ex.defaultSets !== 1 ? "s" : ""}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {unassigned.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3">
            Not on a training day
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {unassigned.map((group) => (
              <span
                key={group.id}
                className="text-xs font-semibold text-ink-5 bg-surface border border-line rounded-full px-3 py-1"
              >
                {group.name}
                <span className="text-ink-7 font-normal">
                  {" "}· {group.exercises.length} exercise{group.exercises.length !== 1 ? "s" : ""}
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}
