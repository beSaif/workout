"use client"

import { useState } from "react"
import Link from "next/link"
import { MuscleGroup, Session, TrainingDay } from "@/lib/types"
import { MuscleGroupConfig, getMuscleLabel } from "@/lib/exerciseConfig"
import { planSession } from "@/lib/balance"

interface Props {
  /** The unconfirmed Free session. */
  session: Session
  /** Confirmed sessions, newest first — the source of every "last time" load. */
  history: Session[]
  exerciseConfig: MuscleGroupConfig[]
  trainingDays: TrainingDay[]
  recommendedDayId?: string
  /** Why the coach picked that day, from the balance-aware suggestion. */
  reason?: string
  onStartLogging: (session: Session) => void
  onUpdateMuscleGroups: (session: Session, muscles: MuscleGroup[], dayId?: string) => void
}

/** Exercise rows shown before the preview collapses. */
const PREVIEW_ROWS = 4

/**
 * The one card that answers "what am I doing today".
 *
 * A Balanced session carries no prescribed weight, so instead of an empty hero this
 * previews what the logger will actually open with — the same exercises, the same
 * set counts, and what each was last loaded with.
 */
export default function UpNextCard({
  session,
  history,
  exerciseConfig,
  trainingDays,
  recommendedDayId,
  reason,
  onStartLogging,
  onUpdateMuscleGroups,
}: Props) {
  const sortedDays = [...trainingDays].sort((a, b) => a.order - b.order)
  const hasDays = sortedDays.length > 0

  const [pickerOpen, setPickerOpen] = useState(false)
  const [dayPickerOpen, setDayPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // The selected day and its extras are derived from the session, never mirrored into
  // state: switching a day persists through onUpdateMuscleGroups and flows back down
  // as a new session prop. Only the picker's in-progress ticks are local, and they are
  // seeded when it opens rather than by an effect watching the props.
  const selectedDayId = session.selectedTrainingDayId ?? sortedDays[0]?.id ?? null
  const selectedDay = sortedDays.find((d) => d.id === selectedDayId) ?? null
  const dayMuscles: MuscleGroup[] = selectedDay?.muscleGroupIds ?? []
  const selectedMuscles = session.selectedMuscleGroups ?? []
  const extraMuscles = hasDays
    ? selectedMuscles.filter((m) => !dayMuscles.includes(m))
    : selectedMuscles

  const [draftExtras, setDraftExtras] = useState<MuscleGroup[]>(extraMuscles)

  const pickableMuscles = [...exerciseConfig]
    .filter((g) => !dayMuscles.includes(g.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  function toggleExtrasPicker() {
    if (!pickerOpen) setDraftExtras(extraMuscles)
    setPickerOpen((v) => !v)
  }

  function handleDayChange(dayId: string) {
    const day = sortedDays.find((d) => d.id === dayId)
    if (!day) return
    // Extras belong to the day they were added to, so a switch drops them.
    onUpdateMuscleGroups(session, day.muscleGroupIds, dayId)
  }

  function handleSaveExtras() {
    onUpdateMuscleGroups(session, [...dayMuscles, ...draftExtras], selectedDayId ?? undefined)
    setPickerOpen(false)
  }

  const plan = planSession(session, exerciseConfig, history, { dayMuscleIds: dayMuscles })
  const rows = plan.muscles.flatMap((m) =>
    m.exercises.map((e) => ({ ...e, key: `${m.id}:${e.name}`, muscle: m.label }))
  )
  const visibleRows = expanded ? rows : rows.slice(0, PREVIEW_ROWS)

  const isCoachPick = !!recommendedDayId && selectedDayId === recommendedDayId
  const nothingToLog = selectedMuscles.length === 0
  const noExercises = !nothingToLog && rows.length === 0

  const extrasLabel = pickerOpen
    ? "Close"
    : extraMuscles.length > 0
    ? `${extraMuscles.length} extra${extraMuscles.length > 1 ? "s" : ""}`
    : "+ Extras"

  return (
    <section data-ledge data-ledge-home data-ledge-watch className="mb-3 rounded-2xl bg-brand-fill text-white overflow-hidden">
      <div className="px-4 pt-3.5 pb-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white/60 inline-block" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
              Up next
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleExtrasPicker}
              className="text-[11px] font-semibold text-white/70 hover:text-white active:opacity-70 transition-colors"
            >
              {extrasLabel}
            </button>
            {sortedDays.length > 1 && (
              <button
                onClick={() => setDayPickerOpen((v) => !v)}
                className="text-[11px] font-semibold text-white/70 hover:text-white active:opacity-70 transition-colors"
              >
                {dayPickerOpen ? "Close" : "Switch day"}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-2xl font-bold tracking-tight leading-none">
            {selectedDay?.name ?? "Next session"}
          </h2>
          {isCoachPick && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-white/15 rounded-full px-2 py-0.5">
              Coach pick
            </span>
          )}
        </div>

        {selectedMuscles.length > 0 && (
          <p className="mt-1 text-[12px] font-medium text-white/70">
            {dayMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
            {extraMuscles.length > 0 && (
              <span className="text-white">
                {dayMuscles.length > 0 ? " + " : ""}
                {extraMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
              </span>
            )}
          </p>
        )}

        {isCoachPick && reason && (
          <p className="mt-1.5 text-[11px] text-white/55">{reason}</p>
        )}

        {rows.length > 0 && (
          <>
            <p className="mt-3 mb-1.5 text-[11px] font-semibold text-white/70 tabular-nums">
              {plan.plannedSets} sets · {plan.exerciseCount} exercise
              {plan.exerciseCount === 1 ? "" : "s"}
            </p>
            <div className="rounded-lg bg-white/[0.07] divide-y divide-white/10">
              {visibleRows.map((row) => (
                <div key={row.key} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="flex-1 min-w-0 truncate text-[12px] text-white/85">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-white/55 tabular-nums">
                    {row.last
                      ? `${row.plannedSets} × ${row.last.kg}kg × ${row.last.reps}`
                      : `${row.plannedSets} sets · new`}
                  </span>
                </div>
              ))}
            </div>
            {rows.length > PREVIEW_ROWS && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 text-[11px] font-semibold text-white/60 hover:text-white active:opacity-70 transition-colors"
              >
                {expanded ? "Show less" : `Show ${rows.length - PREVIEW_ROWS} more`}
              </button>
            )}
          </>
        )}

        {noExercises && (
          <p className="mt-3 text-[11px] text-white/60">
            No exercises configured for these groups —{" "}
            <Link href="/exercises" className="underline">
              add some
            </Link>
          </p>
        )}

        {nothingToLog ? (
          <>
            <button
              onClick={toggleExtrasPicker}
              className="mt-3.5 w-full bg-surface text-brand text-sm font-semibold rounded-xl py-3 active:opacity-80 transition-opacity"
            >
              Choose muscle groups
            </button>
            {!hasDays && (
              <Link
                href="/exercises"
                className="block mt-2 text-center text-[11px] font-semibold text-white/60 hover:text-white transition-colors"
              >
                Set up training days →
              </Link>
            )}
          </>
        ) : (
          <button
            onClick={() => onStartLogging(session)}
            className="mt-3.5 w-full bg-surface text-brand text-sm font-semibold rounded-xl py-3 active:opacity-80 transition-opacity"
          >
            Start session
          </button>
        )}
      </div>

      {dayPickerOpen && (
        <div className="px-4 pb-4 pt-1 border-t border-white/10 animate-fade-up">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50 mb-2">
            Switch to
          </p>
          <div className="flex flex-col gap-1.5">
            {sortedDays
              .filter((day) => day.id !== selectedDayId)
              .map((day) => (
                <button
                  key={day.id}
                  onClick={() => {
                    handleDayChange(day.id)
                    setDayPickerOpen(false)
                  }}
                  className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-left active:opacity-70 transition-opacity"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-bold leading-tight">{day.name}</span>
                    {day.muscleGroupIds.length > 0 && (
                      <span className="text-[11px] font-medium text-white/60 leading-tight truncate">
                        {day.muscleGroupIds
                          .map((id) => getMuscleLabel(exerciseConfig, id))
                          .join(" + ")}
                      </span>
                    )}
                  </div>
                  {recommendedDayId && day.id === recommendedDayId && (
                    <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/60">
                      Coach pick
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}

      {pickerOpen && (
        <div className="px-4 pb-4 pt-3 border-t border-white/10 animate-fade-up">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50 mb-3">
            {hasDays ? "Add for this session only" : "Muscle groups"}
          </p>
          {hasDays && pickableMuscles.length === 0 ? (
            <p className="text-[11px] text-white/60 mb-4">
              All muscle groups are already in this day.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(hasDays
                ? pickableMuscles
                : [...exerciseConfig].sort((a, b) => a.name.localeCompare(b.name))
              ).map((g) => {
                const checked = draftExtras.includes(g.id)
                return (
                  <label
                    key={g.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                      checked ? "border-white/40 bg-white/15" : "border-white/15"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setDraftExtras((prev) =>
                          prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id]
                        )
                      }
                      className="accent-white"
                    />
                    <span className="text-xs font-medium truncate">{g.name}</span>
                  </label>
                )
              })}
            </div>
          )}
          <button
            onClick={handleSaveExtras}
            className="w-full rounded-lg bg-white/15 text-white text-xs font-semibold py-2 active:opacity-70 transition-opacity"
          >
            Save
          </button>
        </div>
      )}
    </section>
  )
}
