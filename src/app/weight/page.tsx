"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { WeightEntry } from "@/lib/types"
import { isLiftFocused, getMainLiftLabel, getTrainingMode } from "@/lib/trainingMode"
import {
  loadProfile,
  profileCache,
  saveProfile,
  loadAll,
  sessionsCache,
  loadWeights,
  weightsCache,
  saveWeights,
} from "@/lib/storage"
import { useCachedState } from "@/lib/useLocalValue"
import { getBestE1RM } from "@/lib/stats"
import {
  dateKey,
  delta,
  formatDay,
  latestEntry,
  recentEntries,
  removeEntry,
  totalDelta,
  upsertEntry,
  goalProjection,
} from "@/lib/weight"
import WeightChart from "@/components/weight/WeightChart"
import WeightLogList from "@/components/weight/WeightLogList"
import StrengthRatioPanel from "@/components/weight/StrengthRatioPanel"
import WeightCheckInSheet from "@/components/WeightCheckInSheet"
import BackButton from "@/components/BackButton"

const RANGES = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "all", days: null },
] as const

export default function WeightPage() {
  const router = useRouter()
  // The cached copies paint at once, so a re-navigation doesn't flash a skeleton; the
  // network replies replace them.
  const [cachedProfile, setProfile] = useCachedState(profileCache)
  const [cachedSessions, setSessions] = useCachedState(sessionsCache)
  const [cachedEntries, setEntries] = useCachedState(weightsCache)
  const profile = cachedProfile ?? null
  const sessions = cachedSessions ?? []
  const entries = cachedEntries ?? []

  const [rangeDays, setRangeDays] = useState<number | null>(30)
  /** The day the sheet is editing, or null when it is closed. */
  const [editing, setEditing] = useState<string | null>(null)

  /** What the user typed; null shows the profile's goal. */
  const [goalDraft, setGoalDraft] = useState<string | null>(null)
  const goalInput = goalDraft ?? (profile?.goalBw != null ? String(profile.goalBw) : "")
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalError, setGoalError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    loadProfile().then((p) => {
      if (cancelled) return
      if (!p) {
        router.replace("/onboarding")
        return
      }
      setProfile(p)
      setGoalDraft(null)
    })

    loadAll().then(({ sessions: data }) => {
      if (!cancelled) setSessions(data)
    })

    loadWeights().then((data) => {
      if (!cancelled) setEntries(data)
    })

    return () => {
      cancelled = true
    }
  }, [router, setProfile, setSessions, setEntries])

  function commit(next: WeightEntry[]) {
    setEntries(next)
    saveWeights(next)
    // saveWeights pins profile.bw to the newest reading; mirror it so this page's own
    // strength ratio updates without a reload.
    const newest = next[next.length - 1]
    setProfile((p) => (p && newest && p.bw !== newest.kg ? { ...p, bw: newest.kg } : p))
  }

  async function saveGoal() {
    if (!profile || goalSaving) return
    const val = parseFloat(goalInput)
    if (!Number.isFinite(val) || val <= 0) {
      setGoalError("enter a weight in kg")
      return
    }
    setGoalSaving(true)
    setGoalError(null)
    const updated = await saveProfile({
      name: profile.name,
      bw: profile.bw,
      trainingMode: getTrainingMode(profile),
      mainLift: profile.mainLift,
      anchor: profile.anchor,
      target: profile.target,
      weighInDaily: profile.weighInDaily,
      goalBw: val,
    })
    setGoalSaving(false)
    if (!updated) {
      setGoalError("couldn't save. check your connection.")
      return
    }
    setProfile(updated)
  }

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <div className="h-8 w-32 bg-surface-4 rounded animate-pulse mb-6" />
        <div className="h-40 w-full bg-surface-2 rounded-xl animate-pulse mb-4" />
        <div className="h-40 w-full bg-surface-2 rounded-xl animate-pulse" />
      </main>
    )
  }

  const latest = latestEntry(entries)
  const shown = rangeDays == null ? entries : recentEntries(entries, rangeDays)
  const liftFocused = isLiftFocused(profile)
  const projection = goalProjection(entries, profile.goalBw)

  const deltas: Array<{ label: string; value: number | null }> = [
    { label: "7 days", value: delta(entries, 7) },
    { label: "30 days", value: delta(entries, 30) },
    { label: "all time", value: totalDelta(entries) },
  ]

  return (
    <>
      {editing && (
        <WeightCheckInSheet
          entries={entries}
          date={editing}
          fallbackKg={latest?.kg ?? profile.bw}
          onSave={(date, kg) => {
            commit(upsertEntry(entries, date, kg))
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <header className="flex items-center gap-2 mb-6">
          <BackButton href="/" label="Back to home" />
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Weight</h1>
        </header>

        {/* Current + trend */}
        <section className="mb-4 px-4 py-4 rounded-xl bg-surface border border-line">
          <div className="flex items-baseline justify-between mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-ink leading-none tabular-nums">
                {latest ? latest.kg.toFixed(1) : "—"}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-6">
                kg
              </span>
            </div>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRangeDays(r.days)}
                  className={`text-[11px] font-semibold rounded-full px-2.5 py-1 transition-colors ${
                    rangeDays === r.days
                      ? "bg-brand-tint text-brand"
                      : "text-ink-6 hover:bg-surface-2"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <WeightChart entries={shown} goalBw={profile.goalBw} />
        </section>

        {/* Deltas */}
        <section className="mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3">
            Change
          </p>
          <div className="grid grid-cols-3 gap-2">
            {deltas.map((d) => (
              <div key={d.label}>
                <p className="text-lg font-semibold text-ink tabular-nums">
                  {d.value == null
                    ? "—"
                    : `${d.value > 0 ? "+" : d.value < 0 ? "−" : ""}${Math.abs(d.value).toFixed(1)}`}
                </p>
                <p className="text-xs text-ink-6">{d.label}</p>
              </div>
            ))}
          </div>
          {projection && projection.kgPerWeek !== 0 && (
            <p className="text-xs text-ink-6 mt-3">
              {projection.kgPerWeek > 0 ? "+" : "−"}
              {Math.abs(projection.kgPerWeek).toFixed(1)}kg/week
              {projection.etaDate
                ? ` — on track for ${profile.goalBw}kg around ${formatDay(projection.etaDate)}`
                : ""}
            </p>
          )}
        </section>

        {liftFocused && (
          <StrengthRatioPanel
            e1rm={getBestE1RM(sessions)}
            bw={latest?.kg ?? profile.bw}
            target={profile.target}
            goalBw={profile.goalBw}
            liftLabel={getMainLiftLabel(profile)}
          />
        )}

        {/* Goal weight */}
        <section className="mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3">
            Goal weight
          </p>
          <div className="flex items-baseline gap-2 border-b-2 border-line focus-within:border-brand-line pb-2 mb-3">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={goalInput}
              onChange={(e) => setGoalDraft(e.target.value)}
              placeholder="60"
              className="flex-1 text-lg font-semibold text-ink outline-none bg-transparent"
            />
            <span className="text-base text-ink-6">kg</span>
          </div>
          {goalError && <p className="text-sm text-red-500 mb-2">{goalError}</p>}
          <button
            onClick={saveGoal}
            disabled={goalSaving || goalInput === (profile.goalBw != null ? String(profile.goalBw) : "")}
            className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3 disabled:opacity-40 disabled:pointer-events-none active:bg-brand-fill-3 transition-colors"
          >
            {goalSaving ? "saving…" : "set goal"}
          </button>
        </section>

        {/* Log */}
        <section className="px-4 py-4 rounded-xl bg-surface border border-line">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6">
              Log
            </p>
            <button
              onClick={() => setEditing(dateKey())}
              className="text-sm font-semibold text-brand hover:underline"
            >
              add
            </button>
          </div>
          <WeightLogList
            entries={entries}
            onEdit={(date) => setEditing(date)}
            onDelete={(date) => commit(removeEntry(entries, date))}
          />
        </section>
      </main>
    </>
  )
}
