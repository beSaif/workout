"use client"

import { useState } from "react"
import Link from "next/link"
import { Session, MuscleGroup, TrainingDay } from "@/lib/types"
import { MuscleGroupConfig, getMuscleLabel, isCardioMuscle } from "@/lib/exerciseConfig"

interface SessionCardProps {
  session: Session
  blockIndex?: number
  onStartLogging?: (session: Session) => void
  onEdit?: (session: Session) => void
  onUnlog?: (session: Session) => void
  onShare?: (session: Session) => void
  onUpdateMuscleGroups?: (session: Session, muscles: MuscleGroup[], dayId?: string) => void
  /** Drop the main lift from this upcoming session. Absent in Balanced mode, which has none. */
  onSkipMainLift?: (session: Session) => void
  /** Put the main lift back on an upcoming session that skipped it. */
  onRestoreMainLift?: (session: Session) => void
  exerciseConfig: MuscleGroupConfig[]
  trainingDays?: TrainingDay[]
  recommendedDayId?: string
  /** Short main-lift label ("Bench") for the skip control and the skipped tag. */
  mainLiftShortLabel?: string
  /** The load being held for the next session, e.g. "62.5kg × 6 × 4". */
  heldPrescription?: string
  /** Upcoming only: the effort to aim for, and why the load moved if it did. */
  targetLine?: string
  /** Coach nudge shown on the upcoming card after repeated skips. */
  skipNudge?: string
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso))
}

const quietClass = "text-xs font-semibold text-brand-soft py-1 hover:text-brand transition-colors"

export default function SessionCard({
  session,
  blockIndex,
  onStartLogging,
  onEdit,
  onUnlog,
  onShare,
  onUpdateMuscleGroups,
  onSkipMainLift,
  onRestoreMainLift,
  exerciseConfig,
  trainingDays,
  recommendedDayId,
  mainLiftShortLabel,
  heldPrescription,
  targetLine,
  skipNudge,
}: SessionCardProps) {
  const isUpcoming = !session.confirmed
  const mainLiftSkipped = session.skippedMainLift === true
  const liftShort = mainLiftShortLabel ?? "Main lift"

  const sortedDays = trainingDays ? [...trainingDays].sort((a, b) => a.order - b.order) : []
  const hasDays = sortedDays.length > 0

  const [selectedDayId, setSelectedDayId] = useState<string | null>(
    session.selectedTrainingDayId ?? sortedDays[0]?.id ?? null
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dayPickerOpen, setDayPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [extraMuscles, setExtraMuscles] = useState<MuscleGroup[]>(() => {
    if (!hasDays) return session.selectedMuscleGroups ?? []
    const dayMuscles = sortedDays.find((d) => d.id === (session.selectedTrainingDayId ?? sortedDays[0]?.id))?.muscleGroupIds ?? []
    return (session.selectedMuscleGroups ?? []).filter((m) => !dayMuscles.includes(m))
  })

  // Re-sync when the session's saved day or groups change (e.g. after save). Done while
  // rendering, React's pattern for state that follows a prop, rather than in an effect.
  const savedKey = `${session.selectedTrainingDayId ?? ""}|${(session.selectedMuscleGroups ?? []).join(",")}`
  const [syncedKey, setSyncedKey] = useState(savedKey)
  if (savedKey !== syncedKey) {
    setSyncedKey(savedKey)
    const dayId = session.selectedTrainingDayId ?? sortedDays[0]?.id ?? null
    setSelectedDayId(dayId)
    if (hasDays) {
      const dayMuscles = sortedDays.find((d) => d.id === dayId)?.muscleGroupIds ?? []
      setExtraMuscles((session.selectedMuscleGroups ?? []).filter((m) => !dayMuscles.includes(m)))
    } else {
      setExtraMuscles(session.selectedMuscleGroups ?? [])
    }
  }

  // Opening the extras picker starts from what is saved, discarding unsaved picks.
  function togglePicker() {
    if (!pickerOpen) {
      const dayMuscles = sortedDays.find((d) => d.id === selectedDayId)?.muscleGroupIds ?? []
      setExtraMuscles((session.selectedMuscleGroups ?? []).filter((m) => !dayMuscles.includes(m)))
    }
    setPickerOpen((v) => !v)
  }

  const selectedDay = sortedDays.find((d) => d.id === selectedDayId) ?? null
  const dayMuscles: MuscleGroup[] = selectedDay?.muscleGroupIds ?? []

  // Muscles available for "add extra" picker — everything not already in the day
  const pickableMuscles = [...exerciseConfig]
    .filter((g) => !dayMuscles.includes(g.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  function handleDayChange(dayId: string) {
    const day = sortedDays.find((d) => d.id === dayId)
    if (!day) return
    setSelectedDayId(dayId)
    setExtraMuscles([])
    onUpdateMuscleGroups?.(session, day.muscleGroupIds, dayId)
  }

  function handleSaveExtras() {
    const fullList = [...dayMuscles, ...extraMuscles]
    onUpdateMuscleGroups?.(session, fullList, selectedDayId ?? undefined)
    setPickerOpen(false)
  }

  const working = session.sets.filter((s) => !s.isWarmup)
  const topWeight = working[0]?.kg ?? null
  const topReps = working[0]?.reps ?? null
  const setCount = working.length
  // A heavy day opens with one heavier single; the sets after it are its back-offs.
  const backOffs = working.length > 1 && working[0].kg > working[1].kg ? working.slice(1) : null
  const backOffLine = backOffs ? `${backOffs[0].kg}kg × ${backOffs[0].reps} × ${backOffs.length}` : null

  // Muscles trained in a completed session (for its training-day card). Cardio is not a
  // muscle, and older sessions stored it among the groups; it only shows when a session
  // was nothing but cardio.
  const loggedMuscles: MuscleGroup[] =
    session.selectedMuscleGroups && session.selectedMuscleGroups.length > 0
      ? session.selectedMuscleGroups
      : session.extraWorkouts?.map((w) => w.muscle) ?? []
  const strengthMuscles = loggedMuscles.filter((m) => !isCardioMuscle(exerciseConfig, m))
  const confirmedMuscles = strengthMuscles.length > 0 ? strengthMuscles : loggedMuscles
  // Block sessions are numbered by their place in the block, the scheme the previews
  // use. A session outside any block (a skipped main lift, a Balanced-mode session) has
  // no such place, and its internal id would read as a second, clashing count.
  const sessionLabel =
    blockIndex !== undefined
      ? `Session ${blockIndex}`
      : session.skippedMainLift
      ? "Accessories"
      : session.type === "Free"
      ? "Balanced session"
      : `Session ${String(session.id).padStart(2, "0")}`
  const confirmedDay = sortedDays.find((d) => d.id === session.selectedTrainingDayId) ?? null

  const upcomingBody = (
    <div className="px-4 pt-3 pb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-ink-5">
          {sessionLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-fill inline-block" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand">
            Up next
          </span>
        </div>
      </div>

      {topWeight != null && (
        <div className="flex items-center gap-4">
          <span className="text-5xl font-extrabold text-brand leading-none tracking-tight">
            {topWeight}kg
          </span>
          <div className="flex flex-col gap-1">
            {topReps != null && (
              <span className="text-xl font-bold text-ink-3 leading-none">
                {topReps === 0 ? "missed" : `${topReps} ${topReps === 1 ? "rep" : "reps"}`}
              </span>
            )}
            {backOffLine ? (
              <span className="text-sm font-medium text-ink-6 leading-none tabular-nums">then {backOffLine}</span>
            ) : setCount > 0 && (
              <span className="text-base font-medium text-ink-6 leading-none">
                {setCount} {setCount === 1 ? "set" : "sets"}
              </span>
            )}
          </div>
        </div>
      )}

      {topWeight != null && targetLine && (
        <p className="text-[11px] font-semibold text-brand-soft leading-snug mt-2 whitespace-pre-line">{targetLine}</p>
      )}

      {/* Main lift sat out: say where its load went, so the block still reads as on track */}
      {mainLiftSkipped && (
        <div className="rounded-lg border border-dashed border-brand-line-soft bg-surface/70 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand">
            {liftShort} skipped today
          </p>
          <p className="text-[11px] font-medium text-ink-5 leading-snug mt-0.5">
            {heldPrescription
              ? `${heldPrescription} stays on deck — it opens your next session.`
              : "Its prescribed load moves to your next session."}
          </p>
        </div>
      )}

      {/* Repeated skips: the main lift is meant to open every session */}
      {!mainLiftSkipped && skipNudge && (
        <div className="mt-3 rounded-lg bg-warn-tint px-3 py-2">
          <p className="text-[11px] font-semibold text-warn leading-snug">{skipNudge}</p>
        </div>
      )}

      {hasDays && selectedDay && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6">
              Training Day
            </p>
            <div className="flex items-center gap-3">
              {onUpdateMuscleGroups && (
                <button
                  onClick={togglePicker}
                  className="text-[11px] font-semibold text-ink-5 hover:text-brand transition-colors"
                >
                  {pickerOpen
                    ? "Close"
                    : extraMuscles.length > 0
                    ? `${extraMuscles.length} extra${extraMuscles.length > 1 ? "s" : ""}`
                    : "+ Extras"}
                </button>
              )}
              {sortedDays.length > 1 && (
                <button
                  onClick={() => setDayPickerOpen((v) => !v)}
                  className="text-[11px] font-semibold text-ink-5 hover:text-brand transition-colors"
                >
                  {dayPickerOpen ? "Close" : "Switch day"}
                </button>
              )}
            </div>
          </div>

          {/* Prescribed day — single, informative line */}
          <div className="flex items-center gap-2 rounded-lg bg-brand-fill px-3 py-2 text-white">
            <div className="flex flex-col">
              <span className="text-[13px] font-bold leading-tight">{selectedDay.name}</span>
              {(dayMuscles.length > 0 || extraMuscles.length > 0) && (
                <span className="text-[11px] font-medium text-white/70 leading-tight">
                  {dayMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
                  {extraMuscles.length > 0 && (
                    <span className="text-white">
                      {dayMuscles.length > 0 ? " + " : ""}
                      {extraMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
                    </span>
                  )}
                </span>
              )}
            </div>
            {recommendedDayId && selectedDayId === recommendedDayId && (
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide bg-white/15 rounded-full px-2 py-0.5">
                Coach pick
              </span>
            )}
          </div>

          {/* Inline-expandable alternatives */}
          {dayPickerOpen && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {sortedDays
                .filter((day) => day.id !== selectedDayId)
                .map((day) => (
                  <button
                    key={day.id}
                    onClick={() => {
                      handleDayChange(day.id)
                      setDayPickerOpen(false)
                    }}
                    className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left hover:border-brand-line transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-[13px] font-bold leading-tight text-brand">{day.name}</span>
                      {day.muscleGroupIds.length > 0 && (
                        <span className="text-[11px] font-medium text-ink-6 leading-tight">
                          {day.muscleGroupIds.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
                        </span>
                      )}
                    </div>
                    {recommendedDayId && day.id === recommendedDayId && (
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-ink-5">
                        Coach pick
                      </span>
                    )}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {session.bw && (
        <p className="text-xs text-ink-6 mt-2">{session.bw}kg BW</p>
      )}
    </div>
  )

  // A logged session is one line; tapping it opens the actions. Six of them used to be
  // five screens of scrolling between the next session and the ones still to come.
  if (!isUpcoming) {
    const lift =
      topWeight != null
        ? topReps === 0
          ? backOffLine ? `missed · ${backOffLine}` : "missed"
          : backOffLine
          ? `× ${topReps} · ${backOffLine}`
          : `${topReps} × ${setCount}`
        : null
    const where = confirmedDay
      ? confirmedDay.name
      : confirmedMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")
    const actionClass =
      "text-xs font-semibold text-brand border border-brand-line rounded-lg px-3 py-1.5 hover:bg-brand-fill hover:text-white transition-colors"
    return (
      <div
        data-ledge
        data-ledge-inset="0"
        className="border border-good-line rounded-xl mb-2 overflow-hidden bg-surface"
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-surface-1 transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-good-fill shrink-0" aria-hidden="true" />
          <span className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-xs font-semibold text-ink-3 flex items-center gap-1.5">
              {sessionLabel}
              {session.date && <span className="font-normal text-ink-5">· {formatShortDate(session.date)}</span>}
              {mainLiftSkipped && (
                <span className="text-[10px] font-bold uppercase tracking-wide bg-surface-3 text-ink-5 rounded-full px-2 py-0.5">
                  No {liftShort}
                </span>
              )}
            </span>
            {where && <span className="text-[11px] text-ink-5 truncate">{where}</span>}
          </span>
          {topWeight != null && (
            <span className="shrink-0 text-right tabular-nums">
              <span className="text-base font-bold text-ink">{topWeight}kg</span>
              {lift && <span className="text-xs text-ink-5 ml-1.5">{lift}</span>}
            </span>
          )}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 text-ink-6 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          </svg>
        </button>

        {expanded && (
          <div className="bg-good-tint px-4 py-3 animate-fade-in">
            {confirmedDay && confirmedMuscles.length > 0 && (
              <p className="text-[11px] text-ink-4 mb-2.5">
                {confirmedMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
                {session.bw ? ` · ${session.bw}kg BW` : ""}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Link href={`/session/${session.id}`} className={actionClass}>
                Details
              </Link>
              {onShare && (
                <button onClick={() => onShare(session)} className={actionClass}>
                  Share
                </button>
              )}
              {onEdit && (
                <button onClick={() => onEdit(session)} className={actionClass}>
                  Edit
                </button>
              )}
              {onUnlog && (
                <button
                  onClick={() => onUnlog(session)}
                  className="text-xs font-semibold text-ink-5 border border-line rounded-lg px-3 py-1.5 hover:border-line-heavy transition-colors"
                >
                  Unlog
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      // Dot stands on the coloured stripe along the top, feet at its bottom edge.
      data-ledge
      data-ledge-inset="4"
      data-ledge-home=""
      data-ledge-watch=""
      className="border border-dashed border-brand-line-soft bg-brand-tint rounded-xl mb-3 overflow-hidden"
    >
      <div className="h-1 bg-brand-fill" />

      {upcomingBody}

      {pickerOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-line">
          <p className="text-[10px] font-medium text-ink-6 uppercase tracking-widest mb-3">
            {hasDays ? "Add for this session only" : "Additional Muscle Groups"}
          </p>
          {hasDays && pickableMuscles.length === 0 ? (
            <p className="text-xs text-ink-6 mb-4">All muscle groups are already in this day.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(hasDays ? pickableMuscles : [...exerciseConfig].sort((a, b) => a.name.localeCompare(b.name))).map((g) => {
                const checked = extraMuscles.includes(g.id)
                return (
                  <label
                    key={g.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                      checked
                        ? "border-brand-line/40 bg-brand-fill/[0.04] text-brand"
                        : "border-line text-ink"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setExtraMuscles((prev) =>
                          prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id]
                        )
                      }
                      className="accent-brand-fill"
                    />
                    <span className="font-medium text-xs">{g.name}</span>
                  </label>
                )
              })}
            </div>
          )}
          <button
            onClick={handleSaveExtras}
            className="w-full rounded-lg border border-brand-line text-brand text-xs font-semibold py-2 hover:bg-brand-fill hover:text-white transition-colors"
          >
            Save
          </button>
        </div>
      )}

      <div className="bg-brand-tint-3 px-4 py-3">
        {!hasDays && extraMuscles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {extraMuscles.map((id) => (
              <span
                key={id}
                className="text-[10px] font-semibold uppercase tracking-wide bg-brand-fill/10 text-brand rounded-full px-2 py-0.5"
              >
                {getMuscleLabel(exerciseConfig, id)}
              </span>
            ))}
          </div>
        )}

        {/* The one thing this card is for gets the one filled button on it. */}
        {onStartLogging && (
          <button
            onClick={() => onStartLogging(session)}
            className="w-full rounded-xl bg-brand-fill text-white text-sm font-semibold py-3 hover:bg-brand-fill-2 active:bg-brand-fill-3 transition-colors"
          >
            Log Session
          </button>
        )}

        <div className="flex justify-center gap-5 mt-2.5 empty:hidden">
          {!hasDays && onUpdateMuscleGroups && (
            <button onClick={togglePicker} className={quietClass}>
              {pickerOpen
                ? "Close"
                : extraMuscles.length > 0
                ? `${extraMuscles.length} extra${extraMuscles.length > 1 ? "s" : ""}`
                : "+ Extras"}
            </button>
          )}
          {mainLiftSkipped && onRestoreMainLift && (
            <button onClick={() => onRestoreMainLift(session)} className={quietClass}>
              Undo skip
            </button>
          )}
          {!mainLiftSkipped && onSkipMainLift && (
            <button onClick={() => onSkipMainLift(session)} className={quietClass}>
              Skip {liftShort}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
