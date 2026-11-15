"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Session, MainLiftSet, TrainingDay, UserProfile, isCardioSet } from "@/lib/types"
import { getMainLiftLabel, getMainLiftShortLabel, getSessionLabel } from "@/lib/trainingMode"
import { loadAll, loadSessionsLocal, loadExerciseConfigLocal, loadExerciseConfig, loadProfile, loadProfileLocal, loadTrainingDaysLocal } from "@/lib/storage"
import { MuscleGroupConfig, DEFAULT_TRAINING_DAYS, getMuscleLabel } from "@/lib/exerciseConfig"
import { formatCardioSet } from "@/lib/cardio"
import BackButton from "@/components/BackButton"

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso))
}

function SetRow({ set }: { set: MainLiftSet }) {
  const isWarmup = set.isWarmup
  const textColor = isWarmup ? "text-ink-6" : "text-ink"
  const e1rmColor = isWarmup ? "text-ink-6" : "text-brand"

  return (
    <>
      <div className={`grid grid-cols-[2rem_3.5rem_1fr_3.5rem] gap-x-3 py-[3px] text-sm whitespace-nowrap ${textColor}`}>
        <span className="font-medium">{set.id}</span>
        <span>{set.kg}kg</span>
        <span>
          {set.reps} reps
          {set.rpe != null && (
            <span className="text-ink-6"> · {set.rpe}</span>
          )}
        </span>
        <span className={`text-right ${e1rmColor} font-medium`}>
          {set.e1rm != null ? `${set.e1rm}` : "—"}
        </span>
      </div>
      {set.note && (
        <div className="text-xs italic text-ink-6 pb-1 pl-[6.5rem]">
          {set.note}
        </div>
      )}
    </>
  )
}

export default function SessionDetailPage() {
  const params = useParams()
  const id = Number(params.id)

  const [session, setSession] = useState<Session | null>(null)
  const [exerciseConfig, setExerciseConfig] = useState<MuscleGroupConfig[]>(loadExerciseConfigLocal)
  const [profile, setProfile] = useState<UserProfile | null>(loadProfileLocal)
  const [trainingDays, setTrainingDays] = useState<TrainingDay[]>(DEFAULT_TRAINING_DAYS)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const local = loadSessionsLocal()
    const found = local.find((s) => s.id === id) ?? null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setSession(found)
    setTrainingDays(loadTrainingDaysLocal())
    setMounted(true)

    loadExerciseConfig().then(setExerciseConfig)
    loadProfile().then((p) => { if (p) setProfile(p) })

    loadAll().then(({ sessions }) => {
      const updated = sessions.find((s) => s.id === id) ?? null
      setSession(updated)
    })
  }, [id])

  if (!mounted) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
        <div className="h-4 w-16 bg-surface-4 rounded animate-pulse mb-8" />
        <div className="h-6 w-48 bg-surface-4 rounded animate-pulse mb-2" />
        <div className="h-4 w-32 bg-surface-4 rounded animate-pulse" />
      </main>
    )
  }

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
        <BackButton href="/" label="Back to home" className="mb-3" />
        <p className="text-sm text-ink-5">Session not found.</p>
      </main>
    )
  }

  const working = session.sets.filter((s) => !s.isWarmup)
  const warmups = session.sets.filter((s) => s.isWarmup)
  const e1rms = working.map((s) => s.e1rm).filter((v): v is number => v != null)
  const bestE1RM = e1rms.length > 0 ? Math.max(...e1rms) : null
  const workingWeight = working[0]?.kg ?? null

  return (
    <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
      {/* Back */}
      <BackButton href="/" label="Back to home" className="mb-3" />

      {/* Session header */}
      <header className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink tracking-tight">
              Session {String(session.id).padStart(2, "0")}
              <span className="text-ink-6 font-normal"> · {getSessionLabel(session, trainingDays)}</span>
            </h1>
            {session.skippedMainLift && (
              <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide bg-surface-3 text-ink-5 rounded-full px-2 py-0.5">
                No {getMainLiftShortLabel(profile)}
              </span>
            )}
            {session.date && (
              <p className="text-sm text-ink-5 mt-0.5">{formatDate(session.date)}</p>
            )}
            {session.bw && (
              <p className="text-xs text-ink-6 mt-0.5">{session.bw}kg BW</p>
            )}
          </div>
          {bestE1RM && (
            <div className="text-right">
              <p className="text-[10px] text-ink-6 uppercase tracking-wide mb-0.5">e1RM</p>
              <p className="text-2xl font-semibold text-brand">{bestE1RM}<span className="text-sm font-normal">kg</span></p>
            </div>
          )}
        </div>
      </header>

      {/* Main lift section — absent on Balanced-mode sessions, which log no main lift */}
      {session.sets.length > 0 && (
      <section className="mb-6">
        <p className="text-[10px] font-medium text-ink-6 uppercase tracking-widest mb-3">
          {getMainLiftLabel(profile)}
        </p>

        {/* Quick stats */}
        {workingWeight && (
          <div className="flex gap-4 mb-4">
            <div>
              <p className="text-[10px] text-ink-6 uppercase tracking-wide mb-0.5">Working</p>
              <p className="text-sm font-semibold text-ink">{workingWeight}kg</p>
            </div>
            <div>
              <p className="text-[10px] text-ink-6 uppercase tracking-wide mb-0.5">Sets</p>
              <p className="text-sm font-semibold text-ink">{working.length}</p>
            </div>
            {working[0] && (
              <div>
                <p className="text-[10px] text-ink-6 uppercase tracking-wide mb-0.5">Reps</p>
                <p className="text-sm font-semibold text-ink">{working[0].reps}</p>
              </div>
            )}
          </div>
        )}

        {/* Sets table */}
        <div className="bg-brand-tint rounded-xl px-4 py-3">
          <div className="grid grid-cols-[2rem_3.5rem_1fr_3.5rem] gap-x-3 mb-2">
            <span className="text-[10px] text-ink-6 uppercase tracking-wide">Set</span>
            <span className="text-[10px] text-ink-6 uppercase tracking-wide">kg</span>
            <span className="text-[10px] text-ink-6 uppercase tracking-wide">Reps · RPE</span>
            <span className="text-[10px] text-ink-6 uppercase tracking-wide text-right">e1RM</span>
          </div>
          {warmups.map((set) => (
            <SetRow key={set.id} set={set} />
          ))}
          {warmups.length > 0 && working.length > 0 && (
            <div className="h-px bg-surface-4 my-2" />
          )}
          {working.map((set) => (
            <SetRow key={set.id} set={set} />
          ))}
        </div>
      </section>
      )}

      {/* Extra workouts */}
      {session.extraWorkouts && session.extraWorkouts.length > 0 && (
        <section className="mb-6">
          <p className="text-[10px] font-medium text-ink-6 uppercase tracking-widest mb-3">
            Accessories
          </p>
          <div className="space-y-4">
            {session.extraWorkouts.map((workout) => (
              <div key={workout.muscle}>
                <p className="text-xs font-semibold text-ink-4 mb-2">
                  {getMuscleLabel(exerciseConfig, workout.muscle)}
                </p>
                {workout.exercises.map((exercise) => (
                  <div key={exercise.name} className="mb-2">
                    <p className="text-xs text-ink-5 mb-1">{exercise.name}</p>
                    {exercise.sets.map((set, i) =>
                      // A cardio bout is one sentence, not three columns — the lifting
                      // grid's fixed widths would wrap it mid-figure.
                      isCardioSet(set) ? (
                        <div key={i} className="flex gap-x-3 py-[2px] text-sm text-ink">
                          <span className="w-8 shrink-0 font-medium text-ink-6">{i + 1}</span>
                          <span>{formatCardioSet(set)}</span>
                        </div>
                      ) : (
                        <div
                          key={i}
                          className="grid grid-cols-[2rem_3.5rem_1fr] gap-x-3 py-[2px] text-sm whitespace-nowrap text-ink"
                        >
                          <span className="font-medium text-ink-6">{i + 1}</span>
                          <span>{set.kg}kg</span>
                          <span>
                            {set.reps} reps
                            {set.rpe != null && (
                              <span className="text-ink-6"> · {set.rpe}</span>
                            )}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Coach note */}
      {session.coachNote && (
        <section>
          <p className="text-[10px] font-medium text-ink-6 uppercase tracking-widest mb-2">
            Note
          </p>
          <p className="text-sm italic text-ink-4">{session.coachNote}</p>
        </section>
      )}
    </main>
  )
}
