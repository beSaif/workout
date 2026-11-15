"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  MuscleGroupConfig,
  ExerciseConfig,
  DEFAULT_MUSCLE_GROUPS,
  findSimilarExercises,
  generateId,
  getDefaultSets,
  retireReplacedGroups,
} from "@/lib/exerciseConfig"
import {
  loadExerciseConfigLocal,
  loadExerciseConfig,
  saveExerciseConfig,
  loadTrainingDays,
  saveTrainingDays,
  loadCoach,
} from "@/lib/storage"
import { PersonSummary } from "@/lib/routines"
import { useOnboardingGuard } from "@/lib/useOnboardingGuard"
import BackButton from "@/components/BackButton"
import { useConfirm } from "@/components/ConfirmSheet"

const ICON_BUTTON = "p-1.5 text-ink-6 transition-colors disabled:opacity-30"

/**
 * One muscle group's exercises. At rest each row is a name and its set count; Edit
 * reveals the rarer controls — rename, reorder, delete — for the exercises and for
 * the group itself.
 */
export default function GroupPage() {
  const { confirm, confirmSheet } = useConfirm()
  useOnboardingGuard()
  const params = useParams()
  const router = useRouter()
  const groupId = String(params.groupId)

  const [config, setConfig] = useState<MuscleGroupConfig[]>(DEFAULT_MUSCLE_GROUPS)
  const [mounted, setMounted] = useState(false)
  const [coach, setCoach] = useState<PersonSummary | null>(null)
  const [editing, setEditing] = useState(false)

  const [addingExercise, setAddingExercise] = useState(false)
  const [newExerciseName, setNewExerciseName] = useState("")
  const [similarWarning, setSimilarWarning] = useState<string[]>([])

  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setConfig(loadExerciseConfigLocal())
    setMounted(true)
    loadExerciseConfig().then(setConfig)
    loadCoach().then(setCoach)
  }, [])

  useEffect(() => {
    if (addingExercise) addInputRef.current?.focus()
  }, [addingExercise])

  function persist(newConfig: MuscleGroupConfig[]) {
    setConfig(newConfig)
    saveExerciseConfig(newConfig)
  }

  function updateGroup(update: (g: MuscleGroupConfig) => MuscleGroupConfig) {
    persist(config.map((g) => (g.id === groupId ? update(g) : g)))
  }

  const group = config.find((g) => g.id === groupId)
  // A coach's groups are theirs to edit; cardio stays the athlete's own.
  const readOnly = coach !== null && !group?.cardio
  const sortedExercises = [...(group?.exercises ?? [])].sort((a, b) => a.order - b.order)

  function renameGroup(value: string) {
    const name = value.trim()
    if (!name || name === group?.name) return
    updateGroup((g) => ({ ...g, name }))
  }

  async function deleteGroup() {
    if (!group) return
    const exCount = group.exercises.length
    const yes = await confirm({
      title: `Delete "${group.name}"?`,
      body:
        exCount > 0
          ? `Its ${exCount} exercise${exCount !== 1 ? "s go" : " goes"} with it. Sessions you already logged keep their history.`
          : undefined,
      confirmLabel: "Delete group",
      destructive: true,
    })
    if (!yes) return
    // Retired, not dropped: the confirmation above promises history is kept, and
    // sessions that logged this group resolve its name through the tombstone.
    const live = config.filter((g) => g.id !== group.id && !g.retired)
    saveExerciseConfig(retireReplacedGroups(live, config))
    const days = await loadTrainingDays()
    saveTrainingDays(days.map((d) => ({
      ...d,
      muscleGroupIds: d.muscleGroupIds.filter((id) => id !== group.id),
    })))
    router.push("/exercises")
  }

  function renameExercise(ex: ExerciseConfig, value: string) {
    const name = value.trim()
    if (!name || name === ex.name) return
    updateGroup((g) => ({ ...g, exercises: g.exercises.map((e) => (e.id === ex.id ? { ...e, name } : e)) }))
  }

  async function deleteExercise(ex: ExerciseConfig) {
    if (!(await confirm({ title: `Remove "${ex.name}" from ${group?.name}?`, confirmLabel: "Remove", destructive: true }))) return
    updateGroup((g) => ({ ...g, exercises: g.exercises.filter((e) => e.id !== ex.id) }))
  }

  function moveExercise(exId: string, direction: "up" | "down") {
    const idx = sortedExercises.findIndex((e) => e.id === exId)
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sortedExercises.length) return
    const newOrder = sortedExercises[swapIdx].order
    const swapOrder = sortedExercises[idx].order
    updateGroup((g) => ({
      ...g,
      exercises: g.exercises.map((e) => {
        if (e.id === sortedExercises[idx].id) return { ...e, order: newOrder }
        if (e.id === sortedExercises[swapIdx].id) return { ...e, order: swapOrder }
        return e
      }),
    }))
  }

  function updateDefaultSets(exId: string, count: number) {
    updateGroup((g) => ({ ...g, exercises: g.exercises.map((e) => (e.id === exId ? { ...e, defaultSets: count } : e)) }))
  }

  function handleNewNameChange(value: string) {
    setNewExerciseName(value)
    setSimilarWarning(value.trim().length >= 3 ? findSimilarExercises(value.trim(), config) : [])
  }

  function cancelAdd() {
    setAddingExercise(false)
    setNewExerciseName("")
    setSimilarWarning([])
  }

  function addExercise(force = false) {
    const name = newExerciseName.trim()
    if (!name) {
      cancelAdd()
      return
    }
    if (!force && similarWarning.length > 0) return

    const id = generateId(name)
    const newEx: ExerciseConfig = { id, name, order: group?.exercises.length ?? 0 }
    updateGroup((g) => ({ ...g, exercises: [...g.exercises, newEx] }))
    cancelAdd()
  }

  if (!mounted) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
        <div className="h-4 w-16 bg-surface-4 rounded animate-pulse mb-8" />
        <div className="h-6 w-40 bg-surface-4 rounded animate-pulse mb-6" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-surface-4 rounded-xl animate-pulse mb-2" />
        ))}
      </main>
    )
  }

  if (!group) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
        <BackButton href="/exercises" label="Back to routine" className="mb-3" />
        <p className="text-sm text-ink-5">Group not found.</p>
      </main>
    )
  }

  // The count means bouts for cardio and working sets for everything else.
  const countLabel = group.cardio ? "Bouts" : "Sets"
  const unit = group.cardio ? "bout" : "set"

  return (
    <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {confirmSheet}
      <div className="flex items-center justify-between mb-6">
        <BackButton href="/exercises" label="Back to routine" />
        {/* Cardio has nothing to edit but its exercises, so no Edit until it has some */}
        {!readOnly && (!group.cardio || sortedExercises.length > 0) && (
          <button
            onClick={() => { setEditing(!editing); cancelAdd() }}
            className="text-sm font-semibold text-brand hover:text-brand-strong transition-colors"
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {editing && !group.cardio ? (
        <input
          key={group.name}
          defaultValue={group.name}
          onBlur={(e) => renameGroup(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
          aria-label="Muscle group name"
          className="w-full text-2xl font-semibold text-ink tracking-tight mb-1 border-b border-brand-line outline-none bg-transparent"
        />
      ) : (
        <h1 className="text-2xl font-semibold text-ink tracking-tight mb-1">
          {group.name}
        </h1>
      )}
      <p className="text-sm text-ink-5 mb-6">
        {sortedExercises.length === 0
          ? "No exercises yet — add one below"
          : `${sortedExercises.length} exercise${sortedExercises.length !== 1 ? "s" : ""}`}
        {group.cardio && (
          <span className="block text-xs text-ink-6 mt-1">
            Logged in minutes. Bouts is how many each one opens with.
          </span>
        )}
        {readOnly && coach && (
          <span className="block text-xs text-ink-6 mt-1">
            Part of {coach.name}&apos;s routine, which you follow — only they can change it.
          </span>
        )}
      </p>

      {/* Column hint, so the number on each row reads as what it is */}
      {sortedExercises.length > 0 && !editing && (
        <div className="flex justify-between px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-6">
          <span>Exercise</span>
          <span className={readOnly ? "" : "w-[84px] text-center"}>{countLabel}</span>
        </div>
      )}

      {/* Exercise list */}
      {(sortedExercises.length > 0 || addingExercise) && (
        <div className="bg-surface border border-line rounded-xl overflow-hidden mb-3">
          {sortedExercises.map((ex, idx) => {
            const sets = getDefaultSets(ex)
            return (
              <div
                key={ex.id}
                className={`flex items-center gap-2 px-4 py-3 ${
                  idx < sortedExercises.length - 1 ? "border-b border-line-soft" : ""
                }`}
              >
                {editing ? (
                  <>
                    <div className="flex flex-col shrink-0 -ml-1">
                      <button
                        onClick={() => moveExercise(ex.id, "up")}
                        disabled={idx === 0}
                        className="p-0.5 text-ink-6 disabled:opacity-30 hover:text-ink-4 transition-colors"
                        aria-label={`Move ${ex.name} up`}
                      >
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1,7 5.5,2.5 10,7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveExercise(ex.id, "down")}
                        disabled={idx === sortedExercises.length - 1}
                        className="p-0.5 text-ink-6 disabled:opacity-30 hover:text-ink-4 transition-colors"
                        aria-label={`Move ${ex.name} down`}
                      >
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1,4 5.5,8.5 10,4" />
                        </svg>
                      </button>
                    </div>
                    <input
                      key={ex.name}
                      defaultValue={ex.name}
                      onBlur={(e) => renameExercise(ex, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
                      aria-label="Exercise name"
                      className="flex-1 min-w-0 text-sm text-ink border-b border-line focus:border-brand-line outline-none bg-transparent py-0.5"
                    />
                    <button
                      onClick={() => deleteExercise(ex)}
                      className={`${ICON_BUTTON} hover:text-red-500 shrink-0`}
                      aria-label={`Delete ${ex.name}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2,3 11,3" />
                        <path d="M4 3V2h5v1" />
                        <rect x="3" y="4" width="7" height="7" rx="1" />
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 text-sm text-ink-2 truncate">{ex.name}</span>
                    {readOnly ? (
                      <span className="shrink-0 text-xs text-ink-6 tabular-nums">
                        {sets} {unit}{sets !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0 w-[84px] justify-center">
                        <button
                          onClick={() => updateDefaultSets(ex.id, Math.max(1, sets - 1))}
                          disabled={sets <= 1}
                          className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center text-ink-4 text-xs font-bold leading-none disabled:opacity-40"
                          aria-label={`Fewer ${unit}s for ${ex.name}`}
                        >
                          −
                        </button>
                        <span className="text-sm font-semibold text-ink w-5 text-center tabular-nums">
                          {sets}
                        </span>
                        <button
                          onClick={() => updateDefaultSets(ex.id, Math.min(8, sets + 1))}
                          disabled={sets >= 8}
                          className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center text-ink-4 text-xs font-bold leading-none disabled:opacity-40"
                          aria-label={`More ${unit}s for ${ex.name}`}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}

          {/* Inline add input */}
          {addingExercise && (
            <div className={`px-4 py-3 ${sortedExercises.length > 0 ? "border-t border-line-soft" : ""}`}>
              <input
                ref={addInputRef}
                value={newExerciseName}
                onChange={(e) => handleNewNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addExercise()
                  if (e.key === "Escape") cancelAdd()
                }}
                placeholder="Exercise name"
                aria-label="New exercise name"
                className="w-full text-sm text-ink border-b border-line focus:border-brand-line outline-none bg-transparent pb-1 mb-2"
              />
              {similarWarning.length > 0 && (
                <div className="mb-2">
                  <p className="text-[11px] text-amber-600">
                    Similar already exists: {similarWarning.join(", ")}
                  </p>
                  <button
                    onClick={() => addExercise(true)}
                    className="text-[11px] text-brand font-semibold underline mt-0.5"
                  >
                    Add anyway
                  </button>
                </div>
              )}
              <div className="flex gap-3 mt-1">
                <button
                  onClick={() => addExercise()}
                  disabled={!newExerciseName.trim()}
                  className="text-xs font-semibold text-white bg-brand-fill rounded-lg px-4 py-1.5 hover:bg-brand-fill-2 transition-colors disabled:opacity-40"
                >
                  Add
                </button>
                <button
                  onClick={cancelAdd}
                  className="text-xs font-semibold text-ink-5 hover:text-ink-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add exercise button */}
      {!addingExercise && !readOnly && !editing && (
        <button
          onClick={() => { setAddingExercise(true); setNewExerciseName(""); setSimilarWarning([]) }}
          className="w-full border border-dashed border-line rounded-xl py-3 text-sm font-semibold text-ink-6 hover:border-brand-line hover:text-brand transition-colors"
        >
          + Add exercise
        </button>
      )}

      {/* The group's own destructive action sits apart, and only while editing */}
      {editing && !group.cardio && (
        <button
          onClick={deleteGroup}
          className="w-full mt-8 border border-red-200 rounded-xl py-3 text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors"
        >
          Delete muscle group
        </button>
      )}
    </main>
  )
}
