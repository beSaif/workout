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

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso))
}

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
        <span className="text-[11px] font-semibold text-[#777777]">
          {sessionLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#1e3a5f] inline-block" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#1e3a5f]">
            Up next
          </span>
        </div>
      </div>

      {topWeight != null && (
        <div className="flex items-center gap-4">
          <span className="text-5xl font-extrabold text-[#1e3a5f] leading-none tracking-tight">
            {topWeight}kg
          </span>
          <div className="flex flex-col gap-1">
            {topReps != null && (
              <span className="text-xl font-bold text-[#444444] leading-none">
                {topReps} reps
              </span>
            )}
            {setCount > 0 && (
              <span className="text-base font-medium text-[#aaaaaa] leading-none">
                {setCount} sets
              </span>
            )}
          </div>
        </div>
      )}

      {topWeight != null && targetLine && (
        <p className="text-[11px] font-semibold text-[#3b5f8a] leading-snug mt-2">{targetLine}</p>
      )}

      {/* Main lift sat out: say where its load went, so the block still reads as on track */}
      {mainLiftSkipped && (
        <div className="rounded-lg border border-dashed border-[#bfdbfe] bg-white/70 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#1e3a5f]">
            {liftShort} skipped today
          </p>
          <p className="text-[11px] font-medium text-[#777777] leading-snug mt-0.5">
            {heldPrescription
              ? `${heldPrescription} stays on deck — it opens your next session.`
              : "Its prescribed load moves to your next session."}
          </p>
        </div>
      )}

      {/* Repeated skips: the main lift is meant to open every session */}
      {!mainLiftSkipped && skipNudge && (
        <div className="mt-3 rounded-lg bg-[#fdf3e7] px-3 py-2">
          <p className="text-[11px] font-semibold text-[#8a4d14] leading-snug">{skipNudge}</p>
        </div>
      )}

      {hasDays && selectedDay && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#aaaaaa]">
              Training Day
            </p>
            <div className="flex items-center gap-3">
              {onUpdateMuscleGroups && (
                <button
                  onClick={togglePicker}
                  className="text-[11px] font-semibold text-[#777777] hover:text-[#1e3a5f] transition-colors"
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
                  className="text-[11px] font-semibold text-[#777777] hover:text-[#1e3a5f] transition-colors"
                >
                  {dayPickerOpen ? "Close" : "Switch day"}
                </button>
              )}
            </div>
          </div>

          {/* Prescribed day — single, informative line */}
          <div className="flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-3 py-2 text-white">
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
              <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide bg-white/15 rounded-full px-2 py-0.5">
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
                    className="flex items-center gap-2 rounded-lg border border-[#d0d0d0] bg-white px-3 py-2 text-left hover:border-[#1e3a5f] transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-[13px] font-bold leading-tight text-[#1e3a5f]">{day.name}</span>
                      {day.muscleGroupIds.length > 0 && (
                        <span className="text-[11px] font-medium text-[#aaaaaa] leading-tight">
                          {day.muscleGroupIds.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
                        </span>
                      )}
                    </div>
                    {recommendedDayId && day.id === recommendedDayId && (
                      <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide text-[#777777]">
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
        <p className="text-xs text-[#aaaaaa] mt-2">{session.bw}kg BW</p>
      )}
    </div>
  )

  const confirmedBody = (
    <div className="px-4 pt-3 pb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-[#777777] flex items-center gap-1.5">
          {sessionLabel}
          {session.bw ? ` · ${session.bw}kg BW` : ""}
          {mainLiftSkipped && (
            <span className="text-[9px] font-bold uppercase tracking-wide bg-[#f0f0f0] text-[#888888] rounded-full px-2 py-0.5">
              No {liftShort}
            </span>
          )}
        </span>
        {session.date && (
          <span className="text-[11px] text-[#aaaaaa]">{formatDate(session.date)}</span>
        )}
      </div>

      {topWeight != null && (
        <div className="flex items-center gap-4">
          <span className="text-5xl font-extrabold text-[#1f2937] leading-none tracking-tight">
            {topWeight}kg
          </span>
          <div className="flex flex-col gap-1">
            {topReps != null && (
              <span className="text-xl font-bold text-[#444444] leading-none">
                {topReps} reps
              </span>
            )}
            {setCount > 0 && (
              <span className="text-base font-medium text-[#aaaaaa] leading-none">
                {setCount} sets
              </span>
            )}
          </div>
        </div>
      )}

      {confirmedMuscles.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-1.5">
            {confirmedDay ? "Training Day" : "Trained"}
          </p>
          <div className="flex items-center gap-2 rounded-lg bg-[#16a34a] px-3 py-2 text-white">
            <div className="flex flex-col">
              {confirmedDay ? (
                <>
                  <span className="text-[13px] font-bold leading-tight">{confirmedDay.name}</span>
                  <span className="text-[11px] font-medium text-white/70 leading-tight">
                    {confirmedMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
                  </span>
                </>
              ) : (
                <span className="text-[13px] font-bold leading-tight">
                  {confirmedMuscles.map((id) => getMuscleLabel(exerciseConfig, id)).join(" + ")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const cardBorder = isUpcoming
    ? "border-dashed border-[#bfdbfe]"
    : "border-solid border-[#d6e9d9]"
  const cardBg = isUpcoming ? "bg-[#eff6ff]" : "bg-white"

  return (
    <div
      // Dot stands on the coloured stripe along the top, feet at its bottom edge.
      data-ledge
      data-ledge-inset="4"
      data-ledge-home={isUpcoming ? "" : undefined}
      data-ledge-watch={isUpcoming ? "" : undefined}
      className={`border rounded-xl mb-3 overflow-hidden ${cardBorder} ${cardBg}`}
    >
      <div className={`h-1 ${isUpcoming ? "bg-[#1e3a5f]" : "bg-[#16a34a]"}`} />

      {isUpcoming ? (
        upcomingBody
      ) : (
        <Link href={`/session/${session.id}`} className="block hover:bg-[#fafafa] transition-colors">
          {confirmedBody}
        </Link>
      )}

      {isUpcoming && pickerOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-[#e8e8e8]">
          <p className="text-[10px] font-medium text-[#aaaaaa] uppercase tracking-widest mb-3">
            {hasDays ? "Add for this session only" : "Additional Muscle Groups"}
          </p>
          {hasDays && pickableMuscles.length === 0 ? (
            <p className="text-xs text-[#aaaaaa] mb-4">All muscle groups are already in this day.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(hasDays ? pickableMuscles : [...exerciseConfig].sort((a, b) => a.name.localeCompare(b.name))).map((g) => {
                const checked = extraMuscles.includes(g.id)
                return (
                  <label
                    key={g.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                      checked
                        ? "border-[#1e3a5f]/40 bg-[#1e3a5f]/[0.04] text-[#1e3a5f]"
                        : "border-[#e8e8e8] text-[#111111]"
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
                      className="accent-[#1e3a5f]"
                    />
                    <span className="font-medium text-xs">{g.name}</span>
                  </label>
                )
              })}
            </div>
          )}
          <button
            onClick={handleSaveExtras}
            className="w-full rounded-lg border border-[#1e3a5f] text-[#1e3a5f] text-xs font-semibold py-2 hover:bg-[#1e3a5f] hover:text-white transition-colors"
          >
            Save
          </button>
        </div>
      )}

      <div className={`${isUpcoming ? "bg-[#dbeafe]" : "bg-[#f3faf4]"} px-4 py-3 flex items-center justify-between`}>
        <div className="flex flex-wrap gap-1.5">
          {(() => {
            // Completed: muscles are shown in the training-day card above, not here
            if (!isUpcoming) return null

            // Upcoming with a Training Day card: muscles are shown there, not here
            if (hasDays) return null

            // Upcoming with no training days: show selected muscles here as a fallback
            return extraMuscles.map((id) => (
              <span
                key={id}
                className="text-[10px] font-semibold uppercase tracking-wide bg-[#1e3a5f]/10 text-[#1e3a5f] rounded-full px-2 py-0.5"
              >
                {getMuscleLabel(exerciseConfig, id)}
              </span>
            ))
          })()}
        </div>

        {isUpcoming && (
          <div className="flex gap-2 items-center">
            {!hasDays && onUpdateMuscleGroups && (
              <button
                onClick={togglePicker}
                className="text-xs font-semibold text-[#777777] border border-[#e8e8e8] rounded-lg px-3 py-1.5 hover:border-[#aaaaaa] transition-colors"
              >
                {pickerOpen
                  ? "Close"
                  : extraMuscles.length > 0
                  ? `${extraMuscles.length} extra${extraMuscles.length > 1 ? "s" : ""}`
                  : "+ Extras"}
              </button>
            )}
            {mainLiftSkipped && onRestoreMainLift && (
              <button
                onClick={() => onRestoreMainLift(session)}
                className="text-xs font-semibold text-[#777777] border border-[#e8e8e8] rounded-lg px-3 py-1.5 hover:border-[#aaaaaa] transition-colors"
              >
                Undo skip
              </button>
            )}
            {!mainLiftSkipped && onSkipMainLift && (
              <button
                onClick={() => onSkipMainLift(session)}
                className="text-xs font-semibold text-[#777777] border border-[#e8e8e8] rounded-lg px-3 py-1.5 hover:border-[#aaaaaa] transition-colors"
              >
                Skip {liftShort}
              </button>
            )}
            {onStartLogging && (
              <button
                onClick={() => onStartLogging(session)}
                className="text-xs font-semibold text-[#1e3a5f] border border-[#1e3a5f] rounded-lg px-3 py-1.5 hover:bg-[#1e3a5f] hover:text-white transition-colors"
              >
                Log Session
              </button>
            )}
          </div>
        )}

        {!isUpcoming && (onEdit || onUnlog || onShare) && (
          <div className="flex gap-2">
            {onShare && (
              <button
                onClick={() => onShare(session)}
                className="text-xs font-semibold text-[#1e3a5f] border border-[#1e3a5f] rounded-lg px-3 py-1.5 hover:bg-[#1e3a5f] hover:text-white transition-colors"
              >
                Share
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(session)}
                className="text-xs font-semibold text-[#1e3a5f] border border-[#1e3a5f] rounded-lg px-3 py-1.5 hover:bg-[#1e3a5f] hover:text-white transition-colors"
              >
                Edit
              </button>
            )}
            {onUnlog && (
              <button
                onClick={() => onUnlog(session)}
                className="text-xs font-semibold text-[#aaaaaa] border border-[#e8e8e8] rounded-lg px-3 py-1.5 hover:border-[#aaaaaa] transition-colors"
              >
                Unlog
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
